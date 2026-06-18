/**
 * Tests del cambio de regla del EMPATE (y su gating por el partido disparador).
 *
 * 1) Función pura: scoreMatch (vieja) vs scoreMatchDrawV2 (nueva).
 * 2) Invariantes: la nueva nunca da más que la vieja; solo difieren en empates.
 * 3) Flujo end-to-end en una BD SQLite temporal: drawRulePreview + leaderboard,
 *    y que la regla nueva se ACTIVE sola al publicar el partido disparador.
 *
 * Ejecutar:  npm run test:empate
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const testFile = join(tmpdir(), `polla-empate-${Date.now()}.db`);
process.env.TURSO_DATABASE_URL = "file:" + testFile;
delete process.env.TURSO_AUTH_TOKEN;

let failures = 0;
let total = 0;
function check(name: string, cond: boolean, extra?: string) {
  total++;
  console.log(`  ${cond ? "✅" : "❌"} ${name}${extra && !cond ? `  → ${extra}` : ""}`);
  if (!cond) failures++;
}
function section(title: string) {
  console.log(`\n${title}`);
}

async function main() {
  const { scoreMatch, scoreMatchDrawV2 } = await import("./scoring.js");

  // ---------------------------------------------------------------- 1) pura
  section("1) Regla NUEVA del empate — scoreMatchDrawV2");
  // marcador exacto sigue dando 5
  check("exacto 2-2 vs 2-2 = 5", scoreMatchDrawV2({ home: 2, away: 2 }, { home: 2, away: 2 }) === 5);
  // empate a 1 gol del real → +1 (total 4)
  check("empate 1-1 vs 2-2 = 4 (a 1 gol)", scoreMatchDrawV2({ home: 1, away: 1 }, { home: 2, away: 2 }) === 4);
  check("empate 2-2 vs 1-1 = 4 (a 1 gol, simétrico)", scoreMatchDrawV2({ home: 2, away: 2 }, { home: 1, away: 1 }) === 4);
  check("empate 3-3 vs 2-2 = 4 (a 1 gol)", scoreMatchDrawV2({ home: 3, away: 3 }, { home: 2, away: 2 }) === 4);
  // empate a 2+ goles → sin bono (total 3)  ← el caso que cambia
  check("empate 0-0 vs 2-2 = 3 (a 2 goles, SIN bono)", scoreMatchDrawV2({ home: 0, away: 0 }, { home: 2, away: 2 }) === 3);
  check("empate 0-0 vs 3-3 = 3 (a 3 goles, SIN bono)", scoreMatchDrawV2({ home: 0, away: 0 }, { home: 3, away: 3 }) === 3);
  // con ganador definido NO cambia nada
  check("ganador+dif 3-1 vs 4-2 = 4 (igual que antes)", scoreMatchDrawV2({ home: 3, away: 1 }, { home: 4, away: 2 }) === 4);
  check("solo ganador 3-1 vs 2-1 = 3 (igual que antes)", scoreMatchDrawV2({ home: 3, away: 1 }, { home: 2, away: 1 }) === 3);
  check("fallo 3-1 vs 1-1 = 0", scoreMatchDrawV2({ home: 3, away: 1 }, { home: 1, away: 1 }) === 0);

  // ----------------------------------------------------- 2) vieja vs nueva
  section("2) Comparación vieja vs nueva (invariantes)");
  // el caso "poderoso" que motivó el cambio: 0-0 a un empate grande
  check("0-0 vs 2-2: vieja=4, nueva=3 (pierde el bono)",
    scoreMatch({ home: 0, away: 0 }, { home: 2, away: 2 }) === 4 &&
    scoreMatchDrawV2({ home: 0, away: 0 }, { home: 2, away: 2 }) === 3);
  check("1-1 vs 2-2: vieja=4, nueva=4 (no cambia)",
    scoreMatch({ home: 1, away: 1 }, { home: 2, away: 2 }) === 4 &&
    scoreMatchDrawV2({ home: 1, away: 1 }, { home: 2, away: 2 }) === 4);

  // barrido 0..5 x 0..5 para pred y actual: la nueva NUNCA supera a la vieja,
  // y solo difieren cuando el resultado real es un empate (diferencia = 1 pt).
  let nuevaNuncaMayor = true;
  let difieronSoloEnEmpates = true;
  let difMaxFueUno = true;
  let casosQueBajan = 0;
  for (let ph = 0; ph <= 5; ph++)
    for (let pa = 0; pa <= 5; pa++)
      for (let ah = 0; ah <= 5; ah++)
        for (let aa = 0; aa <= 5; aa++) {
          const pred = { home: ph, away: pa };
          const act = { home: ah, away: aa };
          const vieja = scoreMatch(pred, act);
          const nueva = scoreMatchDrawV2(pred, act);
          if (nueva > vieja) nuevaNuncaMayor = false;
          if (nueva !== vieja) {
            casosQueBajan++;
            if (ah !== aa) difieronSoloEnEmpates = false; // solo deberían diferir si el real es empate
            if (vieja - nueva !== 1) difMaxFueUno = false; // la baja siempre es de 1 pt
          }
        }
  check("la regla nueva nunca da MÁS que la vieja", nuevaNuncaMayor);
  check("solo difieren cuando el resultado real es empate", difieronSoloEnEmpates);
  check("cuando difieren, la baja es exactamente 1 punto", difMaxFueUno);
  check(`hubo casos que bajan en el barrido (${casosQueBajan} > 0)`, casosQueBajan > 0, String(casosQueBajan));

  // --------------------------------------------------- 3) end-to-end + gating
  section("3) End-to-end: preview, leaderboard y activación por Colombia");
  const { ensureSchema, dbRun, setSetting, db } = await import("./db.js");
  const { drawRuleActive, leaderboard, drawRulePreview } = await import("./queries.js");
  await ensureSchema();

  // datos mínimos: 2 equipos, 1 partido jugado (empate 2-2) y 1 partido disparador
  await dbRun("INSERT INTO teams (id, name) VALUES ('AAA','Equipo A'),('BBB','Equipo B')");
  // M1: empate 2-2 ya publicado
  await dbRun(
    "INSERT INTO matches (id, stage, kickoff_at, home_team, away_team, home_score, away_score, finished) VALUES (1,'group','2026-06-10T00:00:00.000Z','AAA','BBB',2,2,1)"
  );
  // TRIG: partido disparador (Colombia), aún SIN publicar
  await dbRun(
    "INSERT INTO matches (id, stage, kickoff_at, home_team, away_team) VALUES (2,'group','2026-06-17T22:00:00.000Z','AAA','BBB')"
  );
  await dbRun("INSERT INTO users (id, email, apodo, is_admin, is_active) VALUES (1,'u1@x.cl','Uno',0,1),(2,'u2@x.cl','Dos',0,1)");
  // Uno predijo 0-0 (a 2 goles → pierde el bono); Dos predijo 1-1 (a 1 gol → lo conserva)
  await dbRun("INSERT INTO predictions (user_id, match_id, home_score, away_score) VALUES (1,1,0,0),(2,1,1,1)");
  // el disparador es el partido id 2
  await setSetting("draw_rule_trigger_match", "2");

  const totalOf = async (apodo: string) =>
    (await leaderboard()).find((r) => r.apodo === apodo)?.total ?? -1;

  // --- ANTES de publicar Colombia: regla vieja vigente ---
  check("drawRuleActive() = false (Colombia sin publicar)", (await drawRuleActive()) === false);
  check("leaderboard Uno = 4 (regla vieja)", (await totalOf("Uno")) === 4, String(await totalOf("Uno")));
  check("leaderboard Dos = 4", (await totalOf("Dos")) === 4, String(await totalOf("Dos")));

  const prevAntes = await drawRulePreview();
  check("preview.active = false", prevAntes.active === false);
  check("preview.trigger es el partido 2", prevAntes.trigger?.matchId === 2);
  check("preview afectados = 1 (solo Uno)", prevAntes.affectedCount === 1, String(prevAntes.affectedCount));
  check("preview pointsRemoved = 1", prevAntes.pointsRemoved === 1, String(prevAntes.pointsRemoved));
  check("preview Uno: 4 → 3 (delta -1)",
    prevAntes.affected[0]?.apodo === "Uno" &&
    prevAntes.affected[0]?.oldTotal === 4 &&
    prevAntes.affected[0]?.newTotal === 3 &&
    prevAntes.affected[0]?.delta === -1);
  check("preview detalle del partido: 4 → 3",
    prevAntes.affected[0]?.changes[0]?.oldPts === 4 &&
    prevAntes.affected[0]?.changes[0]?.newPts === 3);

  // --- PUBLICAR Colombia (partido disparador) → la regla nueva se activa sola ---
  await dbRun("UPDATE matches SET home_score=1, away_score=0, finished=1 WHERE id=2");

  check("drawRuleActive() = true (Colombia publicado)", (await drawRuleActive()) === true);
  check("leaderboard Uno = 3 (regla NUEVA aplicada)", (await totalOf("Uno")) === 3, String(await totalOf("Uno")));
  check("leaderboard Dos = 4 (sin cambios, quedó a 1 gol)", (await totalOf("Dos")) === 4, String(await totalOf("Dos")));
  check("preview.active = true tras publicar", (await drawRulePreview()).active === true);

  // limpieza
  db.close();
  for (const suf of ["", "-wal", "-shm"]) {
    try { rmSync(testFile + suf, { force: true }); } catch { /* ignore */ }
  }

  console.log(
    `\n${failures === 0 ? "TODO OK ✅" : `${failures} fallo(s) ❌`}  (${total - failures}/${total} checks)`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
