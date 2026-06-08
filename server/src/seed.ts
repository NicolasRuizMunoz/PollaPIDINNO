/**
 * Siembra los datos del Mundial 2026: 48 equipos, 12 grupos (sorteo oficial del
 * 5 de diciembre de 2025), los 72 partidos de fase de grupos y el cuadro de
 * eliminatorias (dieciseisavos -> final) como partidos por definir.
 *
 * Las FECHAS y HORARIOS son aproximados (ventana real del torneo: 11 jun - 19 jul
 * 2026) y se pueden ajustar uno por uno desde el panel de administracion.
 * Los equipos y grupos sí son los del sorteo oficial.
 *
 * Ejecutar:  npm run seed   (esto BORRA equipos y partidos previos)
 */
import "dotenv/config";
import { db, initSchema } from "./db.js";

interface SeedTeam {
  id: string;
  name: string;
  flag: string;
}

// 12 grupos del sorteo final. Orden = posicion de siembra dentro del grupo.
const GROUPS: Record<string, SeedTeam[]> = {
  A: [
    { id: "MEX", name: "México", flag: "🇲🇽" },
    { id: "RSA", name: "Sudáfrica", flag: "🇿🇦" },
    { id: "KOR", name: "Corea del Sur", flag: "🇰🇷" },
    { id: "CZE", name: "Chequia", flag: "🇨🇿" },
  ],
  B: [
    { id: "CAN", name: "Canadá", flag: "🇨🇦" },
    { id: "BIH", name: "Bosnia y Herzegovina", flag: "🇧🇦" },
    { id: "QAT", name: "Catar", flag: "🇶🇦" },
    { id: "SUI", name: "Suiza", flag: "🇨🇭" },
  ],
  C: [
    { id: "BRA", name: "Brasil", flag: "🇧🇷" },
    { id: "MAR", name: "Marruecos", flag: "🇲🇦" },
    { id: "HAI", name: "Haití", flag: "🇭🇹" },
    { id: "SCO", name: "Escocia", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" },
  ],
  D: [
    { id: "USA", name: "Estados Unidos", flag: "🇺🇸" },
    { id: "PAR", name: "Paraguay", flag: "🇵🇾" },
    { id: "AUS", name: "Australia", flag: "🇦🇺" },
    { id: "TUR", name: "Turquía", flag: "🇹🇷" },
  ],
  E: [
    { id: "GER", name: "Alemania", flag: "🇩🇪" },
    { id: "CUW", name: "Curazao", flag: "🇨🇼" },
    { id: "CIV", name: "Costa de Marfil", flag: "🇨🇮" },
    { id: "ECU", name: "Ecuador", flag: "🇪🇨" },
  ],
  F: [
    { id: "NED", name: "Países Bajos", flag: "🇳🇱" },
    { id: "JPN", name: "Japón", flag: "🇯🇵" },
    { id: "SWE", name: "Suecia", flag: "🇸🇪" },
    { id: "TUN", name: "Túnez", flag: "🇹🇳" },
  ],
  G: [
    { id: "BEL", name: "Bélgica", flag: "🇧🇪" },
    { id: "EGY", name: "Egipto", flag: "🇪🇬" },
    { id: "IRN", name: "Irán", flag: "🇮🇷" },
    { id: "NZL", name: "Nueva Zelanda", flag: "🇳🇿" },
  ],
  H: [
    { id: "ESP", name: "España", flag: "🇪🇸" },
    { id: "CPV", name: "Cabo Verde", flag: "🇨🇻" },
    { id: "KSA", name: "Arabia Saudita", flag: "🇸🇦" },
    { id: "URU", name: "Uruguay", flag: "🇺🇾" },
  ],
  I: [
    { id: "FRA", name: "Francia", flag: "🇫🇷" },
    { id: "SEN", name: "Senegal", flag: "🇸🇳" },
    { id: "IRQ", name: "Irak", flag: "🇮🇶" },
    { id: "NOR", name: "Noruega", flag: "🇳🇴" },
  ],
  J: [
    { id: "ARG", name: "Argentina", flag: "🇦🇷" },
    { id: "ALG", name: "Argelia", flag: "🇩🇿" },
    { id: "AUT", name: "Austria", flag: "🇦🇹" },
    { id: "JOR", name: "Jordania", flag: "🇯🇴" },
  ],
  K: [
    { id: "POR", name: "Portugal", flag: "🇵🇹" },
    { id: "COD", name: "RD Congo", flag: "🇨🇩" },
    { id: "UZB", name: "Uzbekistán", flag: "🇺🇿" },
    { id: "COL", name: "Colombia", flag: "🇨🇴" },
  ],
  L: [
    { id: "ENG", name: "Inglaterra", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
    { id: "CRO", name: "Croacia", flag: "🇭🇷" },
    { id: "GHA", name: "Ghana", flag: "🇬🇭" },
    { id: "PAN", name: "Panamá", flag: "🇵🇦" },
  ],
};

/** ISO UTC a partir de y-m-d y hora. */
function iso(y: number, m: number, d: number, h: number): string {
  return new Date(Date.UTC(y, m - 1, d, h, 0, 0)).toISOString();
}

/** Texto legible para una fuente de cupo (mientras no se conoce el equipo). */
function srcLabel(src: string): string {
  const [kind, arg] = src.split(":");
  switch (kind) {
    case "WG":
      return `1º Grupo ${arg}`;
    case "RU":
      return `2º Grupo ${arg}`;
    case "TH":
      return `Mejor 3º (${arg})`;
    case "WM":
      return `Ganador ${arg}`;
    case "LM":
      return `Perdedor ${arg}`;
    default:
      return "Por definir";
  }
}

// pares de la liguilla (round-robin) para 4 equipos por jornada
const ROUND_ROBIN: [number, number][][] = [
  [
    [0, 1],
    [2, 3],
  ], // jornada 1
  [
    [0, 2],
    [3, 1],
  ], // jornada 2
  [
    [0, 3],
    [1, 2],
  ], // jornada 3
];

function seed() {
  initSchema();

  console.log("Limpiando datos previos de equipos y partidos...");
  db.exec("DELETE FROM predictions;");
  db.exec("DELETE FROM matches;");
  db.exec("DELETE FROM teams;");

  const insTeam = db.prepare(
    "INSERT INTO teams (id, name, flag, grp) VALUES (?, ?, ?, ?)"
  );
  const insMatch = db.prepare(
    `INSERT INTO matches (code, stage, grp, matchday, label, home_team, away_team, home_label, away_label, home_src, away_src, kickoff_at, venue)
     VALUES (@code, @stage, @grp, @matchday, @label, @home_team, @away_team, @home_label, @away_label, @home_src, @away_src, @kickoff_at, @venue)`
  );

  const groupLetters = Object.keys(GROUPS);

  // equipos
  let teamCount = 0;
  for (const letter of groupLetters) {
    for (const t of GROUPS[letter]) {
      insTeam.run(t.id, t.name, t.flag, letter);
      teamCount++;
    }
  }

  // partidos de grupos
  let groupMatches = 0;
  groupLetters.forEach((letter, g) => {
    const teams = GROUPS[letter];
    ROUND_ROBIN.forEach((jornada, j) => {
      // jornada 1: 11-16 jun, jornada 2: 17-22 jun, jornada 3: 23-27 jun
      const baseDay = [11, 17, 23][j];
      const span = [6, 6, 5][j];
      const day = baseDay + (g % span);
      jornada.forEach(([a, b], k) => {
        const hour = 18 + ((g + k) % 2) * 3; // 18:00 o 21:00 UTC
        insMatch.run({
          code: null,
          stage: "group",
          grp: letter,
          matchday: j + 1,
          label: `Grupo ${letter} · J${j + 1}`,
          home_team: teams[a].id,
          away_team: teams[b].id,
          home_label: null,
          away_label: null,
          home_src: null,
          away_src: null,
          kickoff_at: iso(2026, 6, day, hour),
          venue: null,
        });
        groupMatches++;
      });
    });
  });

  // Cuadro de eliminatorias. Cada cupo se define por su "fuente":
  //   WG:A ganador grupo A · RU:A segundo grupo A · TH:n mejor tercero n
  //   WM:Mx ganador del partido Mx · LM:Sx perdedor del partido Sx
  // El motor de avance (advancement.ts) los va resolviendo con los resultados.
  type KO = {
    code: string;
    stage: string;
    label: string;
    home: string;
    away: string;
    m: number; // mes
    d: number; // dia
    h: number; // hora UTC
  };
  const KNOCKOUT: KO[] = [
    // Dieciseisavos de final (Round of 32)
    { code: "M1", stage: "r32", label: "Dieciseisavos #1", home: "WG:A", away: "TH:1", m: 6, d: 28, h: 18 },
    { code: "M2", stage: "r32", label: "Dieciseisavos #2", home: "WG:B", away: "TH:2", m: 6, d: 28, h: 21 },
    { code: "M3", stage: "r32", label: "Dieciseisavos #3", home: "WG:C", away: "TH:3", m: 6, d: 29, h: 18 },
    { code: "M4", stage: "r32", label: "Dieciseisavos #4", home: "WG:D", away: "TH:4", m: 6, d: 29, h: 21 },
    { code: "M5", stage: "r32", label: "Dieciseisavos #5", home: "WG:E", away: "TH:5", m: 6, d: 30, h: 18 },
    { code: "M6", stage: "r32", label: "Dieciseisavos #6", home: "WG:F", away: "TH:6", m: 6, d: 30, h: 21 },
    { code: "M7", stage: "r32", label: "Dieciseisavos #7", home: "WG:G", away: "TH:7", m: 7, d: 1, h: 18 },
    { code: "M8", stage: "r32", label: "Dieciseisavos #8", home: "WG:H", away: "TH:8", m: 7, d: 1, h: 21 },
    { code: "M9", stage: "r32", label: "Dieciseisavos #9", home: "WG:I", away: "RU:J", m: 7, d: 2, h: 18 },
    { code: "M10", stage: "r32", label: "Dieciseisavos #10", home: "WG:K", away: "RU:L", m: 7, d: 2, h: 21 },
    { code: "M11", stage: "r32", label: "Dieciseisavos #11", home: "WG:L", away: "RU:K", m: 7, d: 3, h: 18 },
    { code: "M12", stage: "r32", label: "Dieciseisavos #12", home: "WG:J", away: "RU:I", m: 7, d: 3, h: 21 },
    { code: "M13", stage: "r32", label: "Dieciseisavos #13", home: "RU:A", away: "RU:D", m: 7, d: 1, h: 15 },
    { code: "M14", stage: "r32", label: "Dieciseisavos #14", home: "RU:B", away: "RU:C", m: 7, d: 2, h: 15 },
    { code: "M15", stage: "r32", label: "Dieciseisavos #15", home: "RU:E", away: "RU:H", m: 7, d: 3, h: 15 },
    { code: "M16", stage: "r32", label: "Dieciseisavos #16", home: "RU:F", away: "RU:G", m: 6, d: 30, h: 15 },
    // Octavos de final
    { code: "O1", stage: "r16", label: "Octavos #1", home: "WM:M1", away: "WM:M2", m: 7, d: 4, h: 18 },
    { code: "O2", stage: "r16", label: "Octavos #2", home: "WM:M3", away: "WM:M4", m: 7, d: 4, h: 21 },
    { code: "O3", stage: "r16", label: "Octavos #3", home: "WM:M5", away: "WM:M6", m: 7, d: 5, h: 18 },
    { code: "O4", stage: "r16", label: "Octavos #4", home: "WM:M7", away: "WM:M8", m: 7, d: 5, h: 21 },
    { code: "O5", stage: "r16", label: "Octavos #5", home: "WM:M9", away: "WM:M10", m: 7, d: 6, h: 18 },
    { code: "O6", stage: "r16", label: "Octavos #6", home: "WM:M11", away: "WM:M12", m: 7, d: 6, h: 21 },
    { code: "O7", stage: "r16", label: "Octavos #7", home: "WM:M13", away: "WM:M14", m: 7, d: 7, h: 18 },
    { code: "O8", stage: "r16", label: "Octavos #8", home: "WM:M15", away: "WM:M16", m: 7, d: 7, h: 21 },
    // Cuartos de final
    { code: "Q1", stage: "qf", label: "Cuartos #1", home: "WM:O1", away: "WM:O2", m: 7, d: 9, h: 18 },
    { code: "Q2", stage: "qf", label: "Cuartos #2", home: "WM:O3", away: "WM:O4", m: 7, d: 9, h: 21 },
    { code: "Q3", stage: "qf", label: "Cuartos #3", home: "WM:O5", away: "WM:O6", m: 7, d: 11, h: 18 },
    { code: "Q4", stage: "qf", label: "Cuartos #4", home: "WM:O7", away: "WM:O8", m: 7, d: 11, h: 21 },
    // Semifinales
    { code: "S1", stage: "sf", label: "Semifinal #1", home: "WM:Q1", away: "WM:Q2", m: 7, d: 14, h: 19 },
    { code: "S2", stage: "sf", label: "Semifinal #2", home: "WM:Q3", away: "WM:Q4", m: 7, d: 15, h: 19 },
    // Tercer puesto y Final
    { code: "3P", stage: "third", label: "Tercer puesto", home: "LM:S1", away: "LM:S2", m: 7, d: 18, h: 19 },
    { code: "F1", stage: "final", label: "Final", home: "WM:S1", away: "WM:S2", m: 7, d: 19, h: 19 },
  ];

  let koMatches = 0;
  for (const k of KNOCKOUT) {
    insMatch.run({
      code: k.code,
      stage: k.stage,
      grp: null,
      matchday: null,
      label: k.label,
      home_team: null,
      away_team: null,
      home_label: srcLabel(k.home),
      away_label: srcLabel(k.away),
      home_src: k.home,
      away_src: k.away,
      kickoff_at: iso(2026, k.m, k.d, k.h),
      venue: null,
    });
    koMatches++;
  }

  console.log(
    `Listo: ${teamCount} equipos, ${groupMatches} partidos de grupos, ${koMatches} de eliminatorias.`
  );
  console.log(
    "Ajusta fechas, horarios y los equipos de las eliminatorias desde el panel de admin."
  );
}

seed();
