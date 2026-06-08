/**
 * Restaura datos de un backup JSON generado por GET /api/admin/backup.
 *
 * Restaura: usuarios, predicciones, picks de torneo, resultados de partidos
 * y settings. NO toca la definición de equipos ni el fixture base (eso es del seed).
 *
 * Uso:
 *   npm run restore -- ruta/al/backup.json
 *
 * Ejemplo:
 *   npm run restore -- polla-backup-2026-06-08.json
 *
 * ⚠️  Usa la misma base configurada en .env (Turso si hay TURSO_DATABASE_URL,
 *     o file:polla.db local). Ejecuta ANTES de correr el seed si vas a combinar.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dbRun, ensureSchema, db } from "./db.js";

interface BackupUser {
  id: number;
  email: string;
  apodo: string;
  is_admin: number;
  is_active: number;
  created_at: string;
}

interface BackupPrediction {
  id: number;
  user_id: number;
  match_id: number;
  home_score: number;
  away_score: number;
  updated_at: string;
}

interface BackupTournamentPick {
  user_id: number;
  champion: string | null;
  runner_up: string | null;
  top_scorer: string | null;
  best_goalkeeper: string | null;
  updated_at: string;
}

interface BackupMatch {
  id: number;
  home_score: number | null;
  away_score: number | null;
  finished: number;
  home_team: string | null;
  away_team: string | null;
  kickoff_at: string;
  venue: string | null;
}

interface BackupSetting {
  key: string;
  value: string | null;
}

interface Backup {
  exportedAt: string;
  users: BackupUser[];
  predictions: BackupPrediction[];
  tournamentPicks: BackupTournamentPick[];
  matches: BackupMatch[];
  settings: BackupSetting[];
}

async function restore(filePath: string) {
  console.log(`Leyendo backup: ${filePath}`);
  const raw = readFileSync(filePath, "utf-8");
  const backup: Backup = JSON.parse(raw);
  console.log(`Backup del ${backup.exportedAt}`);
  console.log(`  ${backup.users.length} usuarios`);
  console.log(`  ${backup.predictions.length} predicciones`);
  console.log(`  ${backup.tournamentPicks.length} picks de torneo`);
  console.log(`  ${backup.settings.length} settings`);

  await ensureSchema();

  // Usuarios (upsert por email — preserva el ID original si es posible)
  console.log("\nRestaurando usuarios...");
  for (const u of backup.users) {
    await dbRun(
      `INSERT INTO users (id, email, apodo, is_admin, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         apodo      = excluded.apodo,
         is_admin   = excluded.is_admin,
         is_active  = excluded.is_active,
         created_at = excluded.created_at`,
      [u.id, u.email, u.apodo, u.is_admin, u.is_active ?? 1, u.created_at]
    );
  }
  console.log(`  ✓ ${backup.users.length} usuarios`);

  // Predicciones (upsert por user_id + match_id)
  console.log("Restaurando predicciones...");
  for (const p of backup.predictions) {
    await dbRun(
      `INSERT INTO predictions (user_id, match_id, home_score, away_score, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, match_id) DO UPDATE SET
         home_score = excluded.home_score,
         away_score = excluded.away_score,
         updated_at = excluded.updated_at`,
      [p.user_id, p.match_id, p.home_score, p.away_score, p.updated_at]
    );
  }
  console.log(`  ✓ ${backup.predictions.length} predicciones`);

  // Picks de torneo (upsert por user_id)
  console.log("Restaurando picks de torneo...");
  for (const t of backup.tournamentPicks) {
    await dbRun(
      `INSERT INTO tournament_picks (user_id, champion, runner_up, top_scorer, best_goalkeeper, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         champion        = excluded.champion,
         runner_up       = excluded.runner_up,
         top_scorer      = excluded.top_scorer,
         best_goalkeeper = excluded.best_goalkeeper,
         updated_at      = excluded.updated_at`,
      [t.user_id, t.champion, t.runner_up, t.top_scorer, t.best_goalkeeper, t.updated_at]
    );
  }
  console.log(`  ✓ ${backup.tournamentPicks.length} picks de torneo`);

  // Resultados de partidos (solo actualiza scores y finished, no el fixture)
  console.log("Restaurando resultados de partidos...");
  let matchesUpdated = 0;
  for (const m of backup.matches) {
    if (m.home_score === null && m.away_score === null && !m.finished) continue;
    await dbRun(
      `UPDATE matches SET
         home_score = ?, away_score = ?, finished = ?,
         home_team  = COALESCE(home_team, ?),
         away_team  = COALESCE(away_team, ?),
         kickoff_at = ?,
         venue      = COALESCE(venue, ?)
       WHERE id = ?`,
      [
        m.home_score, m.away_score, m.finished,
        m.home_team, m.away_team,
        m.kickoff_at,
        m.venue,
        m.id,
      ]
    );
    matchesUpdated++;
  }
  console.log(`  ✓ ${matchesUpdated} partidos con resultado`);

  // Settings
  console.log("Restaurando settings...");
  for (const s of backup.settings) {
    await dbRun(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [s.key, s.value]
    );
  }
  console.log(`  ✓ ${backup.settings.length} settings`);

  await db.close();
  console.log("\n✅ Restore completado.");
}

// Ejecutar solo si este archivo es el punto de entrada
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) {
    console.error("Uso: npm run restore -- <ruta-al-backup.json>");
    process.exit(1);
  }
  restore(file).catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  });
}
