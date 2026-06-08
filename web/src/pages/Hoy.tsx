import { useMatches } from "../useMatches";
import { MatchCard } from "../components/MatchCard";
import { isToday, formatDate } from "../util";

export function Hoy() {
  const { data, loading, error, onSaved } = useMatches();

  if (loading) return <p className="muted center">cargando partidos…</p>;
  if (error) return <p className="err center">{error}</p>;
  if (!data) return null;

  const today = data.matches
    .filter((m) => isToday(m.kickoffAt))
    .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt));

  // proximos partidos (si hoy no hay nada que llenar)
  const upcoming = data.matches
    .filter((m) => !m.locked && new Date(m.kickoffAt).getTime() > Date.now())
    .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt))
    .slice(0, 5);

  return (
    <div>
      <h2>Partidos de hoy</h2>
      <p className="muted">{formatDate(new Date().toISOString())}</p>

      {today.length === 0 ? (
        <div className="empty">
          <p>Hoy no hay partidos. 🌙</p>
          <h3>Próximos partidos</h3>
          {upcoming.map((m) => (
            <MatchCard
              key={m.id}
              match={m}
              myPred={data.myPredictions[m.id]}
              onSaved={onSaved}
            />
          ))}
        </div>
      ) : (
        today.map((m) => (
          <MatchCard
            key={m.id}
            match={m}
            myPred={data.myPredictions[m.id]}
            onSaved={onSaved}
          />
        ))
      )}
    </div>
  );
}
