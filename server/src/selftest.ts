/**
 * Test de humo del backend (motor de puntaje + avance del cuadro).
 * Usa una base de datos temporal, siembra el Mundial, simula todos los
 * resultados y verifica que las eliminatorias se rellenen solas etapa a etapa.
 *
 * Ejecutar:  npm run selftest
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const testDb = join(tmpdir(), `polla-selftest-${Date.now()}.db`);
process.env.DB_PATH = testDb;

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "✅" : "❌"} ${name}`);
  if (!cond) failures++;
}

async function main() {
  // 1) Reglas de puntaje
  const { scoreMatch, scoreTournament } = await import("./scoring.js");
  check("exacto 3-1 vs 3-1 = 5", scoreMatch({ home: 3, away: 1 }, { home: 3, away: 1 }) === 5);
  check("ganador+dif 3-1 vs 4-2 = 4", scoreMatch({ home: 3, away: 1 }, { home: 4, away: 2 }) === 4);
  check("solo ganador 3-1 vs 2-1 = 3", scoreMatch({ home: 3, away: 1 }, { home: 2, away: 1 }) === 3);
  check("empate dif 1-1 vs 2-2 = 4", scoreMatch({ home: 1, away: 1 }, { home: 2, away: 2 }) === 4);
  check("fallo 3-1 vs 1-1 = 0", scoreMatch({ home: 3, away: 1 }, { home: 1, away: 1 }) === 0);
  check("perder lado 3-1 vs 1-3 = 0", scoreMatch({ home: 3, away: 1 }, { home: 1, away: 3 }) === 0);
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

  // 2) Sembrar la base temporal (seed.js corre seed() al importarse)
  await import("./seed.js");
  const { db } = await import("./db.js");
  const { resolveBracket, groupStandings, bestThirds } = await import("./advancement.js");

  const countMatches = (where: string) =>
    (db.prepare(`SELECT COUNT(*) AS c FROM matches WHERE ${where}`).get() as { c: number }).c;

  check("72 partidos de grupos", countMatches("stage = 'group'") === 72);
  check("32 partidos de eliminatorias", countMatches("stage != 'group'") === 32);

  // helper: marca un partido como jugado (gana el local 2-1)
  const finish = (id: number, hs: number, as: number) =>
    db.prepare("UPDATE matches SET home_score=?, away_score=?, finished=1 WHERE id=?").run(hs, as, id);

  // 3) Completar TODOS los partidos de grupos (gana siempre el local 2-1)
  const groupIds = db.prepare("SELECT id FROM matches WHERE stage='group'").all() as unknown as { id: number }[];
  for (const m of groupIds) finish(m.id, 2, 1);

  const standings = groupStandings();
  check("12 grupos con tabla", Object.keys(standings).length === 12);
  check("cada grupo tiene 4 equipos", Object.values(standings).every((t) => t.length === 4));
  const thirds = bestThirds(standings);
  check("8 mejores terceros", thirds.length === 8);

  // 4) Resolver el cuadro: deberian quedar los 32 cupos de dieciseisavos
  resolveBracket(true);
  const r32Filled = countMatches("stage='r32' AND home_team IS NOT NULL AND away_team IS NOT NULL");
  check("dieciseisavos con ambos equipos (16)", r32Filled === 16);

  // 5) Jugar ronda por ronda y verificar propagacion
  const playStage = (stage: string) => {
    const ms = db.prepare("SELECT id FROM matches WHERE stage=? ORDER BY id").all(stage) as unknown as { id: number }[];
    for (const m of ms) finish(m.id, 2, 1);
    resolveBracket();
  };
  playStage("r32");
  check("octavos completos (8)", countMatches("stage='r16' AND home_team IS NOT NULL AND away_team IS NOT NULL") === 8);
  playStage("r16");
  check("cuartos completos (4)", countMatches("stage='qf' AND home_team IS NOT NULL AND away_team IS NOT NULL") === 4);
  playStage("qf");
  check("semifinales completas (2)", countMatches("stage='sf' AND home_team IS NOT NULL AND away_team IS NOT NULL") === 2);
  // jugar semis para resolver final y tercer puesto
  const semis = db.prepare("SELECT id FROM matches WHERE stage='sf' ORDER BY id").all() as unknown as { id: number }[];
  for (const m of semis) finish(m.id, 2, 1);
  resolveBracket();
  check("final con ambos equipos", countMatches("stage='final' AND home_team IS NOT NULL AND away_team IS NOT NULL") === 1);
  check("tercer puesto con ambos equipos", countMatches("stage='third' AND home_team IS NOT NULL AND away_team IS NOT NULL") === 1);

  // tercer puesto debe tener los perdedores de las semis
  const third = db.prepare("SELECT home_team, away_team FROM matches WHERE stage='third'").get() as { home_team: string; away_team: string };
  const finalM = db.prepare("SELECT home_team, away_team FROM matches WHERE stage='final'").get() as { home_team: string; away_team: string };
  check(
    "ganadores en final y perdedores en 3er puesto son distintos",
    third.home_team !== finalM.home_team && third.away_team !== finalM.away_team
  );

  db.close();
  rmSync(testDb, { force: true });
  rmSync(testDb + "-wal", { force: true });
  rmSync(testDb + "-shm", { force: true });

  console.log(failures === 0 ? "\nTODO OK ✅" : `\n${failures} fallo(s) ❌`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
