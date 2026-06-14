/**
 * Seguimiento de resultados EN VIVO (provisional).
 *
 * Idea general:
 *  - Un cron externo (cron-job.org, GitHub Actions, etc.) pega cada ~3 min a
 *    GET /api/cron/live.
 *  - Ese endpoint llama a `updateLiveMatches()`, que:
 *      1. Mira si hay partidos "en ventana de juego". Si no hay, NO llama a la
 *         API (así no se gasta cuota).
 *      2. Pide los partidos en vivo a una API deportiva.
 *      3. Empareja cada partido en vivo con uno nuestro y guarda el marcador
 *         provisional (live_home/live_away/minute/status) SIN tocar `finished`.
 *  - El puntaje oficial sigue dependiendo de que el admin publique el resultado.
 *
 * Configuración (variables de entorno):
 *  - LIVE_API_KEY      → API key de api-sports.io (API-Football). Sin esto, se
 *                        omite la actualización.
 *  - LIVE_API_HOST     → host de la API (default: v3.football.api-sports.io).
 *  - LIVE_LEAGUE_ID    → id de liga del Mundial en API-Football (default: 1).
 *  - LIVE_SEASON       → temporada (default: 2026).
 *  - CRON_SECRET       → secreto que debe traer el cron (lo valida el endpoint).
 */
import { dbAll, dbRun } from "./db.js";

/** Ventana en la que un partido se considera "potencialmente en juego". */
const PRE_MINUTES = 10; // margen antes del kickoff (por desfases de horario)
const MATCH_MAX_MINUTES = 200; // ~3h20: cubre alargues y tanda de penales

/** Normaliza un texto para comparar nombres de equipo (sin acentos, minúsculas). */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export interface LiveFixture {
  fixtureId: number;
  homeCode: string | null; // código (FIFA) según la API, si lo trae
  awayCode: string | null;
  homeName: string;
  awayName: string;
  homeScore: number | null;
  awayScore: number | null;
  status: LiveStatus;
  minute: number | null;
}

export type LiveStatus = "NS" | "LIVE" | "HT" | "FT" | "OTHER";

/** Mapea el código de estado de API-Football a nuestro enum simple. */
function mapStatus(short: string): LiveStatus {
  switch (short) {
    case "1H":
    case "2H":
    case "ET":
    case "BT":
    case "P":
    case "LIVE":
      return "LIVE";
    case "HT":
      return "HT";
    case "FT":
    case "AET":
    case "PEN":
      return "FT";
    case "NS":
    case "TBD":
      return "NS";
    default:
      return "OTHER";
  }
}

interface MatchRow {
  id: number;
  home_team: string | null;
  away_team: string | null;
  api_fixture_id: number | null;
  kickoff_at: string;
}

interface TeamRow {
  id: string;
  name: string;
}

/**
 * Trae los partidos en vivo desde la API deportiva.
 * Adaptador para API-Football (api-sports.io). Si usas otra API, cambia solo
 * esta función para devolver `LiveFixture[]`.
 */
async function fetchLiveFixtures(): Promise<LiveFixture[]> {
  const key = process.env.LIVE_API_KEY;
  if (!key) throw new Error("Falta LIVE_API_KEY");

  const host = process.env.LIVE_API_HOST ?? "v3.football.api-sports.io";
  const league = process.env.LIVE_LEAGUE_ID ?? "1";
  const season = process.env.LIVE_SEASON ?? "2026";

  const url = `https://${host}/fixtures?live=all&league=${encodeURIComponent(
    league
  )}&season=${encodeURIComponent(season)}`;

  const res = await fetch(url, {
    headers: { "x-apisports-key": key },
  });
  if (!res.ok) {
    throw new Error(`API en vivo respondió ${res.status}`);
  }
  const data = (await res.json()) as ApiFootballResponse;

  return (data.response ?? []).map((f) => ({
    fixtureId: f.fixture.id,
    homeCode: f.teams.home.code ?? null,
    awayCode: f.teams.away.code ?? null,
    homeName: f.teams.home.name,
    awayName: f.teams.away.name,
    homeScore: f.goals.home,
    awayScore: f.goals.away,
    status: mapStatus(f.fixture.status.short),
    minute: f.fixture.status.elapsed ?? null,
  }));
}

// --- forma (parcial) de la respuesta de API-Football ---
interface ApiFootballResponse {
  response?: {
    fixture: { id: number; status: { short: string; elapsed: number | null } };
    teams: {
      home: { name: string; code?: string | null };
      away: { name: string; code?: string | null };
    };
    goals: { home: number | null; away: number | null };
  }[];
}

export interface LiveUpdateResult {
  skipped: boolean;
  reason?: string;
  inWindow: number;
  liveFromApi: number;
  updated: number;
}

/**
 * Punto de entrada del cron. Actualiza los marcadores en vivo de los partidos
 * que están en ventana de juego. Es seguro llamarla seguido: si no hay nada en
 * juego, retorna sin pegarle a la API.
 */
export async function updateLiveMatches(): Promise<LiveUpdateResult> {
  const now = Date.now();
  const all = await dbAll<MatchRow>(
    "SELECT id, home_team, away_team, api_fixture_id, kickoff_at FROM matches WHERE finished = 0"
  );
  const inWindow = all.filter((m) => {
    const ko = new Date(m.kickoff_at).getTime();
    return now >= ko - PRE_MINUTES * 60_000 && now <= ko + MATCH_MAX_MINUTES * 60_000;
  });

  if (inWindow.length === 0) {
    return { skipped: true, reason: "sin partidos en ventana", inWindow: 0, liveFromApi: 0, updated: 0 };
  }
  if (!process.env.LIVE_API_KEY) {
    return { skipped: true, reason: "falta LIVE_API_KEY", inWindow: inWindow.length, liveFromApi: 0, updated: 0 };
  }

  const live = await fetchLiveFixtures();

  // índice para resolver el equipo de la API a nuestro id (por código FIFA y por nombre)
  const teams = await dbAll<TeamRow>("SELECT id, name FROM teams");
  const byKey = new Map<string, string>();
  for (const t of teams) {
    byKey.set(norm(t.id), t.id);
    byKey.set(norm(t.name), t.id);
  }
  const resolve = (code: string | null, name: string): string | null => {
    if (code) {
      const byCode = byKey.get(norm(code));
      if (byCode) return byCode;
    }
    return byKey.get(norm(name)) ?? null;
  };

  let updated = 0;
  for (const f of live) {
    const homeId = resolve(f.homeCode, f.homeName);
    const awayId = resolve(f.awayCode, f.awayName);

    // 1) por api_fixture_id ya emparejado; 2) por equipos dentro de la ventana
    let match = inWindow.find((m) => m.api_fixture_id === f.fixtureId);
    if (!match && homeId && awayId) {
      match = inWindow.find(
        (m) => m.home_team === homeId && m.away_team === awayId
      );
    }
    if (!match) continue;

    await dbRun(
      `UPDATE matches
         SET live_home = ?, live_away = ?, minute = ?, status = ?,
             api_fixture_id = ?, live_updated_at = datetime('now')
       WHERE id = ?`,
      [f.homeScore, f.awayScore, f.minute, f.status, f.fixtureId, match.id]
    );
    updated++;
  }

  return { skipped: false, inWindow: inWindow.length, liveFromApi: live.length, updated };
}
