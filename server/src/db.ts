import type { Client, InArgs } from "@libsql/client";

/**
 * Cliente de base de datos (libSQL / Turso).
 *
 * - En producción (Vercel): define TURSO_DATABASE_URL y TURSO_AUTH_TOKEN.
 *   Como es una URL remota (libsql://), usamos el cliente "web" (solo HTTP, sin
 *   binarios nativos) que es el que funciona en serverless.
 * - En local/desarrollo: si no hay TURSO_DATABASE_URL, usa un archivo SQLite
 *   local (file:polla.db) con el cliente normal (con soporte nativo).
 */
const url = process.env.TURSO_DATABASE_URL ?? "file:polla.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

const { createClient } = url.startsWith("file:")
  ? await import("@libsql/client")
  : await import("@libsql/client/web");

export const db: Client = createClient({ url, authToken, intMode: "number" });

// ---- helpers async (reemplazan al prepare().get()/all()/run() síncrono) ----

export async function dbAll<T>(sql: string, args: InArgs = []): Promise<T[]> {
  const r = await db.execute({ sql, args });
  return r.rows as unknown as T[];
}

export async function dbGet<T>(sql: string, args: InArgs = []): Promise<T | undefined> {
  const r = await db.execute({ sql, args });
  return (r.rows[0] as unknown as T) ?? undefined;
}

export async function dbRun(sql: string, args: InArgs = []) {
  return db.execute({ sql, args });
}

// ---- esquema ----

export async function initSchema(): Promise<void> {
  await db.executeMultiple(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT NOT NULL UNIQUE,
      apodo      TEXT NOT NULL,
      is_admin   INTEGER NOT NULL DEFAULT 0,
      is_active  INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS teams (
      id    TEXT PRIMARY KEY,
      name  TEXT NOT NULL,
      flag  TEXT,
      grp   TEXT
    );

    CREATE TABLE IF NOT EXISTS matches (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      code         TEXT,
      stage        TEXT NOT NULL,
      grp          TEXT,
      matchday     INTEGER,
      label        TEXT,
      home_team    TEXT REFERENCES teams(id),
      away_team    TEXT REFERENCES teams(id),
      home_label   TEXT,
      away_label   TEXT,
      home_src     TEXT,
      away_src     TEXT,
      kickoff_at   TEXT NOT NULL,
      venue        TEXT,
      home_score   INTEGER,
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

// Migration: add is_active to users table in existing databases
async function runMigrations(): Promise<void> {
  try {
    await dbRun("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0");
  } catch {
    // Column already exists — safe to ignore
  }
}

// asegura el esquema una sola vez por proceso (útil en serverless)
let schemaPromise: Promise<void> | null = null;
export function ensureSchema(): Promise<void> {
  if (!schemaPromise) schemaPromise = initSchema().then(runMigrations);
  return schemaPromise;
}

// ---- settings ----

export async function getSetting(key: string): Promise<string | null> {
  const row = await dbGet<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    [key]
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  await dbRun(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}
