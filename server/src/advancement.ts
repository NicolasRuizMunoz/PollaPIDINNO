/**
 * Motor de avance del torneo (async, sobre libSQL/Turso).
 *
 * - Calcula la tabla de posiciones de cada grupo (3 pts victoria, 1 empate;
 *   desempate: dif. de goles, goles a favor, victorias, orden alfabetico).
 * - Determina clasificados: 1º y 2º de cada grupo + los 8 mejores terceros.
 * - Resuelve el cuadro rellenando los equipos de cada partido segun su "fuente"
 *   (WG:A, RU:A, TH:n, WM:Mx, LM:Sx).
 */
import { dbAll, dbRun } from "./db.js";

interface MatchRow {
  id: number;
  code: string | null;
  stage: string;
  grp: string | null;
  home_team: string | null;
  away_team: string | null;
  home_src: string | null;
  away_src: string | null;
  home_score: number | null;
  away_score: number | null;
  finished: number;
}

export interface Standing {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
}

function emptyStanding(teamId: string): Standing {
  return { teamId, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 };
}

function compareStandings(a: Standing, b: Standing): number {
  return (
    b.points - a.points ||
    b.gd - a.gd ||
    b.gf - a.gf ||
    b.won - a.won ||
    a.teamId.localeCompare(b.teamId)
  );
}

/** Tabla de posiciones por grupo: { A: [Standing,...], ... } */
export async function groupStandings(): Promise<Record<string, Standing[]>> {
  const teams = await dbAll<{ id: string; grp: string }>(
    "SELECT id, grp FROM teams WHERE grp IS NOT NULL"
  );
  const byGroup: Record<string, Map<string, Standing>> = {};
  for (const t of teams) {
    (byGroup[t.grp] ??= new Map()).set(t.id, emptyStanding(t.id));
  }

  const matches = await dbAll<{
    grp: string;
    home_team: string | null;
    away_team: string | null;
    home_score: number | null;
    away_score: number | null;
  }>(
    "SELECT grp, home_team, away_team, home_score, away_score FROM matches WHERE stage = 'group' AND finished = 1"
  );

  for (const m of matches) {
    if (!m.home_team || !m.away_team || m.home_score === null || m.away_score === null)
      continue;
    const table = byGroup[m.grp];
    if (!table) continue;
    const h = table.get(m.home_team);
    const a = table.get(m.away_team);
    if (!h || !a) continue;
    h.played++; a.played++;
    h.gf += m.home_score; h.ga += m.away_score;
    a.gf += m.away_score; a.ga += m.home_score;
    h.gd = h.gf - h.ga; a.gd = a.gf - a.ga;
    if (m.home_score > m.away_score) { h.won++; h.points += 3; a.lost++; }
    else if (m.home_score < m.away_score) { a.won++; a.points += 3; h.lost++; }
    else { h.drawn++; a.drawn++; h.points++; a.points++; }
  }

  const out: Record<string, Standing[]> = {};
  for (const [g, table] of Object.entries(byGroup)) {
    out[g] = [...table.values()].sort(compareStandings);
  }
  return out;
}

/** Conjunto de grupos que ya jugaron todos sus partidos. */
export async function completeGroups(): Promise<Set<string>> {
  const rows = await dbAll<{ grp: string; total: number; done: number | null }>(
    "SELECT grp, COUNT(*) AS total, SUM(finished) AS done FROM matches WHERE stage = 'group' GROUP BY grp"
  );
  const set = new Set<string>();
  for (const r of rows) {
    if (r.total > 0 && (r.done ?? 0) === r.total) set.add(r.grp);
  }
  return set;
}

/** Ranking de los terceros de cada grupo completo; devuelve top 8 (o menos). */
export function bestThirds(
  standings: Record<string, Standing[]>,
  complete: Set<string>
): string[] {
  const thirds: Standing[] = [];
  for (const [g, table] of Object.entries(standings)) {
    if (!complete.has(g)) continue;
    if (table[2]) thirds.push(table[2]);
  }
  thirds.sort(compareStandings);
  return thirds.slice(0, 8).map((s) => s.teamId);
}

/** Resuelve una fuente a un id de equipo, o null si aun no se conoce. */
function resolveSource(
  src: string | null,
  standings: Record<string, Standing[]>,
  complete: Set<string>,
  thirds: string[],
  matchByCode: Map<string, MatchRow>
): string | null {
  if (!src) return null;
  const [kind, arg] = src.split(":");
  switch (kind) {
    case "WG":
      return complete.has(arg) ? standings[arg]?.[0]?.teamId ?? null : null;
    case "RU":
      return complete.has(arg) ? standings[arg]?.[1]?.teamId ?? null : null;
    case "TH":
      return thirds[Number(arg) - 1] ?? null;
    case "WM":
    case "LM": {
      const m = matchByCode.get(arg);
      if (!m || !m.finished || m.home_score === null || m.away_score === null)
        return null;
      if (m.home_score === m.away_score) return null;
      const homeWon = m.home_score > m.away_score;
      return kind === "WM"
        ? homeWon ? m.home_team : m.away_team
        : homeWon ? m.away_team : m.home_team;
    }
    default:
      return null;
  }
}

/**
 * Rellena los equipos de las eliminatorias segun los resultados actuales.
 * force = true limpia primero y recalcula todo desde cero.
 * Devuelve cuantos cupos quedaron asignados.
 */
export async function resolveBracket(force = false): Promise<number> {
  if (force) {
    await dbRun(
      "UPDATE matches SET home_team = NULL, away_team = NULL WHERE stage != 'group'"
    );
  }

  const standings = await groupStandings();
  const complete = await completeGroups();
  const thirds = bestThirds(standings, complete);

  let assigned = 0;
  const stages = ["r32", "r16", "qf", "sf", "third", "final"];
  for (let pass = 0; pass < stages.length; pass++) {
    const matches = await dbAll<MatchRow>(
      "SELECT * FROM matches WHERE stage != 'group'"
    );
    const matchByCode = new Map(
      matches.filter((m) => m.code).map((m) => [m.code as string, m])
    );

    for (const m of matches) {
      if (!m.home_team) {
        const r = resolveSource(m.home_src, standings, complete, thirds, matchByCode);
        if (r) {
          await dbRun("UPDATE matches SET home_team = ? WHERE id = ?", [r, m.id]);
          m.home_team = r;
          assigned++;
        }
      }
      if (!m.away_team) {
        const r = resolveSource(m.away_src, standings, complete, thirds, matchByCode);
        if (r) {
          await dbRun("UPDATE matches SET away_team = ? WHERE id = ?", [r, m.id]);
          m.away_team = r;
          assigned++;
        }
      }
    }
  }
  return assigned;
}
