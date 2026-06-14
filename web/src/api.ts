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
  locked: boolean;
  status: string | null; // "LIVE" | "HT" | "FT" | "NS" | null
  liveHome: number | null;
  liveAway: number | null;
  minute: number | null;
}

export interface MatchesResponse {
  matches: Match[];
  myPredictions: Record<number, { home: number; away: number }>;
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
  confirmed?: { apodo: string }[];
  match?: { homeScore: number; awayScore: number; finished: boolean };
  predictions?: { apodo: string; home: number; away: number; points: number }[];
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

  savePrediction: (matchId: number, home: number, away: number) =>
    req<{ home: number; away: number }>(`/predictions/${matchId}`, {
      method: "PUT",
      body: JSON.stringify({ home, away }),
    }),

  matchPredictions: (matchId: number) =>
    req<MatchPredictions>(`/matches/${matchId}/predictions`),

  leaderboard: () => req<LeaderRow[]>("/leaderboard"),

  standings: () => req<StandingsResponse>("/standings"),

  tournament: () => req<TournamentInfo>("/tournament"),

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

  adminSettings: (data: { bonosDeadline: string | null }) =>
    req<{ saved: boolean }>("/admin/settings", {
      method: "PUT",
      body: JSON.stringify(data),
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
