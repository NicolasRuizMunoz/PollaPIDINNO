/**
 * Backfill del bono "quién pasa" (eliminatorias).
 *
 * Formaliza la regla "un marcador decisivo implica quién pasa": setea
 * predictions.advances = equipo GANADOR en las predicciones de partidos de
 * eliminatoria con marcador DECISIVO (no empate) donde advances está NULL.
 * Los empates se dejan intactos (ahí la elección es libre → penales).
 *
 * Idempotente: solo toca filas con advances NULL. Es la versión "de datos" del
 * autocompletado que ahora hace el front al ingresar el marcador.
 *
 * Uso (desde la carpeta server/):
 *   npx tsx src/backfill-advances.ts                  # DRY-RUN sobre .env.test (no escribe)
 *   npx tsx src/backfill-advances.ts --apply          # escribe los cambios
 *   npx tsx src/backfill-advances.ts --env .env       # usar otra base (p.ej. un backup)
 *   npx tsx src/backfill-advances.ts --only-finished  # solo partidos ya publicados
 */
import dotenv from "dotenv";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const onlyFinished = args.includes("--only-finished");
const envIdx = args.indexOf("--env");
const envPath = envIdx >= 0 ? args[envIdx + 1] : ".env.test";
dotenv.config({ path: envPath });

const { dbAll, dbRun } = await import("./db.js");

interface MatchRow {
  id: number;
  code: string | null;
  stage: string;
  home_team: string | null;
  away_team: string | null;
  finished: number;
  advancer: string | null;
}
interface PredRow {
  user_id: number;
  match_id: number;
  home_score: number;
  away_score: number;
  advances: string | null;
}

async function main() {
  const matches = await dbAll<MatchRow>(
    `SELECT id, code, stage, home_team, away_team, finished, advancer
     FROM matches
     WHERE stage != 'group' AND home_team IS NOT NULL AND away_team IS NOT NULL`
  );
  const byId = new Map(matches.map((m) => [m.id, m]));
  const koIds = matches.map((m) => m.id);
  if (koIds.length === 0) {
    console.log("No hay partidos de eliminatoria con equipos definidos.");
    return;
  }

  const ph = koIds.map(() => "?").join(",");
  const preds = await dbAll<PredRow>(
    `SELECT user_id, match_id, home_score, away_score, advances
     FROM predictions WHERE match_id IN (${ph}) AND advances IS NULL`,
    koIds
  );

  const users = new Map(
    (await dbAll<{ id: number; apodo: string; email: string }>(
      "SELECT id, apodo, email FROM users"
    )).map((u) => [u.id, u])
  );

  // Candidatos: advances NULL + marcador decisivo. winner = lado ganador del pred.
  const toFix: { p: PredRow; m: MatchRow; winner: string }[] = [];
  for (const p of preds) {
    const m = byId.get(p.match_id)!;
    if (onlyFinished && !(m.finished === 1)) continue;
    if (p.home_score === p.away_score) continue; // empate: elección libre, no tocar
    const winner = p.home_score > p.away_score ? m.home_team! : m.away_team!;
    toFix.push({ p, m, winner });
  }

  // De esos, cuántos GANAN el +1 hoy (partido publicado y winner == clasificado).
  let gainNow = 0;
  const gainPerUser = new Map<string, number>();
  for (const { p, m, winner } of toFix) {
    if (m.finished === 1 && m.advancer && winner === m.advancer) {
      gainNow++;
      const u = users.get(p.user_id);
      const k = u ? `${u.apodo} <${u.email}>` : `user#${p.user_id}`;
      gainPerUser.set(k, (gainPerUser.get(k) ?? 0) + 1);
    }
  }

  console.log(`Base:            ${process.env.TURSO_DATABASE_URL ?? "file:polla.db"}`);
  console.log(`Env:             ${envPath}`);
  console.log(`Modo:            ${apply ? "APPLY (escribe)" : "DRY-RUN (no escribe)"}`);
  console.log(`Alcance:         ${onlyFinished ? "solo publicados" : "todos los KO con equipos"}`);
  console.log(`Predicciones a rellenar (advances = ganador): ${toFix.length}`);
  console.log(`  ...de las cuales ganan +1 ya mismo:         ${gainNow}`);
  if (gainPerUser.size) {
    console.log(`\n+1 por usuario (partidos ya publicados):`);
    for (const [k, n] of [...gainPerUser.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  +${n}  ${k}`);
    }
  }

  if (!apply) {
    console.log(`\nDRY-RUN: no se escribió nada. Corre con --apply para aplicar.`);
    return;
  }

  let written = 0;
  for (const { p, winner } of toFix) {
    await dbRun(
      "UPDATE predictions SET advances = ? WHERE user_id = ? AND match_id = ? AND advances IS NULL",
      [winner, p.user_id, p.match_id]
    );
    written++;
  }
  console.log(`\nOK: ${written} predicciones actualizadas.`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
