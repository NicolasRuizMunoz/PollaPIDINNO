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
  drawRulePreview,
  drawRuleActive,
  activeScorer,
  displayName,
} from "./queries.js";
import { groupStandings, completeGroups, bestThirds, resolveBracket } from "./advancement.js";
import { updateLiveMatches } from "./live.js";

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
    ok(res, { matches, myPredictions: myPreds, drawRuleActive: await drawRuleActive() });
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

    // Solo usuarios activos: los inactivos no cuentan ni aparecen en la polla
    // (igual que en la tabla de posiciones).
    const rows = await dbAll<{ apodo: string; email: string; home_score: number; away_score: number }>(
      `SELECT u.apodo, u.email, p.home_score, p.away_score
       FROM predictions p JOIN users u ON u.id = p.user_id
       WHERE p.match_id = ? AND u.is_active = 1 ORDER BY u.apodo`,
      [matchId]
    );

    const revealed = !!match.finished && match.home_score !== null && match.away_score !== null;
    if (!revealed) {
      ok(res, { revealed: false, count: rows.length, confirmed: rows.map((r) => ({ apodo: displayName(r.apodo, r.email) })) });
      return;
    }

    const actual = { home: match.home_score!, away: match.away_score! };
    const score = await activeScorer();
    const predictions = rows
      .map((r) => ({
        apodo: displayName(r.apodo, r.email),
        home: r.home_score,
        away: r.away_score,
        points: score({ home: r.home_score, away: r.away_score }, actual),
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

// historial del usuario: todas sus predicciones con resultado real y puntos,
// en el orden en que se juegan (por fecha de kickoff).
app.get(
  "/api/me/predictions",
  requireAuth,
  ah(async (req: AuthedRequest, res) => {
    const teams = await loadTeamMap();
    const score = await activeScorer();
    const rows = await dbAll<Record<string, unknown>>(
      `SELECT m.*, p.home_score AS p_home, p.away_score AS p_away
         FROM predictions p
         JOIN matches m ON m.id = p.match_id
        WHERE p.user_id = ?
        ORDER BY m.kickoff_at, m.id`,
      [req.user!.id]
    );
    const matches = rows.map((r) => {
      const shaped = shapeMatch(r as never, teams);
      const pred = { home: Number(r.p_home), away: Number(r.p_away) };
      const points =
        shaped.finished && shaped.homeScore !== null && shaped.awayScore !== null
          ? score(pred, { home: shaped.homeScore, away: shaped.awayScore })
          : null;
      return { ...shaped, pred, points };
    });
    ok(res, { drawRuleActive: await drawRuleActive(), matches });
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
          "SELECT champion, runner_up, top_scorer, best_goalkeeper, best_player, best_young_player FROM tournament_picks WHERE user_id = ?",
          [req.user.id]
        )) ?? null;
    }
    const results = locked
      ? {
          champion: await getSetting("result_champion"),
          runnerUp: await getSetting("result_runner_up"),
          topScorer: await getSetting("result_top_scorer"),
          bestGoalkeeper: await getSetting("result_best_goalkeeper"),
          bestPlayer: await getSetting("result_best_player"),
          bestYoungPlayer: await getSetting("result_best_young_player"),
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
    const { champion, runnerUp, topScorer, bestGoalkeeper, bestPlayer, bestYoungPlayer } =
      req.body ?? {};
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    await dbRun(
      `INSERT INTO tournament_picks (user_id, champion, runner_up, top_scorer, best_goalkeeper, best_player, best_young_player, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         champion = excluded.champion,
         runner_up = excluded.runner_up,
         top_scorer = excluded.top_scorer,
         best_goalkeeper = excluded.best_goalkeeper,
         best_player = excluded.best_player,
         best_young_player = excluded.best_young_player,
         updated_at = datetime('now')`,
      [
        req.user!.id,
        str(champion),
        str(runnerUp),
        str(topScorer),
        str(bestGoalkeeper),
        str(bestPlayer),
        str(bestYoungPlayer),
      ]
    );
    ok(res, { saved: true });
  })
);

// ---------------------------------------------------------------- en vivo (cron)

// Lo llama un cron externo (cron-job.org, GitHub Actions, etc.) cada ~3 min.
// Se autentica con ?key=CRON_SECRET (o header x-cron-key), o con sesión admin.
app.get(
  "/api/cron/live",
  ah(async (req: AuthedRequest, res) => {
    const secret = process.env.CRON_SECRET;
    const provided =
      (req.query.key as string | undefined) ??
      (req.headers["x-cron-key"] as string | undefined);
    const isAdmin = req.user?.is_admin === 1;
    if (!isAdmin && (!secret || provided !== secret)) {
      throw new HttpError(401, "No autorizado");
    }
    ok(res, await updateLiveMatches());
  })
);

// ---------------------------------------------------------------- tabla / posiciones

app.get(
  "/api/leaderboard",
  ah(async (_req, res) => {
    ok(res, await leaderboard());
  })
);

// Vista previa del cambio de regla del empate (propuesta, aún NO aplicada).
// Solo calcula y muestra el impacto; no toca el puntaje oficial.
app.get(
  "/api/regla-empate",
  ah(async (_req, res) => {
    ok(res, await drawRulePreview());
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
    const { champion, runnerUp, topScorer, bestGoalkeeper, bestPlayer, bestYoungPlayer } =
      req.body ?? {};
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    await setSetting("result_champion", str(champion));
    await setSetting("result_runner_up", str(runnerUp));
    await setSetting("result_top_scorer", str(topScorer));
    await setSetting("result_best_goalkeeper", str(bestGoalkeeper));
    await setSetting("result_best_player", str(bestPlayer));
    await setSetting("result_best_young_player", str(bestYoungPlayer));
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
      "SELECT id, email, apodo, is_admin, is_active, created_at FROM users ORDER BY id"
    );
    ok(res, users);
  })
);

app.put(
  "/api/admin/users/:id/active",
  requireAdmin,
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const { active } = req.body ?? {};
    if (typeof active !== "boolean") throw new HttpError(400, "Falta el campo active");
    await dbRun("UPDATE users SET is_active = ? WHERE id = ?", [active ? 1 : 0, id]);
    ok(res, { id, active });
  })
);

app.delete(
  "/api/admin/users/:id",
  requireAdmin,
  ah(async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, "Id invalido");
    if (req.user!.id === id) throw new HttpError(400, "No puedes eliminar tu propia cuenta");

    const user = await dbGet<{ id: number }>("SELECT id FROM users WHERE id = ?", [id]);
    if (!user) throw new HttpError(404, "Usuario no existe");

    // Borrado explicito de lo asociado (no dependemos de ON DELETE CASCADE,
    // que no siempre se aplica en libSQL/Turso por conexion).
    await dbRun("DELETE FROM predictions WHERE user_id = ?", [id]);
    await dbRun("DELETE FROM tournament_picks WHERE user_id = ?", [id]);
    await dbRun("DELETE FROM sessions WHERE user_id = ?", [id]);
    await dbRun("DELETE FROM users WHERE id = ?", [id]);
    ok(res, { id, deleted: true });
  })
);

app.get(
  "/api/admin/backup",
  requireAdmin,
  ah(async (_req, res) => {
    const [users, matches, predictions, tournamentPicks, settings] = await Promise.all([
      dbAll("SELECT * FROM users ORDER BY id"),
      dbAll("SELECT * FROM matches ORDER BY id"),
      dbAll("SELECT * FROM predictions ORDER BY id"),
      dbAll("SELECT * FROM tournament_picks ORDER BY user_id"),
      dbAll("SELECT * FROM settings"),
    ]);
    const backup = {
      exportedAt: new Date().toISOString(),
      users,
      matches,
      predictions,
      tournamentPicks,
      settings,
    };
    res.setHeader("Content-Disposition", `attachment; filename="polla-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(backup, null, 2));
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
