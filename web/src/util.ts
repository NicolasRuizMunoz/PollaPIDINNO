import type { Match, Stage } from "./api";

const TZ = "America/Santiago";

const dateFmt = new Intl.DateTimeFormat("es-CL", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: TZ,
});
const timeFmt = new Intl.DateTimeFormat("es-CL", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: TZ,
});

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}
export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}
export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} · ${formatTime(iso)} hrs`;
}

/** Clave de dia (YYYY-MM-DD) en hora de Chile, para agrupar/comparar. */
export function dayKey(iso: string | Date): string {
  return dayKeyFmt.format(typeof iso === "string" ? new Date(iso) : iso);
}

export function isToday(iso: string): boolean {
  return dayKey(iso) === dayKey(new Date());
}

export const STAGE_LABEL: Record<Stage, string> = {
  group: "Fase de grupos",
  r32: "Dieciseisavos de final",
  r16: "Octavos de final",
  qf: "Cuartos de final",
  sf: "Semifinales",
  third: "Tercer puesto",
  final: "Final",
};

export const STAGE_ORDER: Stage[] = ["group", "r32", "r16", "qf", "sf", "third", "final"];

/** Nombre a mostrar de un lado del partido (equipo o etiqueta "por definir"). */
export function sideName(team: Match["home"], label: string | null): string {
  if (team) return team.name;
  return label ?? "Por definir";
}
export function sideFlag(team: Match["home"]): string {
  return team?.flag ?? "🏳️";
}

/** ¿El partido tiene ambos equipos definidos? (en eliminatorias puede que no) */
export function hasTeams(m: Match): boolean {
  return !!m.home && !!m.away;
}

/** ¿El partido tiene marcador provisional? (en juego o terminado sin publicar) */
export function isLiveMatch(m: Match): boolean {
  return (
    !m.finished &&
    (m.status === "LIVE" || m.status === "HT" || m.status === "FT") &&
    m.liveHome !== null &&
    m.liveAway !== null
  );
}

/** ¿Está en juego ahora mismo? (FT = terminado, ya no se mueve) */
export function isInPlay(m: Match): boolean {
  return isLiveMatch(m) && m.status !== "FT";
}

/** Texto del estado en vivo: minuto, ENTRETIEMPO, FINAL, etc. */
export function liveLabel(m: Match): string {
  if (m.status === "HT") return "ENTRETIEMPO";
  if (m.status === "FT") return "FINAL · por confirmar";
  if (m.minute !== null) return `${m.minute}'`;
  return "EN VIVO";
}

/**
 * Desglose del puntaje de una prediccion (mismas reglas que el backend):
 * exacto = 5; ganador = 3 (+1 si aciertas la diferencia de goles).
 * `rule` explica que regla dio los puntos (para mostrar al pasar el mouse).
 */
export interface Breakdown {
  points: number;
  rule: string;
}

export function scoreBreakdown(
  pred: { home: number; away: number } | null,
  actual: { home: number | null; away: number | null },
  drawRuleV2 = false
): Breakdown {
  if (!pred) return { points: 0, rule: "No jugaste este partido" };
  if (actual.home === null || actual.away === null)
    return { points: 0, rule: "Aún sin resultado" };

  if (pred.home === actual.home && pred.away === actual.away)
    return { points: 5, rule: "Marcador exacto → +5" };

  const sign = (h: number, a: number) => Math.sign(h - a);
  if (sign(pred.home, pred.away) === sign(actual.home, actual.away)) {
    const isDraw = sign(actual.home, actual.away) === 0;
    // Regla NUEVA del empate: el +1 se gana solo si quedas a 1 gol del real.
    if (drawRuleV2 && isDraw) {
      if (Math.abs(pred.home - actual.home) === 1)
        return { points: 4, rule: "Empate → +3 · a 1 gol del marcador → +1 (total 4)" };
      return { points: 3, rule: "Empate acertado → +3" };
    }
    if (pred.home - pred.away === actual.home - actual.away)
      return { points: 4, rule: "Ganador → +3 · Diferencia de goles → +1 (total 4)" };
    return { points: 3, rule: isDraw ? "Empate acertado → +3" : "Ganador acertado → +3" };
  }
  return { points: 0, rule: "Sin aciertos → 0" };
}

/** Solo el numero de puntos. */
export function scorePrediction(
  pred: { home: number; away: number } | null,
  actual: { home: number | null; away: number | null },
  drawRuleV2 = false
): number {
  return scoreBreakdown(pred, actual, drawRuleV2).points;
}
