import express from "express";
import type { Response, NextFunction } from "express";
import cors from "cors";
import { dbAll, dbGet, dbRun, getSetting, setSetting, ensureSchema } from "./db.js";
import {
  attachUser,
  requireAuth,
  requireAdmin,
  loginWithGoogle,
  loginDev,
  setApodo,
  needsApodo,
  GOOGLE_CLIENT_ID,
  HttpError,
  type AuthedRequest,
} from "./auth.js";
import {
  loadTeamMap,
  shapeMatch,
  allMatches,
  isMatchLocked,
  areBonosLocked,
  bonosDeadline,
  leaderboard,
} from "./queries.js";
import { groupStandings, completeGroups, bestThirds, resolveBracket } from "./advancement.js";
import { scoreMatch } from "./scoring.js";

export const app = express();
app.use(cors());
app.use(express.json());

// En Vercel la función vive bajo /api; según cómo enrute, req.url puede llegar
// con o sin el prefijo "/api". Lo normalizamos para que las rutas calcen siempre.
app.use((req, _res, next) => {
  if (!req.url.startsWith("/api")) {
    req.url = "/api" + (req.url.startsWith("/") ? req.url : "/" + req.url);
  }
  next();
});

// asegura que el esquema exista (una vez por proceso) antes de atender
app.use((_req, _res, next) => {
  ensureSchema().then(() => next()).catch(next);
});

app.use(attachUser);

const ok = <T>(res: Response, data: T) => res.json(data);

// envoltorio para handlers async (express 4 no atrapa promesas rechazadas)
const ah =
  (fn: (req: AuthedRequest, res: Response, next: NextFunction) => unknown) =>
  (req: AuthedRequest, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const publicUser = (u: { id: number; email: string; apodo: string; is_admin: number }) => ({
  id: u.id,
  email: u.email,
  apodo: u.apodo,
  isAdmin: !!u.is_admin,
});

// ---------------------------------------------------------------- auth

app.get("/api/config", (_req, res) => {
  ok(res, { googleClientId: GOOGLE_CLIENT_ID || null, devLogin: !GOOGLE_CLIENT_ID });
});

app.post(
  "/api/auth/google",
  ah(async (req, res) => {
    const { idToken } = req.body ?? {};
    const { token, user, needsApodo: na } = await loginWithGoogle(idToken);
    ok(res, { token, user: publicUser(user), needsApodo: na });
  })
);

app.post(
  "/api/auth/dev",
  ah(async (req, res) => {
    const { email } = req.body ?? {};
    if (typeof email !== "string") throw new HttpError(400, "Falta el email");
    const { token, user, needsApodo: na } = await loginDev(email);
    ok(res, { token, user: publicUser(user), needsApodo: na });
  })
);

app.get("/api/me", requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  ok(res, { ...publicUser(u), needsApodo: needsApodo(u) });
});

app.put(
  "/api/me",
  requireAuth,
  ah(async (req, res) => {
    const { apodo } = req.body ?? {};
    if (typeof apodo !== "string") throw new HttpError(400, "Falta el apodo");
    const u = await setApodo(req.user!.id, apodo);
    ok(res, { ...publicUser(u), needsApodo: needsApodo(u) });
  })
);

// ---------------------------------------------------------------- teams

app.get(
  "/api/teams",
  ah(async (_req, res) => {
    const teams = await dbAll("SELECT * FROM teams ORDER BY grp, name");
    ok(res, teams);
  })
);

// ---------------------------------------------------------------- fixture

app.get(
  "/api/matches",
  ah(async (req: AuthedRequest, res) => {
    const teams = await loadTeamMap();
    const matches = (await allMatches()).map((m) => shapeMatch(m, teams));
    const myPreds: Record<number, { home: number; away: number }> = {};
    if (req.user) {
      const rows = await dbAll<{ match_id: number; home_score: number; away_score: number }>(
        "SELECT match_id, home_score, away_score FROM predictions WHERE user_id = ?",
        [req.user.id]
      );
      for (const r of rows) myPreds[r.match_id] = { home: r.home_score, away: r.away_score };
    }
    ok(res, { matches, myPredictions: myPreds });
  })
);

app.put(
  "/api/predictions/:matchId",
  requireAuth,
  ah(async (req: AuthedRequest, res) => {
    const matchId = Number(req.params.matchId);
    const { home, away } = req.body ?? {};
    if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0)
      throw new HttpError(400, "Marcador invalido");

    const match = await dbGet<{
      id: number;
      kickoff_at: string;
      home_team: string | null;
      away_team: string | null;
    }>("SELECT id, kickoff_at, home_team, away_team FROM matches WHERE id = ?", [matchId]);
    if (!match) throw new HttpError(404, "Partido no existe");
    if (!match.home_team || !match.away_team)
      throw new HttpError(409, "Los equipos de este partido aun no estan definidos");
    if (isMatchLocked(match.kickoff_at))
      throw new HttpError(403, "El partido ya empezo, no puedes predecir");

    await dbRun(
      `INSERT INTO predictions (user_id, match_id, home_score, away_score, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, match_id)
       DO UPDATE SET home_score = excluded.home_score,
                     away_score = excluded.away_score,
                     updated_at = datetime('now')`,
      [req.user!.id, matchId, home, away]
    );
    ok(res, { home, away });
  })
);

// quien predijo un partido (apodos antes de publicar; pronosticos + puntos despues)
app.get(
  "/api/matches/:id/predictions",
  ah(async (req, res) => {
    const matchId = Number(req.params.id);
    const match = await dbGet<{
      id: number;
      home_score: number | null;
      away_score: number | null;
      finished: number;
    }>("SELECT id, home_score, away_score, finished FROM matches WHERE id = ?", [matchId]);
    if (!match) throw new HttpError(404, "Partido no existe");

    const rows = await dbAll<{ apodo: string; home_score: number; away_score: number }>(
      `SELECT u.apodo, p.home_score, p.away_score
       FROM predictions p JOIN users u ON u.id = p.user_id
       WHERE p.match_id = ? ORDER BY u.apodo`,
      [matchId]
    );

    const revealed = !!match.finished && match.home_score !== null && match.away_score !== null;
    if (!revealed) {
      ok(res, { revealed: false, count: rows.length, confirmed: rows.map((r) => ({ apodo: r.apodo })) });
      return;
    }

    const actual = { home: match.home_score!, away: match.away_score! };
    const predictions = rows
      .map((r) => ({
        apodo: r.apodo,
        home: r.home_score,
        away: r.away_score,
        points: scoreMatch({ home: r.home_score, away: r.away_score }, actual),
      }))
      .sort((a, b) => b.points - a.points || a.apodo.localeCompare(b.apodo));

    ok(res, {
      revealed: true,
      count: rows.length,
      match: { homeScore: match.home_score, awayScore: match.away_score, finished: true },
      predictions,
    });
  })
);

// ---------------------------------------------------------------- bonos

app.get(
  "/api/tournament",
  ah(async (req: AuthedRequest, res) => {
    const locked = await areBonosLocked();
    let mine = null;
    if (req.user) {
      mine =
        (await dbGet(
          "SELECT champion, runner_up, top_scorer, best_goalkeeper FROM tournament_picks WHERE user_id = ?",
          [req.user.id]
        )) ?? null;
    }
    const results = locked
      ? {
          champion: await getSetting("result_champion"),
          runnerUp: await getSetting("result_runner_up"),
          topScorer: await getSetting("result_top_scorer"),
          bestGoalkeeper: await getSetting("result_best_goalkeeper"),
        }
      : null;
    ok(res, { locked, deadline: await bonosDeadline(), mine, results });
  })
);

app.put(
  "/api/tournament",
  requireAuth,
  ah(async (req: AuthedRequest, res) => {
    if (await areBonosLocked()) throw new HttpError(403, "Los bonos ya estan cerrados");
    const { champion, runnerUp, topScorer, bestGoalkeeper } = req.body ?? {};
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    await dbRun(
      `INSERT INTO tournament_picks (user_id, champion, runner_up, top_scorer, best_goalkeeper, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         champion = excluded.champion,
         runner_up = excluded.runner_up,
         top_scorer = excluded.top_scorer,
         best_goalkeeper = excluded.best_goalkeeper,
         updated_at = datetime('now')`,
      [req.user!.id, str(champion), str(runnerUp), str(topScorer), str(bestGoalkeeper)]
    );
    ok(res, { saved: true });
  })
);

// ---------------------------------------------------------------- tabla / posiciones

app.get(
  "/api/leaderboard",
  ah(async (_req, res) => {
    ok(res, await leaderboard());
  })
);

app.get(
  "/api/standings",
  ah(async (_req, res) => {
    const standings = await groupStandings();
    const complete = await completeGroups();
    const thirds = bestThirds(standings, complete);
    const thirdSet = new Set(thirds);
    const teams = await loadTeamMap();

    const groups = Object.entries(standings)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([grp, table]) => ({
        grp,
        rows: table.map((s, idx) => ({
          ...s,
          name: teams.get(s.teamId)?.name ?? s.teamId,
          flag: teams.get(s.teamId)?.flag ?? null,
          qualifies: idx < 2 || thirdSet.has(s.teamId),
          position: idx + 1,
        })),
      }));

    ok(res, {
      groups,
      bestThirds: thirds.map((id) => ({
        id,
        name: teams.get(id)?.name ?? id,
        flag: teams.get(id)?.flag ?? null,
      })),
    });
  })
);

// ---------------------------------------------------------------- admin

app.put(
  "/api/admin/matches/:id",
  requireAdmin,
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const { homeScore, awayScore, finished, kickoffAt, homeTeam, awayTeam, venue } =
      req.body ?? {};
    const match = await dbGet("SELECT id FROM matches WHERE id = ?", [id]);
    if (!match) throw new HttpError(404, "Partido no existe");

    const sets: string[] = [];
    const vals: unknown[] = [];
    const push = (col: string, val: unknown) => {
      sets.push(`${col} = ?`);
      vals.push(val);
    };
    if (homeScore !== undefined) push("home_score", homeScore === null ? null : Number(homeScore));
    if (awayScore !== undefined) push("away_score", awayScore === null ? null : Number(awayScore));
    if (finished !== undefined) push("finished", finished ? 1 : 0);
    if (kickoffAt !== undefined) push("kickoff_at", String(kickoffAt));
    if (homeTeam !== undefined) push("home_team", homeTeam || null);
    if (awayTeam !== undefined) push("away_team", awayTeam || null);
    if (venue !== undefined) push("venue", venue || null);
    if (!sets.length) throw new HttpError(400, "Nada que actualizar");

    vals.push(id);
    await dbRun(`UPDATE matches SET ${sets.join(", ")} WHERE id = ?`, vals as never);

    const assigned = await resolveBracket();
    const teams = await loadTeamMap();
    const updated = await dbGet("SELECT * FROM matches WHERE id = ?", [id]);
    ok(res, { match: shapeMatch(updated as never, teams), bracketAssigned: assigned });
  })
);

app.post(
  "/api/admin/recalcular",
  requireAdmin,
  ah(async (_req, res) => {
    ok(res, { assigned: await resolveBracket(true) });
  })
);

app.put(
  "/api/admin/tournament-results",
  requireAdmin,
  ah(async (req, res) => {
    const { champion, runnerUp, topScorer, bestGoalkeeper } = req.body ?? {};
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    await setSetting("result_champion", str(champion));
    await setSetting("result_runner_up", str(runnerUp));
    await setSetting("result_top_scorer", str(topScorer));
    await setSetting("result_best_goalkeeper", str(bestGoalkeeper));
    ok(res, { saved: true });
  })
);

app.put(
  "/api/admin/settings",
  requireAdmin,
  ah(async (req, res) => {
    const { bonosDeadline: deadline } = req.body ?? {};
    if (deadline !== undefined) await setSetting("bonos_deadline", deadline || null);
    ok(res, { saved: true });
  })
);

app.get(
  "/api/admin/users",
  requireAdmin,
  ah(async (_req, res) => {
    const users = await dbAll(
      "SELECT id, email, apodo, is_admin, created_at FROM users ORDER BY id"
    );
    ok(res, users);
  })
);

// ---------------------------------------------------------------- errores

app.use((err: unknown, _req: AuthedRequest, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
});
