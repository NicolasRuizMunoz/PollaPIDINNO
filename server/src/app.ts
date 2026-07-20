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
  isLive,
  areBonosLocked,
  bonosDeadline,
  leaderboard,
  leaderboardTimeline,
  drawRulePreview,
  drawRuleActive,
  activeScorer,
  displayName,
  pollsDeadline,
  arePollsLocked,
  calculateWrapped,
  getEvolution,
} from "./queries.js";
import { groupStandings, bestThirds, eliminatedTeams, resolveBracket } from "./advancement.js";
import { scoreAdvance } from "./scoring.js";
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
    const myPreds: Record<number, { home: number; away: number; advances: string | null }> = {};
    if (req.user) {
      const rows = await dbAll<{ match_id: number; home_score: number; away_score: number; advances: string | null }>(
        "SELECT match_id, home_score, away_score, advances FROM predictions WHERE user_id = ?",
        [req.user.id]
      );
      for (const r of rows) myPreds[r.match_id] = { home: r.home_score, away: r.away_score, advances: r.advances ?? null };
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
      stage: string;
      kickoff_at: string;
      home_team: string | null;
      away_team: string | null;
    }>("SELECT id, stage, kickoff_at, home_team, away_team FROM matches WHERE id = ?", [matchId]);
    if (!match) throw new HttpError(404, "Partido no existe");
    if (!match.home_team || !match.away_team)
      throw new HttpError(409, "Los equipos de este partido aun no estan definidos");
    if (isMatchLocked(match.kickoff_at))
      throw new HttpError(403, "El partido ya empezo, no puedes predecir");

    // "Quién pasa de ronda" (solo eliminatorias): se actualiza SOLO si el body lo
    // trae (así un guardado de marcador no pisa una elección previa). Debe ser uno
    // de los dos equipos, o null para borrarla.
    const includeAdvances =
      match.stage !== "group" &&
      !!req.body &&
      Object.prototype.hasOwnProperty.call(req.body, "advances");
    let advances: string | null = null;
    if (includeAdvances) {
      const a = req.body.advances;
      if (a === null || a === "") advances = null;
      else if (a === match.home_team || a === match.away_team) advances = a;
      else throw new HttpError(400, "El equipo que avanza debe ser uno de los dos del partido");
    }

    if (includeAdvances) {
      await dbRun(
        `INSERT INTO predictions (user_id, match_id, home_score, away_score, advances, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, match_id)
         DO UPDATE SET home_score = excluded.home_score,
                       away_score = excluded.away_score,
                       advances   = excluded.advances,
                       updated_at = datetime('now')`,
        [req.user!.id, matchId, home, away, advances]
      );
    } else {
      await dbRun(
        `INSERT INTO predictions (user_id, match_id, home_score, away_score, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, match_id)
         DO UPDATE SET home_score = excluded.home_score,
                       away_score = excluded.away_score,
                       updated_at = datetime('now')`,
        [req.user!.id, matchId, home, away]
      );
    }
    ok(res, { home, away, ...(includeAdvances ? { advances } : {}) });
  })
);

// quien predijo un partido. Los pronosticos se revelan cuando el partido EMPIEZA
// (ya nadie puede editar), no cuando el admin publica el resultado. Antes del
// inicio solo se ven los apodos de quienes ya confirmaron.
app.get(
  "/api/matches/:id/predictions",
  ah(async (req, res) => {
    const matchId = Number(req.params.id);
    const match = await dbGet<{
      id: number;
      stage: string;
      kickoff_at: string;
      home_score: number | null;
      away_score: number | null;
      finished: number;
      advancer: string | null;
      status: string | null;
      live_home: number | null;
      live_away: number | null;
    }>(
      "SELECT id, stage, kickoff_at, home_score, away_score, finished, advancer, status, live_home, live_away FROM matches WHERE id = ?",
      [matchId]
    );
    if (!match) throw new HttpError(404, "Partido no existe");

    // Solo usuarios activos: los inactivos no cuentan ni aparecen en la polla
    // (igual que en la tabla de posiciones).
    const rows = await dbAll<{ apodo: string; email: string; home_score: number; away_score: number; advances: string | null }>(
      `SELECT u.apodo, u.email, p.home_score, p.away_score, p.advances
       FROM predictions p JOIN users u ON u.id = p.user_id
       WHERE p.match_id = ? AND u.is_active = 1 ORDER BY u.apodo`,
      [matchId]
    );

    const revealed = isMatchLocked(match.kickoff_at);
    if (!revealed) {
      ok(res, { revealed: false, count: rows.length, confirmed: rows.map((r) => ({ apodo: displayName(r.apodo, r.email) })) });
      return;
    }

    // Mejor resultado disponible para calcular puntos: oficial > en vivo > ninguno.
    let actual: { home: number; away: number } | null = null;
    let result: "final" | "live" | "pending" = "pending";
    if (match.finished && match.home_score !== null && match.away_score !== null) {
      actual = { home: match.home_score, away: match.away_score };
      result = "final";
    } else if (isLive(match) && match.live_home !== null && match.live_away !== null) {
      actual = { home: match.live_home, away: match.live_away };
      result = "live";
    }

    const score = await activeScorer();
    const isKo = match.stage !== "group";
    const predictions = rows
      .map((r) => {
        const base = actual ? score({ home: r.home_score, away: r.away_score }, actual) : 0;
        const advPts = match.advancer ? scoreAdvance(r.advances, match.advancer) : 0;
        return {
          apodo: displayName(r.apodo, r.email),
          home: r.home_score,
          away: r.away_score,
          advances: isKo ? r.advances ?? null : null,
          advancePoints: match.advancer ? advPts : null,
          points: actual ? base + advPts : null,
        };
      })
      .sort((a, b) => (b.points ?? -1) - (a.points ?? -1) || a.apodo.localeCompare(b.apodo));

    ok(res, {
      revealed: true,
      result,
      count: rows.length,
      match: actual ? { homeScore: actual.home, awayScore: actual.away, finished: !!match.finished } : null,
      advancer: match.advancer ?? null,
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
      `SELECT m.*, p.home_score AS p_home, p.away_score AS p_away, p.advances AS p_advances
         FROM predictions p
         JOIN matches m ON m.id = p.match_id
        WHERE p.user_id = ?
        ORDER BY m.kickoff_at, m.id`,
      [req.user!.id]
    );
    const matches = rows.map((r) => {
      const shaped = shapeMatch(r as never, teams);
      const pred = { home: Number(r.p_home), away: Number(r.p_away) };
      const advances = (r.p_advances as string | null) ?? null;
      const finishedWithScore =
        shaped.finished && shaped.homeScore !== null && shaped.awayScore !== null;
      const points = finishedWithScore
        ? score(pred, { home: shaped.homeScore!, away: shaped.awayScore! })
        : null;
      // bono "quién pasa": +1 si acertaste el clasificado (independiente del marcador)
      const advancePoints =
        shaped.finished && shaped.advancer ? scoreAdvance(advances, shaped.advancer) : null;
      return { ...shaped, pred, points, advances, advancePoints };
    });
    ok(res, { drawRuleActive: await drawRuleActive(), matches });
  })
);

app.get(
  "/api/me/wrapped",
  requireAuth,
  ah(async (req: AuthedRequest, res) => {
    const wrapped = await calculateWrapped(req.user!.id);
    ok(res, wrapped ?? { error: "No hay datos suficientes para el wrapped" });
  })
);

app.get(
  "/api/me/evolution",
  requireAuth,
  ah(async (req: AuthedRequest, res) => {
    const evolution = await getEvolution(req.user!.id);
    ok(res, evolution ?? { error: "No hay datos suficientes para la evolución" });
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

// ---------------------------------------------------------------- votaciones

interface PollRow {
  key: string;
  question: string;
  options: string; // JSON [{ value, label }]
  results_public: number;
  sort_order: number;
}

// Conteo de TODOS los polls en una sola consulta (evita N+1 contra Turso remoto).
async function allPollCounts(): Promise<Record<string, { counts: Record<string, number>; total: number }>> {
  const rows = await dbAll<{ poll_key: string; choice: string; n: number }>(
    "SELECT poll_key, choice, COUNT(*) AS n FROM poll_votes GROUP BY poll_key, choice"
  );
  const by: Record<string, { counts: Record<string, number>; total: number }> = {};
  for (const r of rows) {
    const c = (by[r.poll_key] ??= { counts: {}, total: 0 });
    c.counts[r.choice] = r.n;
    c.total += r.n;
  }
  return by;
}

// Votación consultiva visible en "Hoy". El conteo solo se incluye si el poll
// está revelado (results_public) o si quien pregunta es admin.
app.get(
  "/api/polls",
  ah(async (req: AuthedRequest, res) => {
    const isAdmin = req.user?.is_admin === 1;
    // Consultas independientes en paralelo (1 round-trip en vez de ~9 en serie).
    const [polls, countsByPoll, myVoteRows, deadline, showResultsRaw] = await Promise.all([
      dbAll<PollRow>("SELECT * FROM polls ORDER BY sort_order, key"),
      allPollCounts(),
      req.user
        ? dbAll<{ poll_key: string; choice: string }>(
            "SELECT poll_key, choice FROM poll_votes WHERE user_id = ?",
            [req.user.id]
          )
        : Promise.resolve([] as { poll_key: string; choice: string }[]),
      pollsDeadline(),
      getSetting("polls_show_results"),
    ]);

    const locked = deadline ? Date.now() >= new Date(deadline).getTime() : false;
    // Interruptor global del admin (por defecto encendido). Controla si el
    // resumen de resultados se muestra a los jugadores una vez cerrada la votación.
    const showResults = showResultsRaw !== "0";
    const myVotes: Record<string, string> = {};
    for (const r of myVoteRows) myVotes[r.poll_key] = r.choice;

    const out = polls.map((p) => {
      // Se revela el conteo a los jugadores solo si la votación cerró y el admin
      // tiene encendido el interruptor. El admin siempre ve el conteo.
      const reveal = isAdmin || (locked && showResults);
      return {
        key: p.key,
        question: p.question,
        options: JSON.parse(p.options) as { value: string; label: string }[],
        myChoice: myVotes[p.key] ?? null,
        resultsPublic: p.results_public === 1,
        counts: reveal ? countsByPoll[p.key] ?? { counts: {}, total: 0 } : null,
      };
    });

    ok(res, { deadline, locked, showResults, polls: out });
  })
);

app.put(
  "/api/polls/:key/vote",
  requireAuth,
  ah(async (req: AuthedRequest, res) => {
    const key = req.params.key;
    const { choice } = req.body ?? {};
    if (typeof choice !== "string") throw new HttpError(400, "Falta la opción");

    const poll = await dbGet<PollRow>("SELECT * FROM polls WHERE key = ?", [key]);
    if (!poll) throw new HttpError(404, "Votación no existe");
    if (await arePollsLocked()) throw new HttpError(403, "La votación ya está cerrada");

    const options = JSON.parse(poll.options) as { value: string; label: string }[];
    if (!options.some((o) => o.value === choice)) throw new HttpError(400, "Opción inválida");

    await dbRun(
      `INSERT INTO poll_votes (poll_key, user_id, choice, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(poll_key, user_id)
       DO UPDATE SET choice = excluded.choice, updated_at = datetime('now')`,
      [key, req.user!.id, choice]
    );
    ok(res, { saved: true, choice });
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

app.get(
  "/api/leaderboard/timeline",
  ah(async (_req, res) => {
    ok(res, await leaderboardTimeline());
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
    const thirds = bestThirds(standings); // proyección en vivo (posiciones actuales)
    const thirdSet = new Set(thirds);
    const eliminated = await eliminatedTeams();
    const teams = await loadTeamMap();

    const groups = Object.entries(standings)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([grp, table]) => ({
        grp,
        rows: table.map((s, idx) => {
          const position = idx + 1;
          // Prioridad: eliminado (rojo) > clasificado (verde) > posible 3º (amarillo)
          let status: "qualified" | "third" | "eliminated" | "alive";
          if (eliminated.has(s.teamId)) status = "eliminated";
          else if (position <= 2 || thirdSet.has(s.teamId)) status = "qualified";
          else if (position === 3) status = "third";
          else status = "alive";
          return {
            ...s,
            name: teams.get(s.teamId)?.name ?? s.teamId,
            flag: teams.get(s.teamId)?.flag ?? null,
            status,
            qualifies: status === "qualified",
            position,
          };
        }),
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
    const { homeScore, awayScore, finished, kickoffAt, homeTeam, awayTeam, venue, advancer } =
      req.body ?? {};
    const match = await dbGet<{ id: number; home_team: string | null; away_team: string | null }>(
      "SELECT id, home_team, away_team FROM matches WHERE id = ?",
      [id]
    );
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
    // "Quién avanza" (eliminatorias): debe ser uno de los dos equipos del partido
    // (considerando los que se estén fijando en esta misma llamada), o null.
    if (advancer !== undefined) {
      const finalHome = homeTeam !== undefined ? homeTeam || null : match.home_team;
      const finalAway = awayTeam !== undefined ? awayTeam || null : match.away_team;
      const adv = advancer || null;
      if (adv !== null && adv !== finalHome && adv !== finalAway)
        throw new HttpError(400, "El equipo que avanza debe ser uno de los dos del partido");
      push("advancer", adv);
    }
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
    const { bonosDeadline: deadline, pollsDeadline: pDeadline, showPollResults } = req.body ?? {};
    if (deadline !== undefined) await setSetting("bonos_deadline", deadline || null);
    if (pDeadline !== undefined) await setSetting("polls_deadline", pDeadline || null);
    if (showPollResults !== undefined)
      await setSetting("polls_show_results", showPollResults ? "1" : "0");
    ok(res, { saved: true });
  })
);

// --- votaciones (admin) ---
app.get(
  "/api/admin/polls",
  requireAdmin,
  ah(async (_req, res) => {
    const [polls, countsByPoll, deadline, showResultsRaw] = await Promise.all([
      dbAll<PollRow>("SELECT * FROM polls ORDER BY sort_order, key"),
      allPollCounts(),
      pollsDeadline(),
      getSetting("polls_show_results"),
    ]);
    const out = polls.map((p) => ({
      key: p.key,
      question: p.question,
      options: JSON.parse(p.options) as { value: string; label: string }[],
      resultsPublic: p.results_public === 1,
      ...(countsByPoll[p.key] ?? { counts: {}, total: 0 }),
    }));
    ok(res, { deadline, showResults: showResultsRaw !== "0", polls: out });
  })
);

app.put(
  "/api/admin/polls/:key",
  requireAdmin,
  ah(async (req, res) => {
    const key = req.params.key;
    const { resultsPublic } = req.body ?? {};
    if (typeof resultsPublic !== "boolean") throw new HttpError(400, "Falta resultsPublic");
    const poll = await dbGet("SELECT key FROM polls WHERE key = ?", [key]);
    if (!poll) throw new HttpError(404, "Votación no existe");
    await dbRun("UPDATE polls SET results_public = ? WHERE key = ?", [resultsPublic ? 1 : 0, key]);
    ok(res, { key, resultsPublic });
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
    // Respalda TODAS las tablas con datos (las sesiones son efímeras y se omiten).
    const [users, teams, matches, predictions, tournamentPicks, settings, polls, pollVotes] =
      await Promise.all([
        dbAll("SELECT * FROM users ORDER BY id"),
        dbAll("SELECT * FROM teams ORDER BY id"),
        dbAll("SELECT * FROM matches ORDER BY id"),
        dbAll("SELECT * FROM predictions ORDER BY id"),
        dbAll("SELECT * FROM tournament_picks ORDER BY user_id"),
        dbAll("SELECT * FROM settings"),
        dbAll("SELECT * FROM polls ORDER BY sort_order, key"),
        dbAll("SELECT * FROM poll_votes ORDER BY poll_key, user_id"),
      ]);
    const backup = {
      exportedAt: new Date().toISOString(),
      users,
      teams,
      matches,
      predictions,
      tournamentPicks,
      settings,
      polls,
      pollVotes,
    };
    res.setHeader("Content-Disposition", `attachment; filename="polla-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(backup, null, 2));
  })
);

// ---------------------------------------------------------------- admin: debug bonos

app.get(
  "/api/admin/bonos-debug",
  requireAdmin,
  ah(async (_req, res) => {
    const rows = await dbAll<{
      id: number;
      apodo: string;
      email: string;
      champion: string | null;
      runner_up: string | null;
      top_scorer: string | null;
      best_goalkeeper: string | null;
      best_player: string | null;
      best_young_player: string | null;
    }>(
      `SELECT u.id, u.apodo, u.email,
              tp.champion, tp.runner_up, tp.top_scorer,
              tp.best_goalkeeper, tp.best_player, tp.best_young_player
       FROM users u
       LEFT JOIN tournament_picks tp ON u.id = tp.user_id
       WHERE u.is_active = 1
       ORDER BY u.id`
    );
    ok(res, rows);
  })
);

// Mapeo de variantes a valor normalizado (para comparación)
const normalizationMap = {
  top_scorer: new Map([
    ["mbappe", "MBAPPE"], ["Mbappe", "MBAPPE"], ["MBAPPE", "MBAPPE"],
    ["mbappé", "MBAPPE"], ["Mbappé", "MBAPPE"],
    ["kylian mbappe", "MBAPPE"], ["Kylian Mbappe", "MBAPPE"],
    ["kylian mbappé", "MBAPPE"], ["Kylian Mbappé", "MBAPPE"],
    ["kylian mbapeé", "MBAPPE"], ["Kylian Mbapeé", "MBAPPE"],
    ["killyan mbappe", "MBAPPE"], ["Mbape", "MBAPPE"], ["mbape", "MBAPPE"],
    ["messi", "MESSI"], ["Messi", "MESSI"], ["MESSI", "MESSI"],
    ["lionel messi", "MESSI"], ["Lionel Messi", "MESSI"],
    ["harry kane", "KANE"], ["Harry Kane", "KANE"],
  ]),
  best_goalkeeper: new Map([
    ["dibu", "SIMON"], ["Dibu", "SIMON"],
    ["dibu martinez", "SIMON"], ["Dibu martinez", "SIMON"],
    ["emiliano dibu martinez", "SIMON"], ["Emiliano Dibu Martinez", "SIMON"],
    ["emiliano martínez", "SIMON"], ["Emiliano Martínez", "SIMON"],
    ["unai simón", "SIMON"], ["Unai Simón", "SIMON"],
    ["unai simon", "SIMON"], ["Unai Simon", "SIMON"], ["SIMON", "SIMON"],
  ]),
  best_player: new Map([
    ["mbappe", "MBAPPE"], ["Mbappe", "MBAPPE"],
    ["kylian mbappe", "MBAPPE"], ["Kylian Mbappe", "MBAPPE"],
    ["kylian mbappé", "MBAPPE"], ["Kylian Mbappé", "MBAPPE"],
    ["kylian mbapeé", "MBAPPE"], ["Kylian Mbapeé", "MBAPPE"],
    ["messi", "MESSI"], ["Messi", "MESSI"],
    ["lionel messi", "MESSI"], ["Lionel Messi", "MESSI"],
    ["rodri", "RODRI"], ["Rodri", "RODRI"],
  ]),
  best_young_player: new Map([
    ["lamine yamal", "CUBARSI"], ["Lamine Yamal", "CUBARSI"],
    ["lamine yamal", "CUBARSI"], ["Lamine yamal", "CUBARSI"],
    ["lamine", "CUBARSI"], ["Lamine", "CUBARSI"],
    ["yamal", "CUBARSI"], ["Yamal", "CUBARSI"],
    ["pau cubarsi", "CUBARSI"], ["Pau Cubarsi", "CUBARSI"],
  ]),
};

function normalize(field: string, value: string | null): string | null {
  if (!value) return null;
  const map = normalizationMap[field as keyof typeof normalizationMap];
  if (!map) return value?.trim().toUpperCase() ?? null;
  return map.get(value.trim()) ?? value.trim().toUpperCase();
}

// Endpoint público: resumen de bonos con resultados reales y quién acertó
app.get(
  "/api/bonos/summary",
  ah(async (_req, res) => {
    const teams = await loadTeamMap();
    const results = {
      champion: await getSetting("result_champion"),
      runnerUp: await getSetting("result_runner_up"),
      topScorer: await getSetting("result_top_scorer"),
      bestGoalkeeper: await getSetting("result_best_goalkeeper"),
      bestPlayer: await getSetting("result_best_player"),
      bestYoungPlayer: await getSetting("result_best_young_player"),
    };

    const picks = await dbAll<{
      user_id: number;
      apodo: string;
      email: string;
      champion: string | null;
      runner_up: string | null;
      top_scorer: string | null;
      best_goalkeeper: string | null;
      best_player: string | null;
      best_young_player: string | null;
    }>(
      `SELECT u.id as user_id, u.apodo, u.email,
              tp.champion, tp.runner_up, tp.top_scorer,
              tp.best_goalkeeper, tp.best_player, tp.best_young_player
       FROM users u
       LEFT JOIN tournament_picks tp ON u.id = tp.user_id
       WHERE u.is_active = 1
       ORDER BY u.apodo`
    );

    // Agrupar por categoría - mostrar ambos valores (original + normalizado)
    const summary = {
      champion: {
        real: results.champion,
        predictions: {} as Record<string, { count: number; predictions: Array<{ original: string; normalized: string; users: string[] }> }>
      },
      runnerUp: {
        real: results.runnerUp,
        predictions: {} as Record<string, { count: number; predictions: Array<{ original: string; normalized: string; users: string[] }> }>
      },
      topScorer: {
        real: results.topScorer,
        predictions: {} as Record<string, { count: number; predictions: Array<{ original: string; normalized: string; users: string[] }> }>
      },
      bestGoalkeeper: {
        real: results.bestGoalkeeper,
        predictions: {} as Record<string, { count: number; predictions: Array<{ original: string; normalized: string; users: string[] }> }>
      },
      bestPlayer: {
        real: results.bestPlayer,
        predictions: {} as Record<string, { count: number; predictions: Array<{ original: string; normalized: string; users: string[] }> }>
      },
      bestYoungPlayer: {
        real: results.bestYoungPlayer,
        predictions: {} as Record<string, { count: number; predictions: Array<{ original: string; normalized: string; users: string[] }> }>
      },
    };

    for (const pick of picks) {
      const displayName_ = pick.apodo.trim() || displayName(pick.apodo, pick.email);

      for (const [field, key] of [
        ["champion", "champion"],
        ["runner_up", "runnerUp"],
        ["top_scorer", "topScorer"],
        ["best_goalkeeper", "bestGoalkeeper"],
        ["best_player", "bestPlayer"],
        ["best_young_player", "bestYoungPlayer"],
      ] as const) {
        const val = pick[field as keyof typeof pick];
        if (!val || typeof val !== "string") continue;

        const normalized = normalize(field as any, val);
        const key_str = normalized || val;

        if (!summary[key].predictions[key_str]) {
          summary[key].predictions[key_str] = { count: 0, predictions: [] };
        }

        summary[key].predictions[key_str].count++;

        // Buscar si ya existe esta predicción (mismo original)
        const existing = summary[key].predictions[key_str].predictions.find(
          (p) => p.original === val
        );
        if (existing) {
          existing.users.push(displayName_);
        } else {
          summary[key].predictions[key_str].predictions.push({
            original: val as string,
            normalized: normalized || val,
            users: [displayName_],
          });
        }
      }
    }

    ok(res, summary);
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
