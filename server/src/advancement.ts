/**
 * Motor de avance del torneo.
 *
 * - Calcula la tabla de posiciones de cada grupo a partir de los resultados
 *   cargados (3 pts victoria, 1 empate; desempate: dif. de goles, goles a favor,
 *   victorias, luego orden alfabetico).
 * - Determina clasificados: 1º y 2º de cada grupo + los 8 mejores terceros.
 * - Resuelve el cuadro de eliminatorias rellenando los equipos de cada partido
 *   segun su "fuente" (home_src / away_src):
 *     WG:A  -> ganador del grupo A
 *     RU:A  -> segundo del grupo A
 *     TH:1  -> mejor tercero (1..8 por ranking)
 *     WM:M1 -> ganador del partido con codigo M1
 *     LM:S1 -> perdedor del partido con codigo S1
 *
 * Se ejecuta cada vez que el admin guarda un resultado.
 */
import { db } from "./db.js";

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
export function groupStandings(): Record<string, Standing[]> {
  const teams = db
    .prepare("SELECT id, grp FROM teams WHERE grp IS NOT NULL")
    .all() as { id: string; grp: string }[];
  const byGroup: Record<string, Map<string, Standing>> = {};
  for (const t of teams) {
    (byGroup[t.grp] ??= new Map()).set(t.id, emptyStanding(t.id));
  }

  const matches = db
    .prepare(
      "SELECT grp, home_team, away_team, home_score, away_score FROM matches WHERE stage = 'group' AND finished = 1"
    )
    .all() as {
    grp: string;
    home_team: string | null;
    away_team: string | null;
    home_score: number | null;
    away_score: number | null;
  }[];

  for (const m of matches) {
    if (
      !m.home_team ||
      !m.away_team ||
      m.home_score === null ||
      m.away_score === null
    )
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
    if (m.home_score > m.away_score) {
      h.won++; h.points += 3; a.lost++;
    } else if (m.home_score < m.away_score) {
      a.won++; a.points += 3; h.lost++;
    } else {
      h.drawn++; a.drawn++; h.points++; a.points++;
    }
  }

  const out: Record<string, Standing[]> = {};
  for (const [g, table] of Object.entries(byGroup)) {
    out[g] = [...table.values()].sort(compareStandings);
  }
  return out;
}

function groupComplete(grp: string): boolean {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS total, SUM(finished) AS done FROM matches WHERE stage = 'group' AND grp = ?"
    )
    .get(grp) as { total: number; done: number | null };
  return row.total > 0 && (row.done ?? 0) === row.total;
}

/** Ranking de los terceros de cada grupo completo; devuelve top 8 (o menos). */
export function bestThirds(standings: Record<string, Standing[]>): string[] {
  const thirds: Standing[] = [];
  for (const [g, table] of Object.entries(standings)) {
    if (!groupComplete(g)) continue;
    if (table[2]) thirds.push(table[2]);
  }
  thirds.sort(compareStandings);
  return thirds.slice(0, 8).map((s) => s.teamId);
}

/** Resuelve una fuente a un id de equipo, o null si aun no se conoce. */
function resolveSource(
  src: string | null,
  standings: Record<string, Standing[]>,
  thirds: string[],
  matchByCode: Map<string, MatchRow>
): string | null {
  if (!src) return null;
  const [kind, arg] = src.split(":");
  switch (kind) {
    case "WG": {
      if (!groupComplete(arg)) return null;
      return standings[arg]?.[0]?.teamId ?? null;
    }
    case "RU": {
      if (!groupComplete(arg)) return null;
      return standings[arg]?.[1]?.teamId ?? null;
    }
    case "TH": {
      const idx = Number(arg) - 1;
      return thirds[idx] ?? null;
    }
    case "WM":
    case "LM": {
      const m = matchByCode.get(arg);
      if (!m || !m.finished || m.home_score === null || m.away_score === null)
        return null;
      if (m.home_score === m.away_score) return null; // sin penales no hay ganador
      const homeWon = m.home_score > m.away_score;
      const winner = homeWon ? m.home_team : m.away_team;
      const loser = homeWon ? m.away_team : m.home_team;
      return kind === "WM" ? winner : loser;
    }
    default:
      return null;
  }
}

/**
 * Rellena los equipos de las eliminatorias segun los resultados actuales.
 * Si force = true, primero limpia los equipos de las eliminatorias y recalcula
 * todo desde cero (util si se corrige un resultado de grupos).
 * Devuelve cuantos cupos quedaron asignados.
 */
export function resolveBracket(force = false): number {
  if (force) {
    db.exec(
      "UPDATE matches SET home_team = NULL, away_team = NULL WHERE stage != 'group'"
    );
  }

  const standings = groupStandings();
  const thirds = bestThirds(standings);

  // varias pasadas para propagar ganadores ronda a ronda
  const order = ["r32", "r16", "qf", "sf", "third", "final"];
  let assigned = 0;
  for (let pass = 0; pass < order.length; pass++) {
    const matches = db
      .prepare("SELECT * FROM matches WHERE stage != 'group'")
      .all() as unknown as MatchRow[];
    const matchByCode = new Map(
      matches.filter((m) => m.code).map((m) => [m.code as string, m])
    );

    for (const m of matches) {
      const updates: { col: string; val: string }[] = [];
      if (!m.home_team) {
        const r = resolveSource(m.home_src, standings, thirds, matchByCode);
        if (r) updates.push({ col: "home_team", val: r });
      }
      if (!m.away_team) {
        const r = resolveSource(m.away_src, standings, thirds, matchByCode);
        if (r) updates.push({ col: "away_team", val: r });
      }
      for (const u of updates) {
        db.prepare(`UPDATE matches SET ${u.col} = ? WHERE id = ?`).run(u.val, m.id);
        m[u.col as "home_team" | "away_team"] = u.val;
        assigned++;
      }
    }
  }
  return assigned;
}
