import { useEffect } from "react";
import { useMatches } from "../useMatches";
import { MatchCard } from "../components/MatchCard";
import { isToday, formatDate, dayKey, isLiveMatch } from "../util";
import type { Match } from "../api";

export function Hoy() {
  const { data, loading, error, onSaved, reload } = useMatches();

  // ¿hay algo que valga la pena refrescar? (un partido en vivo, o uno de hoy ya
  // empezado pero sin resultado oficial → puede pasar a vivo en cualquier momento)
  const shouldPoll = !!data?.matches.some(
    (m) => isToday(m.kickoffAt) && !m.finished && (isLiveMatch(m) || m.locked)
  );

  // refresco automático cada 45s mientras haya partidos en curso hoy
  useEffect(() => {
    if (!shouldPoll) return;
    const id = window.setInterval(() => reload(true), 45_000);
    return () => window.clearInterval(id);
  }, [shouldPoll, reload]);

  if (loading) return <p className="muted center">cargando partidos…</p>;
  if (error) return <p className="err center">{error}</p>;
  if (!data) return null;

  const today = data.matches
    .filter((m) => isToday(m.kickoffAt))
    .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt));

  // el siguiente dia de calendario que tenga al menos un partido
  const todayKey = dayKey(new Date());
  const nextKey =
    data.matches
      .map((m) => dayKey(m.kickoffAt))
      .filter((k) => k > todayKey)
      .sort()[0] ?? null;
  const nextDay = nextKey
    ? data.matches
        .filter((m) => dayKey(m.kickoffAt) === nextKey)
        .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt))
    : [];

  const card = (m: Match) => (
    <MatchCard
      key={m.id}
      match={m}
      myPred={data.myPredictions[m.id]}
      onSaved={onSaved}
    />
  );

  return (
    <div>
      <h2>Partidos de hoy</h2>
      <p className="muted">{formatDate(new Date().toISOString())}</p>

      {today.length === 0 ? (
        <p className="muted center">Hoy no hay partidos. 🌙</p>
      ) : (
        today.map(card)
      )}

      {nextDay.length > 0 && (
        <>
          <hr className="day-sep" />
          <div className="section-head">
            <h3>Próximos partidos</h3>
            <span className="muted">{formatDate(nextDay[0].kickoffAt)}</span>
          </div>
          {nextDay.map(card)}
        </>
      )}
    </div>
  );
}
