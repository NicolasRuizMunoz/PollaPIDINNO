// Cliente del API de la polla. Maneja el token en localStorage.

const TOKEN_KEY = "polla_token";
const USER_KEY = "polla_user";

export interface User {
  id: number;
  email: string;
  apodo: string;
  isAdmin: boolean;
}

export interface Team {
  id: string;
  name: string;
  flag: string | null;
}

export type Stage = "group" | "r32" | "r16" | "qf" | "sf" | "third" | "final";

export interface Match {
  id: number;
  code: string | null;
  stage: Stage;
  grp: string | null;
  label: string | null;
  kickoffAt: string;
  venue: string | null;
  home: Team | null;
  away: Team | null;
  homeLabel: string | null;
  awayLabel: string | null;
  homeSrc: string | null;
  awaySrc: string | null;
  homeScore: number | null;
  awayScore: number | null;
  finished: boolean;
  advancer: string | null; // eliminatorias: equipo que el admin marcó que avanza
  locked: boolean;
  status: string | null; // "LIVE" | "HT" | "FT" | "NS" | null
  liveHome: number | null;
  liveAway: number | null;
  minute: number | null;
}

export interface MatchesResponse {
  matches: Match[];
  myPredictions: Record<number, { home: number; away: number; advances: string | null }>;
  drawRuleActive: boolean; // ¿ya rige la regla nueva del empate?
}

// historial del usuario: una predicción con su resultado real y puntos
export interface MyMatch extends Match {
  pred: { home: number; away: number };
  points: number | null; // null si el partido aún no se juega/publica
  advances: string | null; // a quién predijo que pasa (eliminatorias)
  advancePoints: number | null; // +1 si acertó el clasificado (null si no aplica aún)
}

export interface MyMatchesResponse {
  drawRuleActive: boolean;
  matches: MyMatch[];
}

export interface LeaderRow {
  userId: number;
  apodo: string;
  total: number;
  matchPoints: number;
  bonusPoints: number;
  exactCount: number;
  playedPredictions: number;
  livePoints: number;
  liveTotal: number;
}

// "qualified" = clasifica hoy (verde) · "third" = posible mejor tercero (amarillo)
// "eliminated" = ya sin chance (rojo) · "alive" = sigue con opciones (neutro)
export type StandingStatus = "qualified" | "third" | "eliminated" | "alive";

export interface StandingRow {
  teamId: string;
  name: string;
  flag: string | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  status: StandingStatus;
  qualifies: boolean;
  position: number;
}

export interface StandingsResponse {
  groups: { grp: string; rows: StandingRow[] }[];
  bestThirds: Team[];
}

export interface MatchPredictions {
  revealed: boolean;
  count: number;
  // estado del resultado cuando ya está revelado: oficial, en vivo o aún sin resultado
  result?: "final" | "live" | "pending";
  confirmed?: { apodo: string }[];
  match?: { homeScore: number; awayScore: number; finished: boolean } | null;
  advancer?: string | null; // quién avanzó (eliminatorias), si el admin lo marcó
  predictions?: {
    apodo: string;
    home: number;
    away: number;
    advances?: string | null; // a quién predijo que pasa (eliminatorias)
    advancePoints?: number | null; // +1 si acertó (null si aún no se sabe)
    points: number | null;
  }[];
}

// Vista previa del cambio de regla del empate (propuesta, aún NO aplicada).
export interface DrawRuleChange {
  matchId: number;
  stage: Stage;
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
  delta: number;
  changes: DrawRuleChange[];
}

export interface DrawRuleTrigger {
  matchId: number;
  home: string;
  away: string;
  kickoffAt: string;
  published: boolean;
}

export interface DrawRulePreview {
  active: boolean;
  trigger: DrawRuleTrigger | null;
  affected: DrawRuleUser[];
  affectedCount: number;
  pointsRemoved: number;
}

export interface TournamentInfo {
  locked: boolean;
  deadline: string | null;
  mine: {
    champion: string | null;
    runner_up: string | null;
    top_scorer: string | null;
    best_goalkeeper: string | null;
    best_player: string | null;
    best_young_player: string | null;
  } | null;
  results: {
    champion: string | null;
    runnerUp: string | null;
    topScorer: string | null;
    bestGoalkeeper: string | null;
    bestPlayer: string | null;
    bestYoungPlayer: string | null;
  } | null;
}

export interface BonusPrediction {
  count: number;
  users: string[];
}

export interface BonusCategory {
  real: string | null;
  predictions: Record<string, BonusPrediction>;
}

export interface BonusSummary {
  champion: BonusCategory;
  runnerUp: BonusCategory;
  topScorer: BonusCategory;
  bestGoalkeeper: BonusCategory;
  bestPlayer: BonusCategory;
  bestYoungPlayer: BonusCategory;
}

// ---- votaciones ----

export interface PollOption {
  value: string;
  label: string;
}

export interface PollCounts {
  counts: Record<string, number>;
  total: number;
}

export interface Poll {
  key: string;
  question: string;
  options: PollOption[];
  myChoice: string | null;
  resultsPublic: boolean;
  counts: PollCounts | null; // null si el conteo no está revelado para el usuario
}

export interface PollsResponse {
  deadline: string | null;
  locked: boolean;
  showResults: boolean; // ¿el admin tiene encendido mostrar resultados a todos?
  polls: Poll[];
}

export interface AdminPoll extends PollCounts {
  key: string;
  question: string;
  options: PollOption[];
  resultsPublic: boolean;
}

export interface AdminPollsResponse {
  deadline: string | null;
  showResults: boolean;
  polls: AdminPoll[];
}

// ---- wrapped ----

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

export interface EvolutionEntry {
  jornada: number;
  date: string;
  stage: string;
  position: number;
  points: number;
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

// ---- sesion ----

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function getUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as User) : null;
}
export function setSession(token: string, user: User): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// ---- fetch base ----

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ---- endpoints ----

// Timeline data structures
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

export const api = {
  config: () => req<{ googleClientId: string | null; devLogin: boolean }>("/config"),

  loginGoogle: (idToken: string) =>
    req<{ token: string; user: User; needsApodo: boolean }>("/auth/google", {
      method: "POST",
      body: JSON.stringify({ idToken }),
    }),

  loginDev: (email: string) =>
    req<{ token: string; user: User; needsApodo: boolean }>("/auth/dev", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  me: () => req<User & { needsApodo: boolean }>("/me"),

  setApodo: (apodo: string) =>
    req<User & { needsApodo: boolean }>("/me", {
      method: "PUT",
      body: JSON.stringify({ apodo }),
    }),

  teams: () => req<(Team & { grp: string | null })[]>("/teams"),

  matches: () => req<MatchesResponse>("/matches"),

  myMatches: () => req<MyMatchesResponse>("/me/predictions"),

  wrapped: () => req<WrappedStats>("/me/wrapped"),

  evolution: () => req<EvolutionEntry[]>("/me/evolution"),

  // `advances` (eliminatorias): undefined = no tocar; null = borrar; id = fijar.
  savePrediction: (matchId: number, home: number, away: number, advances?: string | null) =>
    req<{ home: number; away: number; advances?: string | null }>(`/predictions/${matchId}`, {
      method: "PUT",
      body: JSON.stringify({ home, away, ...(advances !== undefined ? { advances } : {}) }),
    }),

  matchPredictions: (matchId: number) =>
    req<MatchPredictions>(`/matches/${matchId}/predictions`),

  leaderboard: () => req<LeaderRow[]>("/leaderboard"),

  leaderboardTimeline: () => req<LeaderboardTimelineData>("/leaderboard/timeline"),

  reglaEmpate: () => req<DrawRulePreview>("/regla-empate"),

  standings: () => req<StandingsResponse>("/standings"),

  tournament: () => req<TournamentInfo>("/tournament"),

  bonosSummary: () => req<BonusSummary>("/bonos/summary"),

  polls: () => req<PollsResponse>("/polls"),

  votePoll: (key: string, choice: string) =>
    req<{ saved: boolean; choice: string }>(`/polls/${key}/vote`, {
      method: "PUT",
      body: JSON.stringify({ choice }),
    }),

  saveTournament: (picks: {
    champion: string | null;
    runnerUp: string | null;
    topScorer: string | null;
    bestGoalkeeper: string | null;
    bestPlayer: string | null;
    bestYoungPlayer: string | null;
  }) =>
    req<{ saved: boolean }>("/tournament", {
      method: "PUT",
      body: JSON.stringify(picks),
    }),

  // admin
  adminUpdateMatch: (
    id: number,
    data: Partial<{
      homeScore: number | null;
      awayScore: number | null;
      finished: boolean;
      kickoffAt: string;
      homeTeam: string | null;
      awayTeam: string | null;
      venue: string | null;
      advancer: string | null;
    }>
  ) =>
    req<{ match: Match; bracketAssigned: number }>(`/admin/matches/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  adminRecalcular: () =>
    req<{ assigned: number }>("/admin/recalcular", { method: "POST" }),

  adminTournamentResults: (data: {
    champion: string | null;
    runnerUp: string | null;
    topScorer: string | null;
    bestGoalkeeper: string | null;
    bestPlayer: string | null;
    bestYoungPlayer: string | null;
  }) =>
    req<{ saved: boolean }>("/admin/tournament-results", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  adminSettings: (data: {
    bonosDeadline?: string | null;
    pollsDeadline?: string | null;
    showPollResults?: boolean;
  }) =>
    req<{ saved: boolean }>("/admin/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  adminPolls: () => req<AdminPollsResponse>("/admin/polls"),

  adminSetPollResults: (key: string, resultsPublic: boolean) =>
    req<{ key: string; resultsPublic: boolean }>(`/admin/polls/${key}`, {
      method: "PUT",
      body: JSON.stringify({ resultsPublic }),
    }),

  adminUsers: () =>
    req<{ id: number; email: string; apodo: string; is_admin: number; is_active: number; created_at: string }[]>(
      "/admin/users"
    ),

  adminSetUserActive: (id: number, active: boolean) =>
    req<{ id: number; active: boolean }>(`/admin/users/${id}/active`, {
      method: "PUT",
      body: JSON.stringify({ active }),
    }),

  adminDeleteUser: (id: number) =>
    req<{ id: number; deleted: boolean }>(`/admin/users/${id}`, {
      method: "DELETE",
    }),

  adminBackup: async (): Promise<Blob> => {
    const token = getToken();
    const res = await fetch("/api/admin/backup", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let msg = `Error ${res.status}`;
      try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.blob();
  },
};
