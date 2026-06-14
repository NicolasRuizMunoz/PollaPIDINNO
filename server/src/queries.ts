import { dbAll, dbGet, getSetting } from "./db.js";
import { scoreMatch, scoreTournament } from "./scoring.js";

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  return `${email[0]}***${email.slice(at)}`;
}

export function displayName(apodo: string, email: string): string {
  return apodo.trim() || maskEmail(email);
}

export interface TeamRow {
  id: string;
  name: string;
  flag: string | null;
  grp: string | null;
}

interface MatchRow {
  id: number;
  code: string | null;
  stage: string;
  grp: string | null;
  label: string | null;
  home_team: string | null;
  away_team: string | null;
  home_label: string | null;
  away_label: string | null;
  home_src: string | null;
  away_src: string | null;
  kickoff_at: string;
  venue: string | null;
  home_score: number | null;
  away_score: number | null;
  finished: number;
  status: string | null;
  live_home: number | null;
  live_away: number | null;
  minute: number | null;
}

export type TeamMap = Map<string, TeamRow>;

export async function loadTeamMap(): Promise<TeamMap> {
  const teams = await dbAll<TeamRow>("SELECT * FROM teams");
  return new Map(teams.map((t) => [t.id, t]));
}

function team(id: string | null, teams: TeamMap) {
  if (!id) return null;
  const t = teams.get(id);
  return t ? { id: t.id, name: t.name, flag: t.flag } : null;
}

export function isMatchLocked(kickoffAt: string): boolean {
  return Date.now() >= new Date(kickoffAt).getTime();
}

/** Fecha de cierre de los bonos: el ultimo partido de la jornada 1 de grupos. */
export async function bonosDeadline(): Promise<string | null> {
  const explicit = await getSetting("bonos_deadline");
  if (explicit) return explicit;
  const row = await dbGet<{ last: string | null }>(
    "SELECT MAX(kickoff_at) AS last FROM matches WHERE stage = 'group' AND matchday = 1"
  );
  if (row?.last) return row.last;
  const fb = await dbGet<{ first: string | null }>(
    "SELECT MIN(kickoff_at) AS first FROM matches"
  );
  return fb?.first ?? null;
}

export async function areBonosLocked(): Promise<boolean> {
  const deadline = await bonosDeadline();
  if (!deadline) return false;
  return Date.now() >= new Date(deadline).getTime();
}

export function shapeMatch(m: MatchRow, teams: TeamMap) {
  return {
    id: m.id,
    code: m.code,
    stage: m.stage,
    grp: m.grp,
    label: m.label,
    kickoffAt: m.kickoff_at,
    venue: m.venue,
    home: team(m.home_team, teams),
    away: team(m.away_team, teams),
    homeLabel: m.home_label,
    awayLabel: m.away_label,
    homeSrc: m.home_src,
    awaySrc: m.away_src,
    homeScore: m.home_score,
    awayScore: m.away_score,
    finished: !!m.finished,
    locked: isMatchLocked(m.kickoff_at),
    status: m.status ?? null,
    liveHome: m.live_home ?? null,
    liveAway: m.live_away ?? null,
    minute: m.minute ?? null,
  };
}

/** ¿El partido está transmitiendo marcador en vivo ahora mismo? */
export function isLive(m: { status: string | null; live_home: number | null; live_away: number | null }): boolean {
  return (
    (m.status === "LIVE" || m.status === "HT") &&
    m.live_home !== null &&
    m.live_away !== null
  );
}

export async function allMatches(): Promise<MatchRow[]> {
  return dbAll<MatchRow>("SELECT * FROM matches ORDER BY kickoff_at, id");
}

interface PredRow {
  user_id: number;
  match_id: number;
  home_score: number;
  away_score: number;
}

export interface LeaderRow {
  userId: number;
  apodo: string;
  total: number;
  matchPoints: number;
  bonusPoints: number;
  exactCount: number;
  playedPredictions: number;
  livePoints: number; // puntos provisionales de partidos en curso
  liveTotal: number; // total + livePoints
}

/** Calcula la tabla de posiciones completa (solo usuarios activos). */
export async function leaderboard(): Promise<LeaderRow[]> {
  const users = await dbAll<{ id: number; apodo: string; email: string }>(
    "SELECT id, apodo, email FROM users WHERE is_active = 1 ORDER BY id"
  );

  const finished = (
    await dbAll<MatchRow>("SELECT * FROM matches WHERE finished = 1")
  ).filter((m) => m.home_score !== null && m.away_score !== null);
  const finishedById = new Map(finished.map((m) => [m.id, m]));

  // partidos en vivo (no finalizados): suman puntos PROVISIONALES, aparte
  const liveById = new Map(
    (await dbAll<MatchRow>("SELECT * FROM matches WHERE finished = 0")).filter(isLive).map((m) => [m.id, m])
  );

  const preds = await dbAll<PredRow>("SELECT * FROM predictions");
  const predsByUser = new Map<number, PredRow[]>();
  for (const p of preds) {
    if (!predsByUser.has(p.user_id)) predsByUser.set(p.user_id, []);
    predsByUser.get(p.user_id)!.push(p);
  }

  const results = {
    champion: await getSetting("result_champion"),
    runnerUp: await getSetting("result_runner_up"),
    topScorer: await getSetting("result_top_scorer"),
    bestGoalkeeper: await getSetting("result_best_goalkeeper"),
    bestPlayer: await getSetting("result_best_player"),
    bestYoungPlayer: await getSetting("result_best_young_player"),
  };
  const bonusPicks = await dbAll<{
    user_id: number;
    champion: string | null;
    runner_up: string | null;
    top_scorer: string | null;
    best_goalkeeper: string | null;
    best_player: string | null;
    best_young_player: string | null;
  }>("SELECT * FROM tournament_picks");
  const bonusByUser = new Map(bonusPicks.map((b) => [b.user_id, b]));

  const rows: LeaderRow[] = users.map((u) => {
    let matchPoints = 0;
    let exactCount = 0;
    let playedPredictions = 0;
    let livePoints = 0;
    for (const p of predsByUser.get(u.id) ?? []) {
      const m = finishedById.get(p.match_id);
      if (m && m.home_score !== null && m.away_score !== null) {
        playedPredictions++;
        const pts = scoreMatch(
          { home: p.home_score, away: p.away_score },
          { home: m.home_score, away: m.away_score }
        );
        matchPoints += pts;
        if (pts === 5) exactCount++;
        continue;
      }
      // puntaje PROVISIONAL si el partido va en vivo (no cuenta como oficial)
      const lm = liveById.get(p.match_id);
      if (lm && lm.live_home !== null && lm.live_away !== null) {
        livePoints += scoreMatch(
          { home: p.home_score, away: p.away_score },
          { home: lm.live_home, away: lm.live_away }
        );
      }
    }

    const b = bonusByUser.get(u.id);
    const bonusPoints = b
      ? scoreTournament(
          {
            champion: b.champion,
            runnerUp: b.runner_up,
            topScorer: b.top_scorer,
            bestGoalkeeper: b.best_goalkeeper,
            bestPlayer: b.best_player,
            bestYoungPlayer: b.best_young_player,
          },
          results
        )
      : 0;

    const total = matchPoints + bonusPoints;
    return {
      userId: u.id,
      apodo: displayName(u.apodo, u.email),
      total,
      matchPoints,
      bonusPoints,
      exactCount,
      playedPredictions,
      livePoints,
      liveTotal: total + livePoints,
    };
  });

  rows.sort(
    (a, b) =>
      b.liveTotal - a.liveTotal ||
      b.total - a.total ||
      b.exactCount - a.exactCount ||
      a.apodo.localeCompare(b.apodo)
  );
  return rows;
}
