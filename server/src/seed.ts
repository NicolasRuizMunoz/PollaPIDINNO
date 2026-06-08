/**
 * Siembra los datos del Mundial 2026: 48 equipos, 12 grupos (sorteo oficial del
 * 5 de diciembre de 2025), los 72 partidos de fase de grupos con fechas y horas
 * reales en UTC (fuente: fixture oficial FIFA) y el cuadro de eliminatorias.
 *
 * Ejecutar:  npm run seed  ⚠️ BORRA equipos, partidos y predicciones.
 */
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { dbRun, initSchema, db } from "./db.js";

interface SeedTeam { id: string; name: string; flag: string; }

const GROUPS: Record<string, SeedTeam[]> = {
  A: [
    { id: "MEX", name: "México",           flag: "🇲🇽" },
    { id: "RSA", name: "Sudáfrica",         flag: "🇿🇦" },
    { id: "KOR", name: "Corea del Sur",     flag: "🇰🇷" },
    { id: "CZE", name: "Chequia",           flag: "🇨🇿" },
  ],
  B: [
    { id: "CAN", name: "Canadá",            flag: "🇨🇦" },
    { id: "BIH", name: "Bosnia y Herzegovina", flag: "🇧🇦" },
    { id: "QAT", name: "Catar",             flag: "🇶🇦" },
    { id: "SUI", name: "Suiza",             flag: "🇨🇭" },
  ],
  C: [
    { id: "BRA", name: "Brasil",            flag: "🇧🇷" },
    { id: "MAR", name: "Marruecos",         flag: "🇲🇦" },
    { id: "HAI", name: "Haití",             flag: "🇭🇹" },
    { id: "SCO", name: "Escocia",           flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" },
  ],
  D: [
    { id: "USA", name: "Estados Unidos",    flag: "🇺🇸" },
    { id: "PAR", name: "Paraguay",          flag: "🇵🇾" },
    { id: "AUS", name: "Australia",         flag: "🇦🇺" },
    { id: "TUR", name: "Turquía",           flag: "🇹🇷" },
  ],
  E: [
    { id: "GER", name: "Alemania",          flag: "🇩🇪" },
    { id: "CUW", name: "Curazao",           flag: "🇨🇼" },
    { id: "CIV", name: "Costa de Marfil",   flag: "🇨🇮" },
    { id: "ECU", name: "Ecuador",           flag: "🇪🇨" },
  ],
  F: [
    { id: "NED", name: "Países Bajos",      flag: "🇳🇱" },
    { id: "JPN", name: "Japón",             flag: "🇯🇵" },
    { id: "SWE", name: "Suecia",            flag: "🇸🇪" },
    { id: "TUN", name: "Túnez",             flag: "🇹🇳" },
  ],
  G: [
    { id: "BEL", name: "Bélgica",           flag: "🇧🇪" },
    { id: "EGY", name: "Egipto",            flag: "🇪🇬" },
    { id: "IRN", name: "Irán",              flag: "🇮🇷" },
    { id: "NZL", name: "Nueva Zelanda",     flag: "🇳🇿" },
  ],
  H: [
    { id: "ESP", name: "España",            flag: "🇪🇸" },
    { id: "CPV", name: "Cabo Verde",        flag: "🇨🇻" },
    { id: "KSA", name: "Arabia Saudita",    flag: "🇸🇦" },
    { id: "URU", name: "Uruguay",           flag: "🇺🇾" },
  ],
  I: [
    { id: "FRA", name: "Francia",           flag: "🇫🇷" },
    { id: "SEN", name: "Senegal",           flag: "🇸🇳" },
    { id: "IRQ", name: "Irak",              flag: "🇮🇶" },
    { id: "NOR", name: "Noruega",           flag: "🇳🇴" },
  ],
  J: [
    { id: "ARG", name: "Argentina",         flag: "🇦🇷" },
    { id: "ALG", name: "Argelia",           flag: "🇩🇿" },
    { id: "AUT", name: "Austria",           flag: "🇦🇹" },
    { id: "JOR", name: "Jordania",          flag: "🇯🇴" },
  ],
  K: [
    { id: "POR", name: "Portugal",          flag: "🇵🇹" },
    { id: "COD", name: "RD Congo",          flag: "🇨🇩" },
    { id: "UZB", name: "Uzbekistán",        flag: "🇺🇿" },
    { id: "COL", name: "Colombia",          flag: "🇨🇴" },
  ],
  L: [
    { id: "ENG", name: "Inglaterra",        flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
    { id: "CRO", name: "Croacia",           flag: "🇭🇷" },
    { id: "GHA", name: "Ghana",             flag: "🇬🇭" },
    { id: "PAN", name: "Panamá",            flag: "🇵🇦" },
  ],
};

/** Crea un timestamp ISO en UTC. */
function iso(y: number, m: number, d: number, h: number, min = 0): string {
  return new Date(Date.UTC(y, m - 1, d, h, min, 0)).toISOString();
}

// ── Partidos de grupos — fechas y horas en UTC (fuente: fixture oficial FIFA) ──
// Todas las horas se convierten desde ET (UTC-4) o local de la sede.

interface GroupMatch {
  grp: string; matchday: number;
  home: string; away: string;
  m: number; d: number; h: number; min?: number;
  venue: string;
}

const GROUP_MATCHES: GroupMatch[] = [
  // ════════ JORNADA 1 ════════════════════════════════════════════

  // 11 jun
  { grp:"A", matchday:1, home:"MEX", away:"RSA", m:6, d:11, h:19,      venue:"Estadio Azteca, Ciudad de México" },
  // 12 jun
  { grp:"A", matchday:1, home:"KOR", away:"CZE", m:6, d:12, h: 2,      venue:"Estadio Akron, Guadalajara" },
  { grp:"B", matchday:1, home:"CAN", away:"BIH", m:6, d:12, h:19,      venue:"BMO Field, Toronto" },
  // 13 jun
  { grp:"D", matchday:1, home:"USA", away:"PAR", m:6, d:13, h: 1,      venue:"SoFi Stadium, Los Ángeles" },
  { grp:"B", matchday:1, home:"QAT", away:"SUI", m:6, d:13, h:19,      venue:"Levi's Stadium, Santa Clara" },
  { grp:"C", matchday:1, home:"BRA", away:"MAR", m:6, d:13, h:22,      venue:"MetLife Stadium, Nueva York/Nueva Jersey" },
  // 14 jun
  { grp:"C", matchday:1, home:"HAI", away:"SCO", m:6, d:14, h: 1,      venue:"Gillette Stadium, Boston" },
  { grp:"D", matchday:1, home:"AUS", away:"TUR", m:6, d:14, h: 4,      venue:"BC Place, Vancouver" },
  { grp:"E", matchday:1, home:"GER", away:"CUW", m:6, d:14, h:17,      venue:"NRG Stadium, Houston" },
  { grp:"F", matchday:1, home:"NED", away:"JPN", m:6, d:14, h:20,      venue:"AT&T Stadium, Dallas/Fort Worth" },
  { grp:"E", matchday:1, home:"CIV", away:"ECU", m:6, d:14, h:23,      venue:"Lincoln Financial Field, Filadelfia" },
  // 15 jun
  { grp:"F", matchday:1, home:"SWE", away:"TUN", m:6, d:15, h: 2,      venue:"Estadio Akron, Guadalajara" },
  { grp:"H", matchday:1, home:"ESP", away:"CPV", m:6, d:15, h:16,      venue:"Mercedes-Benz Stadium, Atlanta" },
  { grp:"G", matchday:1, home:"BEL", away:"EGY", m:6, d:15, h:19,      venue:"Lumen Field, Seattle" },
  { grp:"H", matchday:1, home:"KSA", away:"URU", m:6, d:15, h:22,      venue:"Hard Rock Stadium, Miami" },
  // 16 jun
  { grp:"G", matchday:1, home:"IRN", away:"NZL", m:6, d:16, h: 1,      venue:"SoFi Stadium, Los Ángeles" },
  { grp:"I", matchday:1, home:"FRA", away:"SEN", m:6, d:16, h:19,      venue:"MetLife Stadium, Nueva York/Nueva Jersey" },
  { grp:"I", matchday:1, home:"IRQ", away:"NOR", m:6, d:16, h:22,      venue:"Gillette Stadium, Boston" },
  // 17 jun
  { grp:"J", matchday:1, home:"ARG", away:"ALG", m:6, d:17, h: 1,      venue:"Arrowhead Stadium, Kansas City" },
  { grp:"J", matchday:1, home:"AUT", away:"JOR", m:6, d:17, h: 4,      venue:"Levi's Stadium, Santa Clara" },
  { grp:"K", matchday:1, home:"POR", away:"COD", m:6, d:17, h:17,      venue:"NRG Stadium, Houston" },
  { grp:"L", matchday:1, home:"ENG", away:"CRO", m:6, d:17, h:20,      venue:"AT&T Stadium, Dallas/Fort Worth" },
  { grp:"L", matchday:1, home:"GHA", away:"PAN", m:6, d:17, h:23,      venue:"BMO Field, Toronto" },
  // 18 jun (madrugada UTC — partido del 17 jun local)
  { grp:"K", matchday:1, home:"UZB", away:"COL", m:6, d:18, h: 2,      venue:"Estadio Azteca, Ciudad de México" },

  // ════════ JORNADA 2 ════════════════════════════════════════════

  // 18 jun
  { grp:"A", matchday:2, home:"CZE", away:"RSA", m:6, d:18, h:16,      venue:"Mercedes-Benz Stadium, Atlanta" },
  { grp:"B", matchday:2, home:"SUI", away:"BIH", m:6, d:18, h:19,      venue:"SoFi Stadium, Los Ángeles" },
  { grp:"B", matchday:2, home:"CAN", away:"QAT", m:6, d:18, h:22,      venue:"BC Place, Vancouver" },
  // 19 jun
  { grp:"A", matchday:2, home:"MEX", away:"KOR", m:6, d:19, h: 1,      venue:"Estadio Akron, Guadalajara" },
  { grp:"D", matchday:2, home:"USA", away:"AUS", m:6, d:19, h:19,      venue:"Lumen Field, Seattle" },
  { grp:"C", matchday:2, home:"SCO", away:"MAR", m:6, d:19, h:22,      venue:"Gillette Stadium, Boston" },
  // 20 jun
  { grp:"C", matchday:2, home:"BRA", away:"HAI", m:6, d:20, h: 1,      venue:"Lincoln Financial Field, Filadelfia" },
  { grp:"D", matchday:2, home:"TUR", away:"PAR", m:6, d:20, h: 4,      venue:"Levi's Stadium, Santa Clara" },
  { grp:"F", matchday:2, home:"NED", away:"SWE", m:6, d:20, h:17,      venue:"NRG Stadium, Houston" },
  { grp:"E", matchday:2, home:"GER", away:"CIV", m:6, d:20, h:20,      venue:"BMO Field, Toronto" },
  // 21 jun
  { grp:"E", matchday:2, home:"ECU", away:"CUW", m:6, d:21, h: 2,      venue:"Arrowhead Stadium, Kansas City" },
  { grp:"F", matchday:2, home:"TUN", away:"JPN", m:6, d:21, h: 4,      venue:"Estadio Akron, Guadalajara" },
  { grp:"H", matchday:2, home:"ESP", away:"KSA", m:6, d:21, h:16,      venue:"Mercedes-Benz Stadium, Atlanta" },
  { grp:"G", matchday:2, home:"BEL", away:"IRN", m:6, d:21, h:19,      venue:"SoFi Stadium, Los Ángeles" },
  { grp:"H", matchday:2, home:"URU", away:"CPV", m:6, d:21, h:22,      venue:"Hard Rock Stadium, Miami" },
  // 22 jun
  { grp:"G", matchday:2, home:"NZL", away:"EGY", m:6, d:22, h: 1,      venue:"BC Place, Vancouver" },
  { grp:"J", matchday:2, home:"ARG", away:"AUT", m:6, d:22, h:17,      venue:"AT&T Stadium, Dallas/Fort Worth" },
  { grp:"I", matchday:2, home:"FRA", away:"IRQ", m:6, d:22, h:21,      venue:"Lincoln Financial Field, Filadelfia" },
  // 23 jun
  { grp:"I", matchday:2, home:"NOR", away:"SEN", m:6, d:23, h: 0,      venue:"MetLife Stadium, Nueva York/Nueva Jersey" },
  { grp:"J", matchday:2, home:"JOR", away:"ALG", m:6, d:23, h: 3,      venue:"Levi's Stadium, Santa Clara" },
  { grp:"K", matchday:2, home:"POR", away:"UZB", m:6, d:23, h:17,      venue:"NRG Stadium, Houston" },
  { grp:"L", matchday:2, home:"ENG", away:"GHA", m:6, d:23, h:20,      venue:"Gillette Stadium, Boston" },
  { grp:"L", matchday:2, home:"PAN", away:"CRO", m:6, d:23, h:23,      venue:"BMO Field, Toronto" },
  // 24 jun
  { grp:"K", matchday:2, home:"COL", away:"COD", m:6, d:24, h: 2,      venue:"Estadio Akron, Guadalajara" },

  // ════════ JORNADA 3 — simultáneos por grupo ════════════════════

  // 24 jun — Grupos B y C
  { grp:"B", matchday:3, home:"SUI", away:"CAN", m:6, d:24, h:19,      venue:"BC Place, Vancouver" },
  { grp:"B", matchday:3, home:"BIH", away:"QAT", m:6, d:24, h:19,      venue:"Lumen Field, Seattle" },
  { grp:"C", matchday:3, home:"SCO", away:"BRA", m:6, d:24, h:22,      venue:"Hard Rock Stadium, Miami" },
  { grp:"C", matchday:3, home:"MAR", away:"HAI", m:6, d:24, h:22,      venue:"Mercedes-Benz Stadium, Atlanta" },
  // 25 jun — Grupo A (madrugada), Grupos E y F
  { grp:"A", matchday:3, home:"CZE", away:"MEX", m:6, d:25, h: 1,      venue:"Estadio Azteca, Ciudad de México" },
  { grp:"A", matchday:3, home:"RSA", away:"KOR", m:6, d:25, h: 1,      venue:"Estadio BBVA, Monterrey" },
  { grp:"E", matchday:3, home:"ECU", away:"GER", m:6, d:25, h:20,      venue:"MetLife Stadium, Nueva York/Nueva Jersey" },
  { grp:"E", matchday:3, home:"CUW", away:"CIV", m:6, d:25, h:20,      venue:"Lincoln Financial Field, Filadelfia" },
  { grp:"F", matchday:3, home:"JPN", away:"SWE", m:6, d:25, h:23,      venue:"AT&T Stadium, Dallas/Fort Worth" },
  { grp:"F", matchday:3, home:"TUN", away:"NED", m:6, d:25, h:23,      venue:"Arrowhead Stadium, Kansas City" },
  // 26 jun — Grupo D (madrugada), Grupos I
  { grp:"D", matchday:3, home:"TUR", away:"USA", m:6, d:26, h: 2,      venue:"SoFi Stadium, Los Ángeles" },
  { grp:"D", matchday:3, home:"PAR", away:"AUS", m:6, d:26, h: 2,      venue:"Levi's Stadium, Santa Clara" },
  { grp:"I", matchday:3, home:"NOR", away:"FRA", m:6, d:26, h:19,      venue:"Gillette Stadium, Boston" },
  { grp:"I", matchday:3, home:"SEN", away:"IRQ", m:6, d:26, h:19,      venue:"BMO Field, Toronto" },
  // 27 jun — Grupos H y G (madrugada UTC), Grupos L y K
  { grp:"H", matchday:3, home:"CPV", away:"KSA", m:6, d:27, h: 0,      venue:"NRG Stadium, Houston" },
  { grp:"H", matchday:3, home:"URU", away:"ESP", m:6, d:27, h: 0,      venue:"Estadio Akron, Guadalajara" },
  { grp:"G", matchday:3, home:"EGY", away:"IRN", m:6, d:27, h: 3,      venue:"Lumen Field, Seattle" },
  { grp:"G", matchday:3, home:"NZL", away:"BEL", m:6, d:27, h: 3,      venue:"BC Place, Vancouver" },
  { grp:"L", matchday:3, home:"PAN", away:"ENG", m:6, d:27, h:21,      venue:"MetLife Stadium, Nueva York/Nueva Jersey" },
  { grp:"L", matchday:3, home:"CRO", away:"GHA", m:6, d:27, h:21,      venue:"Lincoln Financial Field, Filadelfia" },
  { grp:"K", matchday:3, home:"COL", away:"POR", m:6, d:27, h:23, min:30, venue:"Hard Rock Stadium, Miami" },
  { grp:"K", matchday:3, home:"COD", away:"UZB", m:6, d:27, h:23, min:30, venue:"Mercedes-Benz Stadium, Atlanta" },
  // 28 jun — Grupo J (madrugada UTC)
  { grp:"J", matchday:3, home:"ALG", away:"AUT", m:6, d:28, h: 2,      venue:"Arrowhead Stadium, Kansas City" },
  { grp:"J", matchday:3, home:"JOR", away:"ARG", m:6, d:28, h: 2,      venue:"AT&T Stadium, Dallas/Fort Worth" },
];

function srcLabel(src: string): string {
  const [kind, arg] = src.split(":");
  switch (kind) {
    case "WG": return `1º Grupo ${arg}`;
    case "RU": return `2º Grupo ${arg}`;
    case "TH": return `Mejor 3º (${arg})`;
    case "WM": return `Ganador ${arg}`;
    case "LM": return `Perdedor ${arg}`;
    default:   return "Por definir";
  }
}

const MATCH_COLS =
  "code, stage, grp, matchday, label, home_team, away_team, home_label, away_label, home_src, away_src, kickoff_at, venue";

interface MatchInsert {
  code: string | null; stage: string; grp: string | null; matchday: number | null;
  label: string; home_team: string | null; away_team: string | null;
  home_label: string | null; away_label: string | null;
  home_src: string | null; away_src: string | null;
  kickoff_at: string; venue: string | null;
}

async function insertMatch(m: MatchInsert) {
  await dbRun(
    `INSERT INTO matches (${MATCH_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [m.code, m.stage, m.grp, m.matchday, m.label, m.home_team, m.away_team,
     m.home_label, m.away_label, m.home_src, m.away_src, m.kickoff_at, m.venue]
  );
}

export async function seed() {
  await initSchema();

  console.log("Limpiando datos previos de equipos y partidos...");
  await db.executeMultiple(
    "DELETE FROM predictions; DELETE FROM tournament_picks; DELETE FROM matches; DELETE FROM teams;"
  );

  // equipos
  let teamCount = 0;
  for (const [grp, teams] of Object.entries(GROUPS)) {
    for (const t of teams) {
      await dbRun("INSERT INTO teams (id, name, flag, grp) VALUES (?, ?, ?, ?)",
        [t.id, t.name, t.flag, grp]);
      teamCount++;
    }
  }

  // partidos de grupos (72, fechas/horas reales en UTC)
  for (const gm of GROUP_MATCHES) {
    await insertMatch({
      code: null,
      stage: "group",
      grp: gm.grp,
      matchday: gm.matchday,
      label: `Grupo ${gm.grp} · J${gm.matchday}`,
      home_team: gm.home,
      away_team: gm.away,
      home_label: null,
      away_label: null,
      home_src: null,
      away_src: null,
      kickoff_at: iso(2026, gm.m, gm.d, gm.h, gm.min),
      venue: gm.venue,
    });
  }

  // eliminatorias
  type KO = { code: string; stage: string; label: string; home: string; away: string; m: number; d: number; h: number };
  const KNOCKOUT: KO[] = [
    // Dieciseisavos — 28 jun al 3 jul (fechas FIFA oficiales; horas estimadas — ajustar por admin)
    { code:"M1",  stage:"r32",   label:"Dieciseisavos #1",  home:"RU:A",  away:"RU:B",  m:6, d:28, h:21 },
    { code:"M2",  stage:"r32",   label:"Dieciseisavos #2",  home:"WG:E",  away:"TH:1",  m:6, d:29, h:19 },
    { code:"M3",  stage:"r32",   label:"Dieciseisavos #3",  home:"WG:F",  away:"RU:C",  m:6, d:29, h:22 },
    { code:"M4",  stage:"r32",   label:"Dieciseisavos #4",  home:"WG:C",  away:"RU:F",  m:6, d:30, h: 1 },
    { code:"M5",  stage:"r32",   label:"Dieciseisavos #5",  home:"WG:I",  away:"TH:2",  m:6, d:30, h:19 },
    { code:"M6",  stage:"r32",   label:"Dieciseisavos #6",  home:"RU:E",  away:"RU:I",  m:6, d:30, h:22 },
    { code:"M7",  stage:"r32",   label:"Dieciseisavos #7",  home:"WG:A",  away:"TH:3",  m:7, d: 1, h: 1 },
    { code:"M8",  stage:"r32",   label:"Dieciseisavos #8",  home:"WG:L",  away:"TH:4",  m:7, d: 1, h:20 },
    { code:"M9",  stage:"r32",   label:"Dieciseisavos #9",  home:"WG:D",  away:"TH:5",  m:7, d: 1, h:23 },
    { code:"M10", stage:"r32",   label:"Dieciseisavos #10", home:"WG:G",  away:"TH:6",  m:7, d: 2, h: 2 },
    { code:"M11", stage:"r32",   label:"Dieciseisavos #11", home:"RU:K",  away:"RU:L",  m:7, d: 2, h:19 },
    { code:"M12", stage:"r32",   label:"Dieciseisavos #12", home:"WG:H",  away:"RU:J",  m:7, d: 2, h:22 },
    { code:"M13", stage:"r32",   label:"Dieciseisavos #13", home:"WG:B",  away:"TH:7",  m:7, d: 3, h: 1 },
    { code:"M14", stage:"r32",   label:"Dieciseisavos #14", home:"WG:J",  away:"RU:H",  m:7, d: 3, h:20 },
    { code:"M15", stage:"r32",   label:"Dieciseisavos #15", home:"WG:K",  away:"TH:8",  m:7, d: 3, h:23 },
    { code:"M16", stage:"r32",   label:"Dieciseisavos #16", home:"RU:D",  away:"RU:G",  m:7, d: 4, h: 2 },
    // Octavos — 4 al 7 jul (P89–P96)
    { code:"O1",  stage:"r16",   label:"Octavos #1",        home:"WM:M2", away:"WM:M5", m:7, d: 4, h:21 },
    { code:"O2",  stage:"r16",   label:"Octavos #2",        home:"WM:M1", away:"WM:M3", m:7, d: 4, h:18 },
    { code:"O3",  stage:"r16",   label:"Octavos #3",        home:"WM:M4", away:"WM:M6", m:7, d: 5, h:19 },
    { code:"O4",  stage:"r16",   label:"Octavos #4",        home:"WM:M7", away:"WM:M8", m:7, d: 5, h:22 },
    { code:"O5",  stage:"r16",   label:"Octavos #5",        home:"WM:M11",away:"WM:M12",m:7, d: 6, h:21 },
    { code:"O6",  stage:"r16",   label:"Octavos #6",        home:"WM:M9", away:"WM:M10",m:7, d: 6, h:18 },
    { code:"O7",  stage:"r16",   label:"Octavos #7",        home:"WM:M14",away:"WM:M16",m:7, d: 7, h:21 },
    { code:"O8",  stage:"r16",   label:"Octavos #8",        home:"WM:M13",away:"WM:M15",m:7, d: 7, h:18 },
    // Cuartos — P97(9jul) P98(10jul) P99(11jul) P100(11jul)
    { code:"Q1",  stage:"qf",    label:"Cuartos #1",        home:"WM:O1", away:"WM:O2", m:7, d: 9, h:21 },
    { code:"Q2",  stage:"qf",    label:"Cuartos #2",        home:"WM:O5", away:"WM:O6", m:7, d:10, h:22 },
    { code:"Q3",  stage:"qf",    label:"Cuartos #3",        home:"WM:O3", away:"WM:O4", m:7, d:11, h:19 },
    { code:"Q4",  stage:"qf",    label:"Cuartos #4",        home:"WM:O7", away:"WM:O8", m:7, d:11, h:23 },
    // Semifinales — P101(14jul) P102(15jul)
    { code:"S1",  stage:"sf",    label:"Semifinal #1",      home:"WM:Q1", away:"WM:Q2", m:7, d:14, h:23 },
    { code:"S2",  stage:"sf",    label:"Semifinal #2",      home:"WM:Q3", away:"WM:Q4", m:7, d:15, h:23 },
    // Tercer puesto y Final
    { code:"3P",  stage:"third", label:"Tercer puesto",     home:"LM:S1", away:"LM:S2", m:7, d:18, h:23 },
    { code:"F1",  stage:"final", label:"Final",             home:"WM:S1", away:"WM:S2", m:7, d:19, h:23 },
  ];

  let koMatches = 0;
  for (const k of KNOCKOUT) {
    await insertMatch({
      code: k.code, stage: k.stage, grp: null, matchday: null, label: k.label,
      home_team: null, away_team: null,
      home_label: srcLabel(k.home), away_label: srcLabel(k.away),
      home_src: k.home, away_src: k.away,
      kickoff_at: iso(2026, k.m, k.d, k.h),
      venue: null,
    });
    koMatches++;
  }

  console.log(`Listo: ${teamCount} equipos, ${GROUP_MATCHES.length} partidos de grupos, ${koMatches} de eliminatorias.`);
  console.log("Ajusta horarios y equipos de eliminatorias desde el panel de admin si es necesario.");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  seed()
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
