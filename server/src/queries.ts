import { dbAll, dbGet, getSetting } from "./db.js";
import { scoreMatch, scoreMatchDrawV2, scoreTournament, scoreAdvance } from "./scoring.js";

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
  advancer: string | null;
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

/** Cierre de la votación de la comunidad: el último partido de la jornada 3 de grupos. */
export async function pollsDeadline(): Promise<string | null> {
  const explicit = await getSetting("polls_deadline");
  if (explicit) return explicit;
  const row = await dbGet<{ last: string | null }>(
    "SELECT MAX(kickoff_at) AS last FROM matches WHERE stage = 'group' AND matchday = 3"
  );
  return row?.last ?? null;
}

export async function arePollsLocked(): Promise<boolean> {
  const deadline = await pollsDeadline();
  if (!deadline) return false;
  return Date.now() >= new Date(deadline).getTime();
}

// --- regla del empate: disparador (gating) ---------------------------------
// La regla NUEVA del empate entra a regir cuando se PUBLICA el partido
// disparador (Colombia: id 232 = UZB-COL del 17/18-jun). Antes de eso, todo el
// puntaje usa la regla vieja. Editable con el setting `draw_rule_trigger_match`.
const DRAW_RULE_TRIGGER_DEFAULT = 232;

export async function drawRuleTriggerMatchId(): Promise<number> {
  const s = await getSetting("draw_rule_trigger_match");
  const n = s ? Number(s) : NaN;
  return Number.isInteger(n) ? n : DRAW_RULE_TRIGGER_DEFAULT;
}

/** ¿Ya rige la regla nueva del empate? (el partido disparador está publicado) */
export async function drawRuleActive(): Promise<boolean> {
  const id = await drawRuleTriggerMatchId();
  const m = await dbGet<{
    finished: number;
    home_score: number | null;
    away_score: number | null;
  }>("SELECT finished, home_score, away_score FROM matches WHERE id = ?", [id]);
  return !!m && m.finished === 1 && m.home_score !== null && m.away_score !== null;
}

/** El motor de puntaje vigente según si la regla nueva ya está activa. */
export async function activeScorer() {
  return (await drawRuleActive()) ? scoreMatchDrawV2 : scoreMatch;
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
    advancer: m.advancer ?? null,
    locked: isMatchLocked(m.kickoff_at),
    status: m.status ?? null,
    liveHome: m.live_home ?? null,
    liveAway: m.live_away ?? null,
    minute: m.minute ?? null,
  };
}

/**
 * ¿El partido tiene un marcador "en vivo" que cuenta como PROVISIONAL?
 * Incluye FT (terminado según la API) mientras el admin no publique el oficial,
 * para que el resultado no "desaparezca" en ese intervalo.
 */
export function isLive(m: { status: string | null; live_home: number | null; live_away: number | null }): boolean {
  return (
    (m.status === "LIVE" || m.status === "HT" || m.status === "FT") &&
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
  advances: string | null;
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

  // motor de puntaje vigente (regla vieja, o la nueva si ya se publicó Colombia)
  const score = await activeScorer();

  const rows: LeaderRow[] = users.map((u) => {
    let matchPoints = 0;
    let exactCount = 0;
    let playedPredictions = 0;
    let livePoints = 0;
    for (const p of predsByUser.get(u.id) ?? []) {
      const m = finishedById.get(p.match_id);
      if (m && m.home_score !== null && m.away_score !== null) {
        playedPredictions++;
        const pts = score(
          { home: p.home_score, away: p.away_score },
          { home: m.home_score, away: m.away_score }
        );
        matchPoints += pts;
        if (pts === 5) exactCount++;
        // Bono "quién pasa" (eliminatorias): +1 si acertaste el clasificado.
        // Independiente del marcador (cuenta aunque falles el resultado de 90/120).
        matchPoints += scoreAdvance(p.advances, m.advancer);
        continue;
      }
      // puntaje PROVISIONAL si el partido va en vivo (no cuenta como oficial)
      const lm = liveById.get(p.match_id);
      if (lm && lm.live_home !== null && lm.live_away !== null) {
        livePoints += score(
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

export interface TimelineMatch {
  id: number;
  kickoffAt: string;
  homeTeam: string | null;
  awayTeam: string | null;
  homeLabel: string | null;
  awayLabel: string | null;
  finished: boolean;
  homeScore: number | null;
  awayScore: number | null;
  stage: string;
  grp: string | null;
}

export interface TimelineUser {
  id: number;
  apodo: string;
  email: string;
}

export interface TimelinePrediction {
  userId: number;
  matchId: number;
  homeScore: number;
  awayScore: number;
}

export interface TimelineTeam {
  id: string;
  grp: string | null;
}

export interface LeaderboardTimelineData {
  users: TimelineUser[];
  matches: TimelineMatch[];
  teams: TimelineTeam[];
  predictions: TimelinePrediction[];
}

/** Devuelve todos los datos necesarios para calcular el leaderboard histórico en el navegador. */
export async function leaderboardTimeline(): Promise<LeaderboardTimelineData> {
  const users = await dbAll<{ id: number; apodo: string; email: string }>(
    "SELECT id, apodo, email FROM users WHERE is_active = 1 ORDER BY id"
  );

  const matches = await dbAll<MatchRow>("SELECT * FROM matches ORDER BY kickoff_at, id");
  const matchesOut = matches.map((m) => ({
    id: m.id,
    kickoffAt: m.kickoff_at,
    homeTeam: m.home_team ?? null,
    awayTeam: m.away_team ?? null,
    homeLabel: m.home_label ?? null,
    awayLabel: m.away_label ?? null,
    finished: !!m.finished,
    homeScore: m.home_score ?? null,
    awayScore: m.away_score ?? null,
    stage: m.stage,
    grp: m.grp ?? null,
  }));

  const teams = await dbAll<TeamRow>("SELECT id, grp FROM teams");
  const teamsOut = teams.map((t) => ({ id: t.id, grp: t.grp ?? null }));

  const predictions = await dbAll<PredRow>("SELECT * FROM predictions");
  const predictionsOut = predictions.map((p) => ({
    userId: p.user_id,
    matchId: p.match_id,
    homeScore: p.home_score,
    awayScore: p.away_score,
  }));

  return {
    users: users.map((u) => ({ id: u.id, apodo: displayName(u.apodo, u.email), email: u.email })),
    matches: matchesOut,
    teams: teamsOut,
    predictions: predictionsOut,
  };
}

// ----------------------------------------------------------------------------
// Vista previa del cambio de regla del EMPATE (propuesta, aún NO aplicada).
// Compara el puntaje actual (scoreMatch) con el de la regla nueva
// (scoreMatchDrawV2) para mostrar quién bajaría y en qué partidos.
// No modifica ningún dato ni el puntaje oficial.
// ----------------------------------------------------------------------------

export interface DrawRuleChange {
  matchId: number;
  stage: string;
  kickoffAt: string;
  home: string;
  away: string;
  predHome: number;
  predAway: number;
  actualHome: number;
  actualAway: number;
  oldPts: number;
  newPts: number;
}

export interface DrawRuleUser {
  userId: number;
  apodo: string;
  oldTotal: number;
  newTotal: number;
  delta: number; // newTotal - oldTotal (negativo)
  changes: DrawRuleChange[];
}

export interface DrawRuleTrigger {
  matchId: number;
  home: string;
  away: string;
  kickoffAt: string;
  published: boolean; // ¿ya tiene resultado publicado?
}

export interface DrawRulePreview {
  active: boolean; // ¿la regla nueva ya rige? (Colombia publicado)
  trigger: DrawRuleTrigger | null; // partido que dispara el cambio
  affected: DrawRuleUser[];
  affectedCount: number;
  pointsRemoved: number; // total de puntos que se quitarían entre todos
}

export async function drawRulePreview(): Promise<DrawRulePreview> {
  const users = await dbAll<{ id: number; apodo: string; email: string }>(
    "SELECT id, apodo, email FROM users WHERE is_active = 1 ORDER BY id"
  );

  const teams = await loadTeamMap();
  const finished = (
    await dbAll<MatchRow>("SELECT * FROM matches WHERE finished = 1")
  ).filter((m) => m.home_score !== null && m.away_score !== null);
  const finishedById = new Map(finished.map((m) => [m.id, m]));

  const preds = await dbAll<PredRow>("SELECT * FROM predictions");
  const predsByUser = new Map<number, PredRow[]>();
  for (const p of preds) {
    if (!predsByUser.has(p.user_id)) predsByUser.set(p.user_id, []);
    predsByUser.get(p.user_id)!.push(p);
  }

  // Bonos de torneo: son iguales con cualquiera de las dos reglas, pero los
  // sumamos para que oldTotal/newTotal coincidan con la tabla de posiciones.
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
  const bonusFor = (userId: number): number => {
    const b = bonusByUser.get(userId);
    return b
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
  };

  const sideName = (id: string | null, label: string | null): string =>
    (id ? teams.get(id)?.name : null) ?? label ?? id ?? "Por definir";

  const affected: DrawRuleUser[] = [];
  let pointsRemoved = 0;

  for (const u of users) {
    const changes: DrawRuleChange[] = [];
    let oldMatch = 0;
    let newMatch = 0;

    for (const p of predsByUser.get(u.id) ?? []) {
      const m = finishedById.get(p.match_id);
      if (!m || m.home_score === null || m.away_score === null) continue;
      const pred = { home: p.home_score, away: p.away_score };
      const actual = { home: m.home_score, away: m.away_score };
      const oldPts = scoreMatch(pred, actual);
      const newPts = scoreMatchDrawV2(pred, actual);
      oldMatch += oldPts;
      newMatch += newPts;
      if (newPts !== oldPts) {
        changes.push({
          matchId: m.id,
          stage: m.stage,
          kickoffAt: m.kickoff_at,
          home: sideName(m.home_team, m.home_label),
          away: sideName(m.away_team, m.away_label),
          predHome: p.home_score,
          predAway: p.away_score,
          actualHome: m.home_score,
          actualAway: m.away_score,
          oldPts,
          newPts,
        });
      }
    }

    const delta = newMatch - oldMatch;
    if (delta < 0) {
      const bonus = bonusFor(u.id);
      changes.sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt));
      affected.push({
        userId: u.id,
        apodo: displayName(u.apodo, u.email),
        oldTotal: oldMatch + bonus,
        newTotal: newMatch + bonus,
        delta,
        changes,
      });
      pointsRemoved += -delta;
    }
  }

  affected.sort(
    (a, b) => a.delta - b.delta || a.apodo.localeCompare(b.apodo)
  );

  // partido disparador (Colombia) y si la regla ya rige
  const triggerId = await drawRuleTriggerMatchId();
  const tm = finishedById.get(triggerId) ??
    (await dbGet<MatchRow>("SELECT * FROM matches WHERE id = ?", [triggerId]));
  const trigger: DrawRuleTrigger | null = tm
    ? {
        matchId: tm.id,
        home: sideName(tm.home_team, tm.home_label),
        away: sideName(tm.away_team, tm.away_label),
        kickoffAt: tm.kickoff_at,
        published: tm.finished === 1 && tm.home_score !== null && tm.away_score !== null,
      }
    : null;

  return {
    active: trigger?.published ?? false,
    trigger,
    affected,
    affectedCount: affected.length,
    pointsRemoved,
  };
}

// -------- wrapped --------

export interface RankingItem {
  position: number;
  apodo: string;
  value: number | string;
  isMe?: boolean;
}

export interface GlobalAward {
  id: string;
  name: string;
  emoji: string;
  description: string;
  ranking: RankingItem[];
}

export interface StatCategory<T> {
  name: string;
  value: T;
  position: number;
  total: number;
  description?: string;
}

export interface WrappedStats {
  bestDay: StatCategory<{ date: string; points: number; description: string }>;
  worstDay: StatCategory<{ date: string; points: number; description: string }>;
  longestWinStreak: StatCategory<{ count: number }>;
  longestLossStreak: StatCategory<{ count: number }>;
  exactPercentage: StatCategory<{ exact: number; partial: number; percentage: number }>;
  luckyTeam: StatCategory<{ name: string; points: number }> | null;
  cursedTeam: StatCategory<{ name: string; points: number }> | null;
  draws: StatCategory<{ predicted: number; actual: number }>;
  favoriteScore: StatCategory<{ score: string; count: number }>;
  gloryMatch: StatCategory<{ match: string; prediction: string }> | null;
  position: number;
  totalPoints: number;
  awards: {
    id: string;
    name: string;
    emoji: string;
    description: string;
  }[];
  globalAwards: GlobalAward[];
}

export async function calculateWrapped(userId: number): Promise<WrappedStats | null> {
  const teams = await loadTeamMap();
  const score = await activeScorer();

  // obtener todas las predicciones del usuario con sus matches
  const rows = await dbAll<Record<string, unknown>>(
    `SELECT m.*, p.home_score AS p_home, p.away_score AS p_away, p.advances AS p_advances
     FROM predictions p
     JOIN matches m ON m.id = p.match_id
     WHERE p.user_id = ? AND m.finished = 1 AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
     ORDER BY m.kickoff_at, m.id`,
    [userId]
  );

  if (rows.length === 0) return null;

  const matches = rows.map((r) => {
    const shaped = shapeMatch(r as never, teams);
    const pred = { home: Number(r.p_home), away: Number(r.p_away) };
    const pts = score(pred, { home: shaped.homeScore!, away: shaped.awayScore! });
    return { shaped, pred, pts, home_team: (r.home_team as string | null), away_team: (r.away_team as string | null) };
  });

  // estadísticas por día
  const pointsByDay = new Map<string, number>();
  const dayOrder: string[] = [];
  for (const m of matches) {
    const date = m.shaped.kickoffAt.split("T")[0];
    if (!dayOrder.includes(date)) dayOrder.push(date);
    pointsByDay.set(date, (pointsByDay.get(date) ?? 0) + m.pts);
  }
  const daysArray = Array.from(pointsByDay.entries()).sort((a, b) => b[1] - a[1]);
  const bestDay = daysArray[0] || ["", 0];
  const worstDay = daysArray[daysArray.length - 1] || ["", 0];

  // Mapear fechas a números de jornada
  const dateToJornada = new Map<string, number>();
  dayOrder.forEach((date, idx) => dateToJornada.set(date, idx + 1));

  // Función para describir la etapa de un match
  const stageNames: Record<string, string> = {
    group: "Fase de Grupos",
    r32: "32avos de Final",
    r16: "16avos de Final",
    qf: "Cuartos de Final",
    sf: "Semifinal",
    third: "Tercer Puesto",
    final: "Final",
  };

  const getStageDescription = (m: (typeof matches)[0]): string => {
    const stage = stageNames[m.shaped.stage] || m.shaped.stage;
    if (m.shaped.stage === "group" && m.shaped.grp) {
      // Contar cuál es el partido N dentro del grupo
      const groupMatches = matches.filter(
        (x) => x.shaped.stage === "group" && x.shaped.grp === m.shaped.grp
      );
      const matchIndex = groupMatches.findIndex((x) => x.shaped.id === m.shaped.id) + 1;
      const jornadas = ["1°", "2°", "3°"];
      return `${stage}, Jornada ${jornadas[matchIndex - 1] || matchIndex}`;
    }
    return stage;
  };

  // rachas
  let maxWinStreak = 0,
    currentWinStreak = 0;
  let maxLossStreak = 0,
    currentLossStreak = 0;
  for (const m of matches) {
    if (m.pts === 5) {
      currentWinStreak++;
      maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
      currentLossStreak = 0;
    } else {
      currentLossStreak++;
      maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
      currentWinStreak = 0;
    }
  }

  // porcentaje exactos
  const exactCount = matches.filter((m) => m.pts === 5).length;
  const partialCount = matches.filter((m) => m.pts === 3 || m.pts === 4).length;
  const exactPercentage = ((exactCount / matches.length) * 100).toFixed(1);

  // equipo amuleto y maldito: contar los equipos en los que aparecían en las predicciones
  const pointsByTeam = new Map<string, { name: string; points: number; count: number }>();
  for (const m of matches) {
    for (const teamId of [m.home_team, m.away_team]) {
      if (!teamId) continue;
      const team = teams.get(teamId);
      if (!team) continue;
      const current = pointsByTeam.get(teamId) ?? { name: team.name, points: 0, count: 0 };
      current.points += m.pts;
      current.count++;
      pointsByTeam.set(teamId, current);
    }
  }
  const teamsArray = Array.from(pointsByTeam.values()).filter((t) => t.count >= 2);
  const luckyTeam = teamsArray.sort((a, b) => b.points / b.count - a.points / a.count)[0];
  const cursedTeam = teamsArray.sort((a, b) => a.points / a.count - b.points / b.count)[0];

  // empates
  let predictedDraws = 0,
    actualDraws = 0;
  for (const m of matches) {
    if (m.pred.home === m.pred.away) predictedDraws++;
    if (m.shaped.homeScore === m.shaped.awayScore) actualDraws++;
  }

  // marcador favorito
  const scoreFreq = new Map<string, number>();
  for (const m of matches) {
    const key = `${m.pred.home}-${m.pred.away}`;
    scoreFreq.set(key, (scoreFreq.get(key) ?? 0) + 1);
  }
  const favoriteScore = Array.from(scoreFreq.entries()).sort((a, b) => b[1] - a[1])[0];

  // partido de gloria: donde fue único en acertar
  let gloryMatch: { match: string; prediction: string } | null = null;
  for (const m of matches) {
    if (m.pts === 5) {
      const allPreds = await dbAll<{ count: number }>(
        `SELECT COUNT(*) as count FROM predictions p
         JOIN matches m2 ON m2.id = p.match_id
         WHERE p.match_id = ? AND m2.finished = 1
           AND p.home_score = ? AND p.away_score = ?`,
        [m.shaped.id, m.shaped.homeScore, m.shaped.awayScore]
      );
      if (allPreds[0]?.count === 1) {
        gloryMatch = {
          match: `${m.shaped.home?.name || m.shaped.homeLabel} vs ${m.shaped.away?.name || m.shaped.awayLabel}`,
          prediction: `${m.pred.home}-${m.pred.away}`,
        };
        break;
      }
    }
  }

  // posición en leaderboard
  const leaders = await leaderboard();
  const myPos = leaders.findIndex((l) => l.userId === userId) + 1;
  const totalPoints = leaders.find((l) => l.userId === userId)?.total ?? 0;

  // awards (premios)
  const awards: WrappedStats["awards"] = [];

  // El Oráculo: top 3 en exactos
  const exactRanking = leaders.sort((a, b) => b.exactCount - a.exactCount);
  if (exactRanking.slice(0, 3).some((l) => l.userId === userId)) {
    awards.push({
      id: "oraculo",
      name: "El Oráculo",
      emoji: "🏆",
      description: "Entre los 3 con más marcadores exactos",
    });
  }

  // La Moneda: ~50% acierto
  if (Math.abs(parseFloat(exactPercentage) - 50) < 5) {
    awards.push({
      id: "moneda",
      name: "La Moneda",
      emoji: "🪙",
      description: "Sus aciertos parecen al azar (~50%)",
    });
  }

  // El Constante: nunca fue primero pero nunca último
  if (myPos > 1 && myPos < leaders.length) {
    awards.push({
      id: "constante",
      name: "El Constante",
      emoji: "🐢",
      description: "Nunca fue primero pero nunca fue último",
    });
  }

  // El Optimista: goleadas predichas
  const goleadas = matches.filter((m) => m.pred.home >= 3 || m.pred.away >= 3).length;
  if (goleadas >= matches.length * 0.3) {
    awards.push({
      id: "optimista",
      name: "El Optimista",
      emoji: "📉",
      description: "Siempre apostó a goleadas que nunca pasaron",
    });
  }

  // Crear premios globales para cada categoría
  const globalAwards: GlobalAward[] = [
    {
      id: "exactos",
      name: "🎯 Más exactos",
      emoji: "🎯",
      description: "Quien más marcadores exactos acertó",
      ranking: leaders
        .map((l, idx) => ({
          position: idx + 1,
          apodo: l.apodo,
          value: l.exactCount,
          isMe: l.userId === userId,
        }))
        .slice(0, 4),
    },
  ];

  const bestJornada = dateToJornada.get(bestDay[0]) ?? 0;
  const worstJornada = dateToJornada.get(worstDay[0]) ?? 0;

  // Obtener descripción de etapa para mejor y peor día
  const getBestDayStage = () => {
    const m = matches.find((x) => x.shaped.kickoffAt.split("T")[0] === bestDay[0]);
    return m ? getStageDescription(m) : "Jornada";
  };
  const getWorstDayStage = () => {
    const m = matches.find((x) => x.shaped.kickoffAt.split("T")[0] === worstDay[0]);
    return m ? getStageDescription(m) : "Jornada";
  };

  return {
    bestDay: {
      name: "Mejor jornada",
      value: { date: bestDay[0], points: bestDay[1], description: `Jornada ${bestJornada}` },
      position: 1,
      total: daysArray.length,
      description: `${getBestDayStage()}: ${bestDay[1]} puntos`,
    },
    worstDay: {
      name: "Peor jornada",
      value: { date: worstDay[0], points: worstDay[1], description: `Jornada ${worstJornada}` },
      position: daysArray.length,
      total: daysArray.length,
      description: `${getWorstDayStage()}: ${worstDay[1]} puntos`,
    },
    longestWinStreak: {
      name: "Racha ganadora",
      value: { count: maxWinStreak },
      position: 1,
      total: 1,
      description: `${maxWinStreak} aciertos exactos seguidos`,
    },
    longestLossStreak: {
      name: "Racha perdedora",
      value: { count: maxLossStreak },
      position: 1,
      total: 1,
      description: `${maxLossStreak} errores sin acertar exacto`,
    },
    exactPercentage: {
      name: "Exactitud",
      value: { exact: exactCount, partial: partialCount, percentage: parseFloat(exactPercentage) },
      position: 1,
      total: 1,
      description: `${exactCount} exactos, ${partialCount} parciales (${exactPercentage}% exactitud)`,
    },
    luckyTeam: luckyTeam
      ? {
          name: "Equipo amuleto",
          value: { name: luckyTeam.name, points: luckyTeam.points },
          position: 1,
          total: 1,
          description: `${luckyTeam.name}: ${(luckyTeam.points / luckyTeam.count).toFixed(1)} pts/partido`,
        }
      : null,
    cursedTeam: cursedTeam
      ? {
          name: "Equipo maldito",
          value: { name: cursedTeam.name, points: cursedTeam.points },
          position: 1,
          total: 1,
          description: `${cursedTeam.name}: ${(cursedTeam.points / cursedTeam.count).toFixed(1)} pts/partido`,
        }
      : null,
    draws: {
      name: "Empates",
      value: { predicted: predictedDraws, actual: actualDraws },
      position: 1,
      total: 1,
      description: `Predijiste ${predictedDraws} empates, hubo ${actualDraws}`,
    },
    favoriteScore: favoriteScore
      ? {
          name: "Marcador favorito",
          value: { score: favoriteScore[0], count: favoriteScore[1] },
          position: 1,
          total: 1,
          description: `${favoriteScore[0]} (${favoriteScore[1]} veces)`,
        }
      : {
          name: "Marcador favorito",
          value: { score: "N/A", count: 0 },
          position: 1,
          total: 1,
          description: "Sin datos",
        },
    gloryMatch: gloryMatch
      ? {
          name: "Momento de gloria",
          value: gloryMatch,
          position: 1,
          total: 1,
          description: `Fuiste el único en acertar ${gloryMatch.prediction}`,
        }
      : null,
    position: myPos,
    totalPoints,
    awards,
    globalAwards,
  };
}

export async function getEvolution(userId: number): Promise<Array<{ jornada: number; date: string; stage: string; position: number; points: number }> | null> {
  const teams = await loadTeamMap();
  const score = await activeScorer();

  const rows = await dbAll<Record<string, unknown>>(
    `SELECT m.*, p.home_score AS p_home, p.away_score AS p_away
     FROM predictions p
     JOIN matches m ON m.id = p.match_id
     WHERE p.user_id = ? AND m.finished = 1 AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
     ORDER BY m.kickoff_at, m.id`,
    [userId]
  );

  if (rows.length === 0) return null;

  // Obtener todas las predicciones de todos los usuarios
  const allPreds = await dbAll<Record<string, unknown>>(
    `SELECT p.user_id, p.home_score AS p_home, p.away_score AS p_away, m.id as match_id, m.finished, m.home_score, m.away_score, m.kickoff_at
     FROM predictions p
     JOIN matches m ON m.id = p.match_id
     WHERE m.finished = 1 AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
     ORDER BY m.kickoff_at, m.id`
  );

  // Agrupar predicciones por fecha
  const dateOrder: string[] = [];
  const matchesByDate = new Map<string, Record<string, unknown>[]>();
  for (const p of allPreds) {
    const date = (p.kickoff_at as string).split("T")[0];
    if (!dateOrder.includes(date)) dateOrder.push(date);
    if (!matchesByDate.has(date)) matchesByDate.set(date, []);
    matchesByDate.get(date)!.push(p);
  }

  // Calcular evolución por jornada
  const evolution: Array<{ jornada: number; date: string; stage: string; position: number; points: number }> = [];
  let cumulativePoints = new Map<number, number>();

  for (let i = 0; i < dateOrder.length; i++) {
    const date = dateOrder[i];
    const jornada = i + 1;
    const matchesOnDate = matchesByDate.get(date) || [];

    // Calcular puntos de esta jornada
    for (const p of matchesOnDate) {
      const pred = { home: Number(p.p_home), away: Number(p.p_away) };
      const pts = score(pred, { home: Number(p.home_score), away: Number(p.away_score) });
      const uid = Number(p.user_id);
      cumulativePoints.set(uid, (cumulativePoints.get(uid) ?? 0) + pts);
    }

    // Calcular posición del usuario en esta jornada
    const ranking = Array.from(cumulativePoints.entries())
      .map(([id, pts]) => ({ id, pts }))
      .sort((a, b) => b.pts - a.pts);
    const userRank = ranking.findIndex((r) => r.id === userId) + 1;
    const userPoints = cumulativePoints.get(userId) ?? 0;

    // Obtener stage description de algún match de esta fecha
    const sampleMatch = rows.find((r) => (r.kickoff_at as string).split("T")[0] === date);
    let stage = "Jornada";
    if (sampleMatch) {
      const shaped = shapeMatch(sampleMatch as never, teams);
      const stageNames: Record<string, string> = {
        group: "Fase de Grupos",
        r32: "32avos de Final",
        r16: "16avos de Final",
        qf: "Cuartos de Final",
        sf: "Semifinal",
        third: "Tercer Puesto",
        final: "Final",
      };
      stage = stageNames[shaped.stage] || shaped.stage;
      if (shaped.stage === "group" && shaped.grp) {
        const groupMatches = rows.filter((x) => {
          const xshaped = shapeMatch(x as never, teams);
          return xshaped.stage === "group" && xshaped.grp === shaped.grp;
        });
        const matchIndex = groupMatches.findIndex((x) => (x.kickoff_at as string).split("T")[0] === date) + 1;
        const jornadas = ["1°", "2°", "3°"];
        stage = `${stage}, Jornada ${jornadas[matchIndex - 1] || matchIndex}`;
      }
    }

    evolution.push({
      jornada,
      date,
      stage,
      position: userRank,
      points: userPoints,
    });
  }

  return evolution;
}
