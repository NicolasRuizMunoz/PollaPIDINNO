/**
 * Siembra una BBDD (de PRUEBAS) con un clon fiel de un backup JSON generado por
 * GET /api/admin/backup.
 *
 * A diferencia de `restore.ts` (que solo parchea resultados/predicciones sobre un
 * fixture ya existente con ids alineados), este script reconstruye TODO desde cero:
 *   - equipos + esquema base (vía seed())
 *   - partidos CON SUS IDS ORIGINALES (clave: las predicciones del backup apuntan
 *     a esos ids, p. ej. 209–312, que un seed fresco no reproduce)
 *   - usuarios (con ids originales), predicciones, picks de torneo y settings
 *
 * Uso:
 *   npm run seed:backup -- ../polla-backup-2026-06-23.json
 *   npm run seed:backup -- ../polla-backup-2026-06-23.json --dry   (solo inspecciona)
 *
 * ⚠️  Opera sobre la base de .env (o TURSO_DATABASE_URL del entorno). Asegúrate de
 *     apuntar a la base de PRUEBAS, NO a producción. El script imprime la URL destino
 *     antes de escribir nada.
 */
import "dotenv/config";
import type { InStatement } from "@libsql/client";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dbRun, dbGet, ensureSchema, db } from "./db.js";
import { seed } from "./seed.js";

/** Inserta en lotes (una petición HTTP por chunk) para no morir en round-trips. */
async function batchInsert(stmts: InStatement[], chunk = 250) {
  for (let i = 0; i < stmts.length; i += chunk) {
    await db.batch(stmts.slice(i, i + chunk), "write");
  }
}

interface BackupUser {
  id: number; email: string; apodo: string;
  is_admin: number; is_active?: number; created_at: string;
}
interface BackupPrediction {
  user_id: number; match_id: number;
  home_score: number; away_score: number; advances?: string | null; updated_at: string;
}
interface BackupTournamentPick {
  user_id: number;
  champion: string | null; runner_up: string | null; top_scorer: string | null;
  best_goalkeeper: string | null; best_player?: string | null; best_young_player?: string | null;
  updated_at: string;
}
interface BackupMatch {
  id: number; code: string | null; stage: string; grp: string | null; matchday: number | null;
  label: string | null; home_team: string | null; away_team: string | null;
  home_label: string | null; away_label: string | null; home_src: string | null; away_src: string | null;
  kickoff_at: string; venue: string | null;
  home_score: number | null; away_score: number | null; finished: number; advancer?: string | null;
  status?: string | null; live_home?: number | null; live_away?: number | null;
  minute?: number | null; api_fixture_id?: number | null; live_updated_at?: string | null;
}
interface BackupSetting { key: string; value: string | null; }
interface BackupTeam { id: string; name: string; flag: string | null; grp: string | null; }
interface BackupPoll {
  key: string; question: string; options: string;
  results_public?: number; sort_order?: number;
}
interface BackupPollVote {
  poll_key: string; user_id: number; choice: string; updated_at?: string;
}
interface Backup {
  exportedAt: string;
  users: BackupUser[]; predictions: BackupPrediction[];
  tournamentPicks: BackupTournamentPick[]; matches: BackupMatch[]; settings: BackupSetting[];
  // opcionales: pueden faltar en backups antiguos
  teams?: BackupTeam[]; polls?: BackupPoll[]; pollVotes?: BackupPollVote[];
}

async function countOrNA(sql: string): Promise<string> {
  try {
    const r = await dbGet<{ n: number }>(sql);
    return String(r?.n ?? 0);
  } catch {
    return "(sin tabla)";
  }
}

async function showCounts(label: string) {
  console.log(`\n${label}`);
  console.log(`  users:        ${await countOrNA("SELECT COUNT(*) n FROM users")}`);
  console.log(`  matches:      ${await countOrNA("SELECT COUNT(*) n FROM matches")}`);
  console.log(`  predictions:  ${await countOrNA("SELECT COUNT(*) n FROM predictions")}`);
  console.log(`  tournament_picks: ${await countOrNA("SELECT COUNT(*) n FROM tournament_picks")}`);
  console.log(`  poll_votes:   ${await countOrNA("SELECT COUNT(*) n FROM poll_votes")}`);
}

async function main(file: string, dry: boolean) {
  const url = process.env.TURSO_DATABASE_URL ?? "file:polla.db";
  console.log(`Base de datos destino: ${url}`);
  if (/pollacopec/.test(url)) {
    console.error("\n⛔ La URL parece ser la de PRODUCCIÓN (pollacopec). Abortando por seguridad.");
    process.exit(2);
  }

  const backup: Backup = JSON.parse(readFileSync(file, "utf-8"));
  console.log(
    `Backup ${backup.exportedAt}: ${backup.users.length} usuarios, ` +
    `${backup.matches.length} partidos, ${backup.predictions.length} predicciones, ` +
    `${backup.tournamentPicks.length} picks, ${backup.settings.length} settings, ` +
    `${backup.teams?.length ?? 0} equipos, ${backup.polls?.length ?? 0} polls, ` +
    `${backup.pollVotes?.length ?? 0} votos.`
  );

  if (dry) {
    await ensureSchema().catch(() => {});
    await showCounts("Estado ACTUAL de la base destino (no se modifica nada en --dry):");
    await db.close();
    return;
  }

  // 1) Esquema + equipos (seed() limpia y repuebla teams; su fixture se descarta luego)
  console.log("\n1/7 Sembrando esquema y equipos...");
  await seed();

  // 2) Limpiar el fixture descartable y cualquier dato dependiente
  console.log("2/7 Limpiando fixture base y datos previos...");
  await db.executeMultiple(
    "DELETE FROM sessions; DELETE FROM predictions; DELETE FROM tournament_picks; DELETE FROM users; DELETE FROM matches;"
  );

  // 3) Partidos con sus IDS ORIGINALES
  console.log(`3/7 Insertando ${backup.matches.length} partidos (ids originales)...`);
  await batchInsert(backup.matches.map((m) => ({
    sql: `INSERT INTO matches
         (id, code, stage, grp, matchday, label, home_team, away_team,
          home_label, away_label, home_src, away_src, kickoff_at, venue,
          home_score, away_score, finished, advancer,
          status, live_home, live_away, minute, api_fixture_id, live_updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      m.id, m.code, m.stage, m.grp, m.matchday, m.label, m.home_team, m.away_team,
      m.home_label, m.away_label, m.home_src, m.away_src, m.kickoff_at, m.venue,
      m.home_score, m.away_score, m.finished ?? 0, m.advancer ?? null,
      m.status ?? null, m.live_home ?? null, m.live_away ?? null,
      m.minute ?? null, m.api_fixture_id ?? null, m.live_updated_at ?? null,
    ],
  })));

  // 4) Usuarios con sus ids originales
  console.log(`4/7 Insertando ${backup.users.length} usuarios...`);
  await batchInsert(backup.users.map((u) => ({
    sql: `INSERT INTO users (id, email, apodo, is_admin, is_active, created_at)
       VALUES (?,?,?,?,?,?)`,
    args: [u.id, u.email, u.apodo, u.is_admin, u.is_active ?? 1, u.created_at],
  })));

  // 5) Predicciones y picks de torneo
  console.log(`5/7 Insertando ${backup.predictions.length} predicciones y ${backup.tournamentPicks.length} picks...`);
  await batchInsert(backup.predictions.map((p) => ({
    sql: `INSERT INTO predictions (user_id, match_id, home_score, away_score, advances, updated_at)
       VALUES (?,?,?,?,?,?)`,
    args: [p.user_id, p.match_id, p.home_score, p.away_score, p.advances ?? null, p.updated_at],
  })));
  await batchInsert(backup.tournamentPicks.map((t) => ({
    sql: `INSERT INTO tournament_picks
         (user_id, champion, runner_up, top_scorer, best_goalkeeper, best_player, best_young_player, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    args: [
      t.user_id, t.champion, t.runner_up, t.top_scorer, t.best_goalkeeper,
      t.best_player ?? null, t.best_young_player ?? null, t.updated_at,
    ],
  })));

  // 6) Settings
  console.log(`6/7 Insertando ${backup.settings.length} settings...`);
  for (const s of backup.settings) {
    await dbRun(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [s.key, s.value]
    );
  }

  // 7) Equipos, polls y votos de la comunidad (opcionales: pueden faltar en
  // backups antiguos; si vienen, mandan sobre lo que sembró seed()).
  const teams = backup.teams ?? [];
  const polls = backup.polls ?? [];
  const pollVotes = backup.pollVotes ?? [];
  console.log(`7/7 Restaurando ${teams.length} equipos, ${polls.length} polls, ${pollVotes.length} votos...`);
  if (teams.length) {
    await batchInsert(teams.map((t) => ({
      sql: `INSERT INTO teams (id, name, flag, grp) VALUES (?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, flag = excluded.flag, grp = excluded.grp`,
      args: [t.id, t.name, t.flag ?? null, t.grp ?? null],
    })));
  }
  if (polls.length) {
    await batchInsert(polls.map((p) => ({
      sql: `INSERT INTO polls (key, question, options, results_public, sort_order) VALUES (?,?,?,?,?)
            ON CONFLICT(key) DO UPDATE SET question = excluded.question, options = excluded.options,
              results_public = excluded.results_public, sort_order = excluded.sort_order`,
      args: [p.key, p.question, p.options, p.results_public ?? 0, p.sort_order ?? 0],
    })));
  }
  if (pollVotes.length) {
    // los votos dependen de users (ya insertados en el paso 4)
    await batchInsert(pollVotes.map((v) => ({
      sql: `INSERT INTO poll_votes (poll_key, user_id, choice, updated_at) VALUES (?,?,?,?)
            ON CONFLICT(poll_key, user_id) DO UPDATE SET choice = excluded.choice, updated_at = excluded.updated_at`,
      args: [v.poll_key, v.user_id, v.choice, v.updated_at ?? new Date().toISOString()],
    })));
  }

  await showCounts("✅ Listo. Estado final de la base de pruebas:");
  await db.close();
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("Uso: npm run seed:backup -- <ruta-al-backup.json> [--dry]");
    process.exit(1);
  }
  main(file, dry).catch((e) => { console.error("Error:", e); process.exit(1); });
}
