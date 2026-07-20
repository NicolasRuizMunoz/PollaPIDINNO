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

function outcome(s: Score): number {
  return Math.sign(s.home - s.away);
}

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

  if (pred.home === actual.home && pred.away === actual.away) {
    return POINTS.EXACT;
  }

  let points = 0;

  if (outcome(pred) === outcome(actual)) {
    points += POINTS.OUTCOME;

    if (pred.home - pred.away === actual.home - actual.away) {
      points += POINTS.GOAL_DIFF_BONUS;
    }
  }

  return points;
}
