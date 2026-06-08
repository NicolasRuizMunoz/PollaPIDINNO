import "dotenv/config";
import express from "express";
import type { Response, NextFunction } from "express";
import cors from "cors";
import { db, initSchema, getSetting, setSetting } from "./db.js";
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
  refreshTeamCache,
  shapeMatch,
  allMatches,
  isMatchLocked,
  areBonosLocked,
  bonosDeadline,
  leaderboard,
  type TeamRow,
} from "./queries.js";
import {
  groupStandings,
  bestThirds,
  resolveBracket,
} from "./advancement.js";
import { scoreMatch } from "./scoring.js";

initSchema();
refreshTeamCache();

const app = express();
app.use(cors());
app.use(express.json());
app.use(attachUser);

const ok = <T>(res: Response, data: T) => res.json(data);

// envoltorio para handlers async (express 4 no atrapa promesas rechazadas)
const ah =
  (fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<void>) =>
  (req: AuthedRequest, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);

const publicUser = (u: { id: number; email: string; apodo: string; is_admin: number }) => ({
  id: u.id,
  email: u.email,
  apodo: u.apodo,
  isAdmin: !!u.is_admin,
});

// ---------------------------------------------------------------- auth

// el frontend pregunta si Google esta configurado o si usa login de desarrollo
app.get("/api/config", (_req, res) => {
  ok(res, {
    googleClientId: GOOGLE_CLIENT_ID || null,
    devLogin: !GOOGLE_CLIENT_ID,
  });
});

// login con Google (envia el ID token del boton de Google)
app.post(
  "/api/auth/google",
  ah(async (req, res) => {
    const { idToken } = req.body ?? {};
    const { token, user, needsApodo: na } = await loginWithGoogle(idToken);
    ok(res, { token, user: publicUser(user), needsApodo: na });
  })
);

// login de desarrollo (solo activo cuando Google no esta configurado)
app.post("/api/auth/dev", (req, res) => {
  const { email } = req.body ?? {};
  if (typeof email !== "string") throw new HttpError(400, "Falta el email");
  const { token, user, needsApodo: na } = loginDev(email);
  ok(res, { token, user: publicUser(user), needsApodo: na });
});

app.get("/api/me", requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  ok(res, { ...publicUser(u), needsApodo: needsApodo(u) });
});

// asignar / cambiar el apodo
app.put("/api/me", requireAuth, (req: AuthedRequest, res) => {
  const { apodo } = req.body ?? {};
  if (typeof apodo !== "string") throw new HttpError(400, "Falta el apodo");
  const u = setApodo(req.user!.id, apodo);
  ok(res, { ...publicUser(u), needsApodo: needsApodo(u) });
});

// ---------------------------------------------------------------- teams

app.get("/api/teams", (_req, res) => {
  const teams = db
    .prepare("SELECT * FROM teams ORDER BY grp, name")
    .all() as unknown as TeamRow[];
  ok(res, teams);
});

// ---------------------------------------------------------------- fixture

app.get("/api/matches", (req: AuthedRequest, res) => {
  const matches = allMatches().map(shapeMatch);
  let myPreds: Record<number, { home: number; away: number }> = {};
  if (req.user) {
    const rows = db
      .prepare(
        "SELECT match_id, home_score, away_score FROM predictions WHERE user_id = ?"
      )
      .all(req.user.id) as {
      match_id: number;
      home_score: number;
      away_score: number;
    }[];
    for (const r of rows)
      myPreds[r.match_id] = { home: r.home_score, away: r.away_score };
  }
  ok(res, { matches, myPredictions: myPreds });
});

// guardar / actualizar una prediccion
app.put("/api/predictions/:matchId", requireAuth, (req: AuthedRequest, res) => {
  const matchId = Number(req.params.matchId);
  const { home, away } = req.body ?? {};
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0)
    throw new HttpError(400, "Marcador invalido");

  const match = db
    .prepare("SELECT id, kickoff_at, home_team, away_team FROM matches WHERE id = ?")
    .get(matchId) as
    | { id: number; kickoff_at: string; home_team: string | null; away_team: string | null }
    | undefined;
  if (!match) throw new HttpError(404, "Partido no existe");
  if (!match.home_team || !match.away_team)
    throw new HttpError(409, "Los equipos de este partido aun no estan definidos");
  if (isMatchLocked(match.kickoff_at))
    throw new HttpError(403, "El partido ya empezo, no puedes predecir");

  db.prepare(
    `INSERT INTO predictions (user_id, match_id, home_score, away_score, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, match_id)
     DO UPDATE SET home_score = excluded.home_score,
                   away_score = excluded.away_score,
                   updated_at = datetime('now')`
  ).run(req.user!.id, matchId, home, away);
  ok(res, { home, away });
});

// quien predijo un partido.
//  - antes de publicar el resultado: solo los apodos (sin marcadores)
//  - cuando el admin publica el resultado real: el pronostico de cada uno + sus puntos
app.get("/api/matches/:id/predictions", (req, res) => {
  const matchId = Number(req.params.id);
  const match = db
    .prepare("SELECT id, home_score, away_score, finished FROM matches WHERE id = ?")
    .get(matchId) as
    | { id: number; home_score: number | null; away_score: number | null; finished: number }
    | undefined;
  if (!match) throw new HttpError(404, "Partido no existe");

  const rows = db
    .prepare(
      `SELECT u.apodo, p.home_score, p.away_score
       FROM predictions p JOIN users u ON u.id = p.user_id
       WHERE p.match_id = ? ORDER BY u.apodo`
    )
    .all(matchId) as { apodo: string; home_score: number; away_score: number }[];

  const revealed =
    !!match.finished && match.home_score !== null && match.away_score !== null;

  if (!revealed) {
    // solo se muestra quien ya confirmo, no el marcador que puso
    ok(res, {
      revealed: false,
      count: rows.length,
      confirmed: rows.map((r) => ({ apodo: r.apodo })),
    });
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
});

// ---------------------------------------------------------------- bonos

app.get("/api/tournament", (req: AuthedRequest, res) => {
  const locked = areBonosLocked();
  let mine = null;
  if (req.user) {
    mine = db
      .prepare("SELECT champion, runner_up, top_scorer, best_goalkeeper FROM tournament_picks WHERE user_id = ?")
      .get(req.user.id) ?? null;
  }
  // los resultados oficiales solo se muestran una vez cerrados los bonos
  const results = locked
    ? {
        champion: getSetting("result_champion"),
        runnerUp: getSetting("result_runner_up"),
        topScorer: getSetting("result_top_scorer"),
        bestGoalkeeper: getSetting("result_best_goalkeeper"),
      }
    : null;
  ok(res, { locked, deadline: bonosDeadline(), mine, results });
});

app.put("/api/tournament", requireAuth, (req: AuthedRequest, res) => {
  if (areBonosLocked())
    throw new HttpError(403, "Los bonos ya estan cerrados");
  const { champion, runnerUp, topScorer, bestGoalkeeper } = req.body ?? {};
  const str = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  db.prepare(
    `INSERT INTO tournament_picks (user_id, champion, runner_up, top_scorer, best_goalkeeper, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       champion = excluded.champion,
       runner_up = excluded.runner_up,
       top_scorer = excluded.top_scorer,
       best_goalkeeper = excluded.best_goalkeeper,
       updated_at = datetime('now')`
  ).run(
    req.user!.id,
    str(champion),
    str(runnerUp),
    str(topScorer),
    str(bestGoalkeeper)
  );
  ok(res, { saved: true });
});

// ---------------------------------------------------------------- tabla

app.get("/api/leaderboard", (_req, res) => {
  ok(res, leaderboard());
});

// posiciones de los grupos + clasificados (1º, 2º y 8 mejores terceros)
app.get("/api/standings", (_req, res) => {
  const standings = groupStandings();
  const thirds = bestThirds(standings);
  const thirdSet = new Set(thirds);
  const teams = db.prepare("SELECT id, name, flag FROM teams").all() as unknown as {
    id: string;
    name: string;
    flag: string | null;
  }[];
  const teamMap = new Map(teams.map((t) => [t.id, t]));

  const groups = Object.entries(standings)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([grp, table]) => ({
      grp,
      rows: table.map((s, idx) => ({
        ...s,
        name: teamMap.get(s.teamId)?.name ?? s.teamId,
        flag: teamMap.get(s.teamId)?.flag ?? null,
        qualifies: idx < 2 || thirdSet.has(s.teamId), // 1º, 2º o mejor 3º
        position: idx + 1,
      })),
    }));

  ok(res, {
    groups,
    bestThirds: thirds.map((id) => ({
      id,
      name: teamMap.get(id)?.name ?? id,
      flag: teamMap.get(id)?.flag ?? null,
    })),
  });
});

// ---------------------------------------------------------------- admin

app.put("/api/admin/matches/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { homeScore, awayScore, finished, kickoffAt, homeTeam, awayTeam, venue } =
    req.body ?? {};
  const match = db.prepare("SELECT id FROM matches WHERE id = ?").get(id);
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
  db.prepare(`UPDATE matches SET ${sets.join(", ")} WHERE id = ?`).run(...(vals as any[]));

  // recalcular el cuadro: rellena las eliminatorias con los nuevos resultados
  const assigned = resolveBracket();
  const updated = db.prepare("SELECT * FROM matches WHERE id = ?").get(id) as any;
  ok(res, { match: shapeMatch(updated), bracketAssigned: assigned });
});

// recalcular todo el cuadro desde cero (util si se corrige un resultado de grupos)
app.post("/api/admin/recalcular", requireAdmin, (_req, res) => {
  const assigned = resolveBracket(true);
  ok(res, { assigned });
});

app.put("/api/admin/tournament-results", requireAdmin, (req, res) => {
  const { champion, runnerUp, topScorer, bestGoalkeeper } = req.body ?? {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  setSetting("result_champion", str(champion));
  setSetting("result_runner_up", str(runnerUp));
  setSetting("result_top_scorer", str(topScorer));
  setSetting("result_best_goalkeeper", str(bestGoalkeeper));
  ok(res, { saved: true });
});

app.put("/api/admin/settings", requireAdmin, (req, res) => {
  const { bonosDeadline: deadline } = req.body ?? {};
  if (deadline !== undefined) setSetting("bonos_deadline", deadline || null);
  ok(res, { saved: true });
});

app.get("/api/admin/users", requireAdmin, (_req, res) => {
  const users = db
    .prepare("SELECT id, email, apodo, is_admin, created_at FROM users ORDER BY id")
    .all();
  ok(res, users);
});

// ---------------------------------------------------------------- errores

app.use(
  (err: unknown, _req: AuthedRequest, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
);

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => {
  console.log(`API de la polla escuchando en http://localhost:${PORT}`);
});
