/**
 * Tests del motor de avance: desempate FIFA 2026 (enfrentamiento directo),
 * mejores terceros y proyección en vivo del cuadro.
 *
 * Ejecutar:  npm run test:adv
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const testFile = join(tmpdir(), `polla-adv-${Date.now()}.db`);
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

const KO = "2026-07-01T00:00:00.000Z";

async function main() {
  const { ensureSchema, dbRun, db } = await import("./db.js");
  const { groupStandings, bestThirds, projectBracket, eliminatedTeams } = await import("./advancement.js");
  await ensureSchema();

  const team = (id: string, grp: string) =>
    dbRun("INSERT INTO teams (id, name, grp) VALUES (?, ?, ?)", [id, id, grp]);
  const gm = (id: number, grp: string, home: string, away: string, hs: number, as: number) =>
    dbRun(
      "INSERT INTO matches (id, stage, grp, kickoff_at, home_team, away_team, home_score, away_score, finished) VALUES (?,'group',?,?,?,?,?,?,1)",
      [id, grp, KO, home, away, hs, as]
    );

  // ── Grupo A: ZZZ y AAA empatan en pts/DG/GF; ZZZ le ganó a AAA (directo) ──
  // Si funciona el head-to-head, ZZZ va sobre AAA pese a ser "mayor" alfabéticamente.
  for (const id of ["ZZZ", "AAA", "CCC", "DDD"]) await team(id, "A");
  await gm(1, "A", "ZZZ", "AAA", 2, 1); // ZZZ gana el directo
  await gm(2, "A", "ZZZ", "CCC", 1, 1);
  await gm(3, "A", "ZZZ", "DDD", 0, 1);
  await gm(4, "A", "AAA", "CCC", 1, 0);
  await gm(5, "A", "AAA", "DDD", 1, 1);
  await gm(6, "A", "CCC", "DDD", 0, 0);

  // ── Grupo B: triple empate cíclico; lo separa la DG del directo ──
  for (const id of ["ZB", "YB", "XB", "SB"]) await team(id, "B");
  await gm(10, "B", "ZB", "XB", 3, 0);
  await gm(11, "B", "XB", "YB", 1, 0);
  await gm(12, "B", "YB", "ZB", 1, 0);
  await gm(13, "B", "SB", "ZB", 0, 0);
  await gm(14, "B", "SB", "XB", 0, 0);
  await gm(15, "B", "SB", "YB", 0, 0);

  const st = await groupStandings();

  section("1) Desempate por enfrentamiento directo (2 equipos)");
  const a = st["A"].map((s) => s.teamId);
  check("orden grupo A = DDD, ZZZ, AAA, CCC", JSON.stringify(a) === JSON.stringify(["DDD", "ZZZ", "AAA", "CCC"]), JSON.stringify(a));
  check("ZZZ (ganó el directo) va sobre AAA pese al alfabético", a.indexOf("ZZZ") < a.indexOf("AAA"));

  section("2) Triple empate resuelto por DG del directo");
  const b = st["B"].map((s) => s.teamId);
  check("orden grupo B = ZB, YB, XB, SB", JSON.stringify(b) === JSON.stringify(["ZB", "YB", "XB", "SB"]), JSON.stringify(b));
  check("no es alfabético (sería SB,XB,YB,ZB)", JSON.stringify(b) !== JSON.stringify(["SB", "XB", "YB", "ZB"]));

  section("3) Mejores terceros (ranking entre grupos)");
  const thirds = bestThirds(st);
  check("terceros = [AAA, XB] (AAA con mejor DG)", JSON.stringify(thirds) === JSON.stringify(["AAA", "XB"]), JSON.stringify(thirds));

  section("4) Eliminados confirmados (sin chance de top-3)");
  const elim = await eliminatedTeams();
  check("CCC eliminado (4º grupo A completo)", elim.has("CCC"));
  check("SB eliminado (4º grupo B completo)", elim.has("SB"));
  check("top-3 NO eliminados", !elim.has("DDD") && !elim.has("ZZZ") && !elim.has("AAA") && !elim.has("ZB") && !elim.has("YB") && !elim.has("XB"));

  section("5) Proyección en vivo del cuadro (read-only)");
  // partido KO ficticio que toma 1º y 2º del grupo A
  await dbRun(
    "INSERT INTO matches (id, stage, code, kickoff_at, home_src, away_src, finished) VALUES (100,'r32','MX',?, 'WG:A','RU:A',0)",
    [KO]
  );
  const proj = await projectBracket();
  const p = proj.get(100);
  check("home proyectado = DDD (1º A)", p?.home === "DDD" && p?.homeProjected === true, JSON.stringify(p));
  check("away proyectado = ZZZ (2º A)", p?.away === "ZZZ" && p?.awayProjected === true, JSON.stringify(p));

  db.close();
  for (const suf of ["", "-wal", "-shm"]) {
    try { rmSync(testFile + suf, { force: true }); } catch { /* ignore */ }
  }

  console.log(`\n${failures === 0 ? "TODO OK ✅" : `${failures} fallo(s) ❌`}  (${total - failures}/${total} checks)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
