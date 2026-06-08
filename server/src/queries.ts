import { db, getSetting } from "./db.js";
import { scoreMatch, scoreTournament } from "./scoring.js";

export interface TeamRow {
  id: string;
  name: string;
  flag: string | null;
  grp: string | null;
}

interface MatchRow {
  id: number;
  stage: string;
  grp: string | null;
  label: string | null;
  home_team: string | null;
  away_team: string | null;
  home_label: string | null;
  away_label: string | null;
  kickoff_at: string;
  venue: string | null;
  home_score: number | null;
  away_score: number | null;
  finished: number;
}

const teamById = new Map<string, TeamRow>();
export function refreshTeamCache(): void {
  teamById.clear();
  for (const t of db.prepare("SELECT * FROM teams").all() as unknown as TeamRow[]) {
    teamById.set(t.id, t);
  }
}

function team(id: string | null) {
  if (!id) return null;
  const t = teamById.get(id);
  return t ? { id: t.id, name: t.name, flag: t.flag } : null;
}

export function isMatchLocked(kickoffAt: string): boolean {
  return Date.now() >= new Date(kickoffAt).getTime();
}

/**
 * Fecha de cierre de los bonos (campeon, subcampeon, goleador, mejor arquero).
 * Por defecto: la hora del ULTIMO partido de la jornada 1 de la fase de grupos
 * (cuando ya se jugo la primera fecha de todos los grupos). El admin lo puede
 * sobreescribir con un setting.
 */
export function bonosDeadline(): string | null {
  const explicit = getSetting("bonos_deadline");
  if (explicit) return explicit;
  const row = db
    .prepare(
      "SELECT MAX(kickoff_at) AS last FROM matches WHERE stage = 'group' AND matchday = 1"
    )
    .get() as { last: string | null };
  if (row.last) return row.last;
  const fallback = db
    .prepare("SELECT MIN(kickoff_at) AS first FROM matches")
    .get() as { first: string | null };
  return fallback.first ?? null;
}

export function areBonosLocked(): boolean {
  const deadline = bonosDeadline();
  if (!deadline) return false;
  return Date.now() >= new Date(deadline).getTime();
}

export function shapeMatch(m: MatchRow) {
  return {
    id: m.id,
    stage: m.stage,
    grp: m.grp,
    label: m.label,
    kickoffAt: m.kickoff_at,
    venue: m.venue,
    home: team(m.home_team),
    away: team(m.away_team),
    homeLabel: m.home_label,
    awayLabel: m.away_label,
    homeScore: m.home_score,
    awayScore: m.away_score,
    finished: !!m.finished,
    locked: isMatchLocked(m.kickoff_at),
  };
}

export function allMatches(): MatchRow[] {
  return db
    .prepare("SELECT * FROM matches ORDER BY kickoff_at, id")
    .all() as unknown as MatchRow[];
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
}

/** Calcula la tabla de posiciones completa. */
export function leaderboard(): LeaderRow[] {
  const users = db
    .prepare("SELECT id, apodo FROM users ORDER BY id")
    .all() as { id: number; apodo: string }[];

  const finished = (
    db.prepare("SELECT * FROM matches WHERE finished = 1").all() as unknown as MatchRow[]
  ).filter((m) => m.home_score !== null && m.away_score !== null);
  const finishedById = new Map(finished.map((m) => [m.id, m]));

  const preds = db.prepare("SELECT * FROM predictions").all() as unknown as PredRow[];
  const predsByUser = new Map<number, PredRow[]>();
  for (const p of preds) {
    if (!predsByUser.has(p.user_id)) predsByUser.set(p.user_id, []);
    predsByUser.get(p.user_id)!.push(p);
  }

  const results = {
    champion: getSetting("result_champion"),
    runnerUp: getSetting("result_runner_up"),
    topScorer: getSetting("result_top_scorer"),
    bestGoalkeeper: getSetting("result_best_goalkeeper"),
  };
  const bonusPicks = db.prepare("SELECT * FROM tournament_picks").all() as {
    user_id: number;
    champion: string | null;
    runner_up: string | null;
    top_scorer: string | null;
    best_goalkeeper: string | null;
  }[];
  const bonusByUser = new Map(bonusPicks.map((b) => [b.user_id, b]));

  const rows: LeaderRow[] = users.map((u) => {
    let matchPoints = 0;
    let exactCount = 0;
    let playedPredictions = 0;
    for (const p of predsByUser.get(u.id) ?? []) {
      const m = finishedById.get(p.match_id);
      if (!m || m.home_score === null || m.away_score === null) continue;
      playedPredictions++;
      const pts = scoreMatch(
        { home: p.home_score, away: p.away_score },
        { home: m.home_score, away: m.away_score }
      );
      matchPoints += pts;
      if (pts === 5) exactCount++;
    }

    const b = bonusByUser.get(u.id);
    const bonusPoints = b
      ? scoreTournament(
          {
            champion: b.champion,
            runnerUp: b.runner_up,
            topScorer: b.top_scorer,
            bestGoalkeeper: b.best_goalkeeper,
          },
          results
        )
      : 0;

    return {
      userId: u.id,
      apodo: u.apodo,
      total: matchPoints + bonusPoints,
      matchPoints,
      bonusPoints,
      exactCount,
      playedPredictions,
    };
  });

  rows.sort(
    (a, b) =>
      b.total - a.total ||
      b.exactCount - a.exactCount ||
      a.apodo.localeCompare(b.apodo)
  );
  return rows;
}
