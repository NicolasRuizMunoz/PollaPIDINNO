/**
 * Tests del feature "quién pasa de ronda":
 *  1) Función pura scoreAdvance (+1 por acertar el clasificado).
 *  2) Resolver del cuadro: el ganador/perdedor sale del `advancer` que fija el
 *     admin (más allá del marcador), de modo que un empate por penales avanza.
 *  3) Leaderboard: el bono +1 se suma al puntaje del partido de eliminatorias.
 *
 * Ejecutar:  npm run test:advancer
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const testFile = join(tmpdir(), `polla-advancer-${Date.now()}.db`);
process.env.TURSO_DATABASE_URL = "file:" + testFile;
delete process.env.TURSO_AUTH_TOKEN;

let failures = 0;
let total = 0;
function check(name: string, cond: boolean, extra?: string) {
  total++;
  console.log(`  ${cond ? "✅" : "❌"} ${name}${extra && !cond ? `  → ${extra}` : ""}`);
  if (!cond) failures++;
}
function section(t: string) { console.log(`\n${t}`); }

async function main() {
  // ---------------------------------------------------------------- 1) pura
  section("1) scoreAdvance (bono +1 quién pasa)");
  const { scoreAdvance } = await import("./scoring.js");
  check("acierto BRA=BRA → 1", scoreAdvance("BRA", "BRA") === 1);
  check("fallo BRA≠ARG → 0", scoreAdvance("BRA", "ARG") === 0);
  check("sin predicción → 0", scoreAdvance(null, "BRA") === 0);
  check("sin resultado → 0", scoreAdvance("BRA", null) === 0);

  // -------------------------------------------------- 2) resolver con penales
  section("2) Cuadro: avanza el 'advancer' aunque sea empate (penales)");
  const { ensureSchema, dbRun, db } = await import("./db.js");
  const { resolveBracket } = await import("./advancement.js");
  await ensureSchema();
  await dbRun("INSERT INTO teams (id, name) VALUES ('AAA','A'),('BBB','B'),('CCC','C'),('DDD','D')");
  // MA: empate 1-1, el admin marca que pasa BBB (penales)
  await dbRun(
    `INSERT INTO matches (id, stage, code, kickoff_at, home_team, away_team, home_score, away_score, finished, advancer)
     VALUES (1,'r32','MA','2026-07-01T00:00:00Z','AAA','BBB',1,1,1,'BBB')`
  );
  // MC: decisivo 2-0 SIN advancer → debe usar el marcador (fallback)
  await dbRun(
    `INSERT INTO matches (id, stage, code, kickoff_at, home_team, away_team, home_score, away_score, finished)
     VALUES (2,'r32','MC','2026-07-01T00:00:00Z','CCC','DDD',2,0,1)`
  );
  // OB (octavos): home = ganador de MA, away = perdedor de MA
  await dbRun(
    `INSERT INTO matches (id, stage, code, kickoff_at, home_src, away_src)
     VALUES (3,'r16','OB','2026-07-05T00:00:00Z','WM:MA','LM:MA')`
  );
  // OC: home = ganador de MC (sin advancer, por marcador)
  await dbRun(
    `INSERT INTO matches (id, stage, code, kickoff_at, home_src, away_src)
     VALUES (4,'r16','OC','2026-07-05T00:00:00Z','WM:MC','WM:MA')`
  );
  await resolveBracket();
  const ob = await db.execute("SELECT home_team, away_team FROM matches WHERE code='OB'");
  const oc = await db.execute("SELECT home_team FROM matches WHERE code='OC'");
  check("WM:MA = BBB (pasa por penales, no por marcador)", (ob.rows[0] as never as { home_team: string }).home_team === "BBB",
    String((ob.rows[0] as never as { home_team: string }).home_team));
  check("LM:MA = AAA (el perdedor es el otro lado)", (ob.rows[0] as never as { away_team: string }).away_team === "AAA",
    String((ob.rows[0] as never as { away_team: string }).away_team));
  check("WM:MC = CCC (fallback por marcador sin advancer)", (oc.rows[0] as never as { home_team: string }).home_team === "CCC",
    String((oc.rows[0] as never as { home_team: string }).home_team));

  // ------------------------------------------------- 3) leaderboard con bono
  section("3) Leaderboard: +1 por acertar quién pasa");
  const { leaderboard } = await import("./queries.js");
  await dbRun("INSERT INTO users (id, email, apodo, is_admin, is_active) VALUES (1,'u1@x.cl','Uno',0,1),(2,'u2@x.cl','Dos',0,1)");
  // Uno: marcador exacto 1-1 (5) + acierta que pasa BBB (+1) = 6
  await dbRun("INSERT INTO predictions (user_id, match_id, home_score, away_score, advances) VALUES (1,1,1,1,'BBB')");
  // Dos: marcador 2-0 (falla, 0) + dice que pasa AAA (falla, +0) = 0
  await dbRun("INSERT INTO predictions (user_id, match_id, home_score, away_score, advances) VALUES (2,1,2,0,'AAA')");
  const lb = await leaderboard();
  const uno = lb.find((r) => r.apodo === "Uno");
  const dos = lb.find((r) => r.apodo === "Dos");
  check("Uno = 6 (5 exacto + 1 quién pasa)", uno?.total === 6, String(uno?.total));
  check("Dos = 0 (falla marcador y quién pasa)", dos?.total === 0, String(dos?.total));

  db.close();
  for (const suf of ["", "-wal", "-shm"]) {
    try { rmSync(testFile + suf, { force: true }); } catch { /* ignore */ }
  }
  console.log(`\n${failures === 0 ? "TODO OK ✅" : `${failures} fallo(s) ❌`}  (${total - failures}/${total} checks)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
