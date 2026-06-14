/**
 * Test de humo del backend (motor de puntaje + avance del cuadro).
 * Usa una base de datos SQLite local temporal (file:), siembra el Mundial,
 * simula todos los resultados y verifica que las eliminatorias se rellenen
 * solas etapa a etapa.
 *
 * Ejecutar:  npm run selftest
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const testFile = join(tmpdir(), `polla-selftest-${Date.now()}.db`);
process.env.TURSO_DATABASE_URL = "file:" + testFile;
delete process.env.TURSO_AUTH_TOKEN;

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "✅" : "❌"} ${name}`);
  if (!cond) failures++;
}

async function main() {
  const { scoreMatch, scoreTournament } = await import("./scoring.js");
  check("exacto 3-1 vs 3-1 = 5", scoreMatch({ home: 3, away: 1 }, { home: 3, away: 1 }) === 5);
  check("ganador+dif 3-1 vs 4-2 = 4", scoreMatch({ home: 3, away: 1 }, { home: 4, away: 2 }) === 4);
  check("solo ganador 3-1 vs 2-1 = 3", scoreMatch({ home: 3, away: 1 }, { home: 2, away: 1 }) === 3);
  check("empate dif 1-1 vs 2-2 = 4", scoreMatch({ home: 1, away: 1 }, { home: 2, away: 2 }) === 4);
  check("fallo 3-1 vs 1-1 = 0", scoreMatch({ home: 3, away: 1 }, { home: 1, away: 1 }) === 0);
  check(
    "bonos: campeon (15) + goleador (10) = 25",
    scoreTournament(
      { champion: "ARG", runnerUp: "FRA", topScorer: "Messi", bestGoalkeeper: "X" },
      { champion: "ARG", runnerUp: "BRA", topScorer: "messi", bestGoalkeeper: "Y" }
    ) === 25
  );
  check(
    "bonos: solo subcampeon = 10",
    scoreTournament(
      { champion: "ARG", runnerUp: "FRA", topScorer: null, bestGoalkeeper: null },
      { champion: "BRA", runnerUp: "FRA", topScorer: null, bestGoalkeeper: null }
    ) === 10
  );
  check(
    "bonos: mejor jugador + mejor jugador joven = 20",
    scoreTournament(
      { bestPlayer: "Messi", bestYoungPlayer: "Yamal" },
      { bestPlayer: "messi", bestYoungPlayer: "YAMAL" }
    ) === 20
  );

  const { seed } = await import("./seed.js");
  await seed();

  const { db, dbAll } = await import("./db.js");
  const { resolveBracket, groupStandings, completeGroups, bestThirds } = await import(
    "./advancement.js"
  );

  const count = async (where: string) =>
    (
      (await dbAll<{ c: number }>(`SELECT COUNT(*) AS c FROM matches WHERE ${where}`))[0]
    ).c;

  check("72 partidos de grupos", (await count("stage = 'group'")) === 72);
  check("32 partidos de eliminatorias", (await count("stage != 'group'")) === 32);

  const finish = (id: number, hs: number, as: number) =>
    db.execute({
      sql: "UPDATE matches SET home_score=?, away_score=?, finished=1 WHERE id=?",
      args: [hs, as, id],
    });

  // completar todos los grupos (gana el local 2-1)
  const groupIds = await dbAll<{ id: number }>("SELECT id FROM matches WHERE stage='group'");
  for (const m of groupIds) await finish(m.id, 2, 1);

  const standings = await groupStandings();
  const complete = await completeGroups();
  check("12 grupos con tabla", Object.keys(standings).length === 12);
  check("12 grupos completos", complete.size === 12);
  check("8 mejores terceros", bestThirds(standings, complete).length === 8);

  await resolveBracket(true);
  check("dieciseisavos con ambos equipos (16)",
    (await count("stage='r32' AND home_team IS NOT NULL AND away_team IS NOT NULL")) === 16);

  const playStage = async (stage: string) => {
    const ms = await dbAll<{ id: number }>("SELECT id FROM matches WHERE stage=? ORDER BY id", [stage]);
    for (const m of ms) await finish(m.id, 2, 1);
    await resolveBracket();
  };
  await playStage("r32");
  check("octavos completos (8)",
    (await count("stage='r16' AND home_team IS NOT NULL AND away_team IS NOT NULL")) === 8);
  await playStage("r16");
  check("cuartos completos (4)",
    (await count("stage='qf' AND home_team IS NOT NULL AND away_team IS NOT NULL")) === 4);
  await playStage("qf");
  check("semifinales completas (2)",
    (await count("stage='sf' AND home_team IS NOT NULL AND away_team IS NOT NULL")) === 2);

  const semis = await dbAll<{ id: number }>("SELECT id FROM matches WHERE stage='sf' ORDER BY id");
  for (const m of semis) await finish(m.id, 2, 1);
  await resolveBracket();
  check("final con ambos equipos",
    (await count("stage='final' AND home_team IS NOT NULL AND away_team IS NOT NULL")) === 1);
  check("tercer puesto con ambos equipos",
    (await count("stage='third' AND home_team IS NOT NULL AND away_team IS NOT NULL")) === 1);

  db.close();
  // limpieza best-effort (en Windows el archivo puede quedar tomado un instante)
  for (const suf of ["", "-wal", "-shm"]) {
    try {
      rmSync(testFile + suf, { force: true });
    } catch {
      /* ignore */
    }
  }

  console.log(failures === 0 ? "\nTODO OK ✅" : `\n${failures} fallo(s) ❌`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
