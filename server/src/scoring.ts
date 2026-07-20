/**
 * Motor de puntaje de la polla.
 *
 * Reglas (sistema ACUMULATIVO):
 *
 *  Por partido:
 *   - Marcador exacto (predijiste 3-1 y quedó 3-1) ............ 5 pts
 *   - Acertar ganador o empate ............................... 3 pts
 *       + 1 pt extra si además aciertas la diferencia de goles
 *         (predijiste 3-1 y quedó 4-2 -> 3 + 1 = 4 pts)
 *   - No acertar nada ........................................ 0 pts
 *
 *  Bonos de torneo (predichos antes de empezar):
 *   - Campeón ............... 15
 *   - Subcampeón ............ 10
 *   - Goleador .............. 10
 *   - Mejor arquero ........ 10
 *   - Mejor jugador ........ 10
 *   - Mejor jugador joven .. 10
 */

export const POINTS = {
  EXACT: 5,
  OUTCOME: 3,
  GOAL_DIFF_BONUS: 1,
  ADVANCE_BONUS: 1,
  CHAMPION_BONUS: 15,
  TOURNAMENT_BONUS: 10,
} as const;

export interface Score {
  home: number;
  away: number;
}

/** signo del resultado: 1 gana local, -1 gana visita, 0 empate */
function outcome(s: Score): number {
  return Math.sign(s.home - s.away);
}

/**
 * Puntos que obtiene una predicción dado el resultado real de un partido.
 * Devuelve 0 si falta algún dato.
 */
export function scoreMatch(pred: Score | null, actual: Score | null): number {
  if (!pred || !actual) return 0;
  if (
    !Number.isFinite(pred.home) ||
    !Number.isFinite(pred.away) ||
    !Number.isFinite(actual.home) ||
    !Number.isFinite(actual.away)
  ) {
    return 0;
  }

  // Marcador exacto
  if (pred.home === actual.home && pred.away === actual.away) {
    return POINTS.EXACT;
  }

  let points = 0;

  // Acertar el ganador/empate
  if (outcome(pred) === outcome(actual)) {
    points += POINTS.OUTCOME;

    // +1 si además aciertas la diferencia de goles
    if (pred.home - pred.away === actual.home - actual.away) {
      points += POINTS.GOAL_DIFF_BONUS;
    }
  }

  return points;
}

/**
 * Puntaje con la NUEVA regla de empate (PROPUESTA — todavía NO vigente).
 *
 * Se usa solo para calcular el impacto del cambio (tablero "Hoy"). NO cambia el
 * puntaje real: ese sigue saliendo de `scoreMatch`.
 *
 * Única diferencia con `scoreMatch`: el bono de +1 en los EMPATES.
 *  - Regla vieja: cualquier empate acierta "la diferencia de goles" (siempre 0),
 *    así que predecir un empate daba 3 + 1 = 4 pts gratis.
 *  - Regla nueva: en los empates el +1 se gana solo si tu marcador queda a
 *    exactamente 1 gol del real (p.ej. 1-1 y queda 2-2 → sí; 0-0 y queda 2-2 → no).
 *  - Con ganador definido, nada cambia: el +1 sigue siendo por diferencia de goles.
 */
export function scoreMatchDrawV2(pred: Score | null, actual: Score | null): number {
  if (!pred || !actual) return 0;
  if (
    !Number.isFinite(pred.home) ||
    !Number.isFinite(pred.away) ||
    !Number.isFinite(actual.home) ||
    !Number.isFinite(actual.away)
  ) {
    return 0;
  }

  // Marcador exacto
  if (pred.home === actual.home && pred.away === actual.away) {
    return POINTS.EXACT;
  }

  let points = 0;

  if (outcome(pred) === outcome(actual)) {
    points += POINTS.OUTCOME;

    if (outcome(actual) === 0) {
      // Empate: bono solo si quedaste a 1 gol del marcador real (1-1 vs 2-2).
      if (Math.abs(pred.home - actual.home) === 1) {
        points += POINTS.GOAL_DIFF_BONUS;
      }
    } else if (pred.home - pred.away === actual.home - actual.away) {
      // Con ganador: +1 por acertar la diferencia de goles (igual que antes).
      points += POINTS.GOAL_DIFF_BONUS;
    }
  }

  return points;
}

/**
 * Bono de "quién pasa de ronda" (solo eliminatorias): +1 si el equipo que el
 * usuario predijo que avanzaría coincide con el que el admin marcó como
 * clasificado. Es INDEPENDIENTE del marcador: se gana aunque falles el resultado
 * de los 90/120 (p. ej. predijiste un empate pero acertaste quién pasa por penales).
 */
export function scoreAdvance(
  predAdvances: string | null | undefined,
  actualAdvancer: string | null | undefined
): number {
  if (!predAdvances || !actualAdvancer) return 0;
  return predAdvances === actualAdvancer ? POINTS.ADVANCE_BONUS : 0;
}

export interface TournamentPicks {
  champion?: string | null; // id de equipo
  runnerUp?: string | null; // id de equipo
  topScorer?: string | null; // nombre del jugador
  bestGoalkeeper?: string | null; // nombre del jugador
  bestPlayer?: string | null; // nombre del jugador
  bestYoungPlayer?: string | null; // nombre del jugador
}

export interface TournamentResults {
  champion?: string | null;
  runnerUp?: string | null;
  topScorer?: string | null;
  bestGoalkeeper?: string | null;
  bestPlayer?: string | null;
  bestYoungPlayer?: string | null;
}

function sameText(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// Mapeo de variantes a valor normalizado
const normalizationMaps = {
  topScorer: new Map([
    ["mbappe", "MBAPPE"], ["Mbappe", "MBAPPE"], ["MBAPPE", "MBAPPE"],
    ["mbappé", "MBAPPE"], ["Mbappé", "MBAPPE"],
    ["kylian mbappe", "MBAPPE"], ["Kylian Mbappe", "MBAPPE"],
    ["kylian mbappé", "MBAPPE"], ["Kylian Mbappé", "MBAPPE"],
    ["kylian mbapeé", "MBAPPE"], ["Kylian Mbapeé", "MBAPPE"],
    ["killyan mbappe", "MBAPPE"], ["Mbape", "MBAPPE"], ["mbape", "MBAPPE"],
    ["messi", "MESSI"], ["Messi", "MESSI"], ["MESSI", "MESSI"],
    ["lionel messi", "MESSI"], ["Lionel Messi", "MESSI"],
    ["harry kane", "KANE"], ["Harry Kane", "KANE"],
  ]),
  bestGoalkeeper: new Map([
    ["dibu", "SIMON"], ["Dibu", "SIMON"],
    ["dibu martinez", "SIMON"], ["Dibu martinez", "SIMON"],
    ["emiliano dibu martinez", "SIMON"], ["Emiliano Dibu Martinez", "SIMON"],
    ["emiliano martínez", "SIMON"], ["Emiliano Martínez", "SIMON"],
    ["unai simón", "SIMON"], ["Unai Simón", "SIMON"],
    ["unai simon", "SIMON"], ["Unai Simon", "SIMON"], ["SIMON", "SIMON"],
  ]),
  bestPlayer: new Map([
    ["mbappe", "MBAPPE"], ["Mbappe", "MBAPPE"],
    ["kylian mbappe", "MBAPPE"], ["Kylian Mbappe", "MBAPPE"],
    ["kylian mbappé", "MBAPPE"], ["Kylian Mbappé", "MBAPPE"],
    ["kylian mbapeé", "MBAPPE"], ["Kylian Mbapeé", "MBAPPE"],
    ["messi", "MESSI"], ["Messi", "MESSI"],
    ["lionel messi", "MESSI"], ["Lionel Messi", "MESSI"],
    ["rodri", "RODRI"], ["Rodri", "RODRI"],
  ]),
  bestYoungPlayer: new Map([
    ["lamine yamal", "CUBARSI"], ["Lamine Yamal", "CUBARSI"],
    ["lamine yamal", "CUBARSI"], ["Lamine yamal", "CUBARSI"],
    ["lamine", "CUBARSI"], ["Lamine", "CUBARSI"],
    ["yamal", "CUBARSI"], ["Yamal", "CUBARSI"],
    ["pau cubarsi", "CUBARSI"], ["Pau Cubarsi", "CUBARSI"],
  ]),
};

function normalize(field: "topScorer" | "bestGoalkeeper" | "bestPlayer" | "bestYoungPlayer", value: string | null | undefined): string | null {
  if (!value) return null;
  const map = normalizationMaps[field];
  if (!map) return value?.trim().toUpperCase() ?? null;
  return map.get(value.trim()) ?? value.trim().toUpperCase();
}

/** Puntos de los bonos de torneo (10 por cada acierto). */
export function scoreTournament(
  picks: TournamentPicks | null,
  results: TournamentResults | null
): number {
  if (!picks || !results) return 0;
  let points = 0;
  if (picks.champion && results.champion && picks.champion === results.champion) {
    points += POINTS.CHAMPION_BONUS;
  }
  if (picks.runnerUp && results.runnerUp && picks.runnerUp === results.runnerUp) {
    points += POINTS.TOURNAMENT_BONUS;
  }
  // Comparar normalizando
  if (normalize("topScorer", picks.topScorer) === results.topScorer) {
    points += POINTS.TOURNAMENT_BONUS;
  }
  if (normalize("bestGoalkeeper", picks.bestGoalkeeper) === results.bestGoalkeeper) {
    points += POINTS.TOURNAMENT_BONUS;
  }
  if (normalize("bestPlayer", picks.bestPlayer) === results.bestPlayer) {
    points += POINTS.TOURNAMENT_BONUS;
  }
  if (normalize("bestYoungPlayer", picks.bestYoungPlayer) === results.bestYoungPlayer) {
    points += POINTS.TOURNAMENT_BONUS;
  }
  return points;
}
