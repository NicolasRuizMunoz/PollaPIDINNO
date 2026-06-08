import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? join(__dirname, "..", "polla.db");

export const db = new DatabaseSync(DB_PATH);

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT NOT NULL UNIQUE,
      apodo      TEXT NOT NULL,
      is_admin   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS teams (
      id    TEXT PRIMARY KEY,          -- codigo, ej "ARG"
      name  TEXT NOT NULL,             -- "Argentina"
      flag  TEXT,                      -- emoji bandera
      grp   TEXT                       -- grupo "A".."L" (null si por definir)
    );

    CREATE TABLE IF NOT EXISTS matches (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      code         TEXT,                     -- codigo estable de eliminatoria: M1..M16, O1..O8, Q1..Q4, S1..S2, F1, 3P
      stage        TEXT NOT NULL,            -- group | r32 | r16 | qf | sf | final | third
      grp          TEXT,                     -- grupo si aplica
      matchday     INTEGER,                  -- jornada (1,2,3) en fase de grupos
      label        TEXT,                     -- "Grupo A · J1", "Octavos #1", etc.
      home_team    TEXT REFERENCES teams(id),
      away_team    TEXT REFERENCES teams(id),
      home_label   TEXT,                     -- texto mientras el equipo no se conoce
      away_label   TEXT,
      home_src     TEXT,                     -- fuente del equipo local (WG:A, RU:B, TH:1, WM:M1, LM:S1)
      away_src     TEXT,
      kickoff_at   TEXT NOT NULL,            -- ISO datetime UTC
      venue        TEXT,
      home_score   INTEGER,                  -- null = no jugado
      away_score   INTEGER,
      finished     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS predictions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      match_id   INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      home_score INTEGER NOT NULL,
      away_score INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, match_id)
    );

    CREATE TABLE IF NOT EXISTS tournament_picks (
      user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      champion        TEXT,
      runner_up       TEXT,
      top_scorer      TEXT,
      best_goalkeeper TEXT,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- configuracion clave/valor (resultados de torneo, fecha de cierre de bonos, etc.)
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// ---- helpers de settings ----

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}
