/**
 * Motor de avance del torneo (async, sobre libSQL/Turso).
 *
 * - Calcula la tabla de posiciones de cada grupo con los criterios de desempate
 *   de la FIFA para el Mundial 2026 (en orden estricto):
 *     1. Puntos en todos los partidos del grupo.
 *     2. Puntos en los enfrentamientos directos entre los equipos empatados.
 *     3. Diferencia de goles en esos enfrentamientos directos.
 *     4. Goles a favor en esos enfrentamientos directos.
 *     5. Diferencia de goles general.
 *     6. Goles a favor general.
 *     7. Fair Play (tarjetas) — NO disponible: no se registran tarjetas.
 *     8. Sorteo FIFA — aquí se usa el orden alfabético como último recurso.
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

/** Un partido de grupo ya jugado (para los desempates por enfrentamiento directo). */
interface GroupGame {
  home: string;
  away: string;
  hs: number;
  as: number;
}

function emptyStanding(teamId: string): Standing {
  return { teamId, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 };
}

/**
 * Criterios "generales" (puntos / DG / GF) + alfabético como último recurso.
 * Se usa para rankear terceros entre grupos (donde no hay enfrentamiento directo)
 * y como caída final dentro de un grupo cuando el directo no separa.
 */
function compareOverall(a: Standing, b: Standing): number {
  return (
    b.points - a.points ||
    b.gd - a.gd ||
    b.gf - a.gf ||
    a.teamId.localeCompare(b.teamId)
  );
}

/** Mini-tabla del enfrentamiento directo entre un subconjunto de equipos. */
function headToHead(block: Standing[], games: GroupGame[]) {
  const ids = new Set(block.map((s) => s.teamId));
  const h2h = new Map<string, { pts: number; gf: number; ga: number }>();
  for (const s of block) h2h.set(s.teamId, { pts: 0, gf: 0, ga: 0 });
  for (const g of games) {
    if (!ids.has(g.home) || !ids.has(g.away)) continue; // solo partidos entre empatados
    const H = h2h.get(g.home)!;
    const A = h2h.get(g.away)!;
    H.gf += g.hs; H.ga += g.as;
    A.gf += g.as; A.ga += g.hs;
    if (g.hs > g.as) H.pts += 3;
    else if (g.hs < g.as) A.pts += 3;
    else { H.pts++; A.pts++; }
  }
  return h2h;
}

/**
 * Ordena un grupo aplicando los desempates FIFA. Primero por puntos; los bloques
 * que empatan en puntos se resuelven por el enfrentamiento directo (puntos, DG y
 * GF entre ellos) y, si aún empatan, por DG/GF general y alfabético.
 *
 * Nota: usa una única mini-tabla del directo por bloque empatado (no re-aplica
 * los criterios sobre los subconjuntos que se van separando). Es el método
 * habitual y cubre los casos reales del torneo.
 */
function orderGroup(standings: Standing[], games: GroupGame[]): Standing[] {
  const byPoints = [...standings].sort((a, b) => b.points - a.points);
  const out: Standing[] = [];
  let i = 0;
  while (i < byPoints.length) {
    let j = i;
    while (j < byPoints.length && byPoints[j].points === byPoints[i].points) j++;
    const block = byPoints.slice(i, j);
    if (block.length === 1) {
      out.push(block[0]);
    } else {
      const h2h = headToHead(block, games);
      block.sort((a, b) => {
        const ha = h2h.get(a.teamId)!;
        const hb = h2h.get(b.teamId)!;
        return (
          hb.pts - ha.pts ||
          (hb.gf - hb.ga) - (ha.gf - ha.ga) ||
          hb.gf - ha.gf ||
          b.gd - a.gd ||
          b.gf - a.gf ||
          a.teamId.localeCompare(b.teamId)
        );
      });
      out.push(...block);
    }
    i = j;
  }
  return out;
}

/** Tabla de posiciones por grupo (ya ordenada): { A: [Standing,...], ... } */
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

  const gamesByGroup: Record<string, GroupGame[]> = {};
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
    (gamesByGroup[m.grp] ??= []).push({
      home: m.home_team, away: m.away_team, hs: m.home_score, as: m.away_score,
    });
  }

  const out: Record<string, Standing[]> = {};
  for (const [g, table] of Object.entries(byGroup)) {
    out[g] = orderGroup([...table.values()], gamesByGroup[g] ?? []);
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

/** Rankea terceros (criterios generales FIFA) y devuelve los mejores 8 ids. */
function rankThirds(thirds: Standing[]): string[] {
  return [...thirds].sort(compareOverall).slice(0, 8).map((s) => s.teamId);
}

/**
 * Los 8 mejores terceros segun las posiciones ACTUALES (proyección en vivo):
 * toma el 3º de cada grupo tal como va hoy, aunque el grupo no haya terminado.
 */
export function bestThirds(standings: Record<string, Standing[]>): string[] {
  const thirds: Standing[] = [];
  for (const table of Object.values(standings)) {
    if (table[2]) thirds.push(table[2]);
  }
  return rankThirds(thirds);
}

/**
 * Equipos YA eliminados matemáticamente (sin chance de avanzar):
 * - El 4º de cualquier grupo terminado (nunca puede ser mejor tercero).
 * - Los terceros de grupos terminados que ya quedaron fuera del top-8 entre los
 *   terceros de grupos terminados: los terceros que falten solo pueden empujarlos
 *   más abajo, nunca subirlos.
 */
export async function eliminatedTeams(): Promise<Set<string>> {
  const standings = await groupStandings();
  const complete = await completeGroups();
  const out = new Set<string>();
  const completeThirds: Standing[] = [];
  for (const [g, table] of Object.entries(standings)) {
    if (!complete.has(g)) continue;
    if (table[3]) out.add(table[3].teamId); // 4º de grupo terminado
    if (table[2]) completeThirds.push(table[2]);
  }
  completeThirds.sort(compareOverall);
  for (let i = 8; i < completeThirds.length; i++) out.add(completeThirds[i].teamId);
  return out;
}

/** Resuelve una fuente a un id de equipo, o null si aun no se conoce. */
function resolveSource(
  src: string | null,
  standings: Record<string, Standing[]>,
  thirds: string[],
  matchByCode: Map<string, MatchRow>,
  resolvedTeam: (m: MatchRow, side: "home" | "away") => string | null,
  requireComplete: ((grp: string) => boolean) | null
): string | null {
  if (!src) return null;
  const [kind, arg] = src.split(":");
  switch (kind) {
    case "WG":
      if (requireComplete && !requireComplete(arg)) return null;
      return standings[arg]?.[0]?.teamId ?? null;
    case "RU":
      if (requireComplete && !requireComplete(arg)) return null;
      return standings[arg]?.[1]?.teamId ?? null;
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
        ? homeWon ? resolvedTeam(m, "home") : resolvedTeam(m, "away")
        : homeWon ? resolvedTeam(m, "away") : resolvedTeam(m, "home");
    }
    default:
      return null;
  }
}

/**
 * Rellena los equipos de las eliminatorias segun los resultados PUBLICADOS.
 * Solo asigna 1º/2º cuando el grupo terminó (no se mueve el cuadro oficial con
 * resultados provisionales). force = true limpia primero y recalcula desde cero.
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
  const completeThirds: Standing[] = [];
  for (const [g, table] of Object.entries(standings)) {
    if (complete.has(g) && table[2]) completeThirds.push(table[2]);
  }
  const thirds = rankThirds(completeThirds);

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
        const r = resolveSource(
          m.home_src, standings, thirds, matchByCode,
          (mm, side) => (side === "home" ? mm.home_team : mm.away_team),
          (grp) => complete.has(grp)
        );
        if (r) {
          await dbRun("UPDATE matches SET home_team = ? WHERE id = ?", [r, m.id]);
          m.home_team = r;
          assigned++;
        }
      }
      if (!m.away_team) {
        const r = resolveSource(
          m.away_src, standings, thirds, matchByCode,
          (mm, side) => (side === "home" ? mm.home_team : mm.away_team),
          (grp) => complete.has(grp)
        );
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

export interface ProjectedSlot {
  home: string | null;
  away: string | null;
  homeProjected: boolean; // true si se derivó de las posiciones actuales (no del equipo ya fijado)
  awayProjected: boolean;
}

/**
 * Proyección EN VIVO del cuadro (read-only, no toca la BD): rellena cada cruce
 * con los equipos segun las posiciones actuales de los grupos (1º/2º/terceros
 * de hoy, aunque el grupo no haya terminado). Para WM/LM solo proyecta cuando
 * el partido que alimenta ya tiene resultado publicado.
 */
export async function projectBracket(): Promise<Map<number, ProjectedSlot>> {
  const standings = await groupStandings();
  const thirds = bestThirds(standings); // proyección en vivo (todos los grupos)
  const matches = await dbAll<MatchRow>("SELECT * FROM matches WHERE stage != 'group'");

  const slots = new Map<number, ProjectedSlot>();
  for (const m of matches) {
    slots.set(m.id, {
      home: m.home_team,
      away: m.away_team,
      homeProjected: false,
      awayProjected: false,
    });
  }

  // resuelve el id proyectado (o fijado) de un lado de un partido
  const sideTeam = (m: MatchRow, side: "home" | "away"): string | null => {
    const s = slots.get(m.id);
    return side === "home" ? s?.home ?? null : s?.away ?? null;
  };

  const matchByCode = new Map(
    matches.filter((m) => m.code).map((m) => [m.code as string, m])
  );

  const stages = ["r32", "r16", "qf", "sf", "third", "final"];
  for (let pass = 0; pass < stages.length; pass++) {
    for (const m of matches) {
      const slot = slots.get(m.id)!;
      if (!slot.home) {
        const r = resolveSource(m.home_src, standings, thirds, matchByCode, sideTeam, null);
        if (r) { slot.home = r; slot.homeProjected = true; }
      }
      if (!slot.away) {
        const r = resolveSource(m.away_src, standings, thirds, matchByCode, sideTeam, null);
        if (r) { slot.away = r; slot.awayProjected = true; }
      }
    }
  }
  return slots;
}
