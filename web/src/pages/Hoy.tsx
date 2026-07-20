import { useEffect, useState } from "react";
import { useMatches } from "../useMatches";
import { MatchCard } from "../components/MatchCard";
import { Polls } from "../components/Polls";
import { isToday, formatDate, dayKey, isLiveMatch } from "../util";
import { api, type Match } from "../api";

export function Hoy() {
  const { data, loading, error, onSaved, reload } = useMatches();
  const [info, setInfo] = useState<any>(null);

  useEffect(() => {
    api.tournament().then(setInfo).catch(console.error);
  }, []);

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

  const today = data
    ? data.matches
        .filter((m) => isToday(m.kickoffAt))
        .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt))
    : [];

  // el siguiente dia de calendario que tenga al menos un partido
  const todayKey = dayKey(new Date());
  const nextKey = data
    ? data.matches
        .map((m) => dayKey(m.kickoffAt))
        .filter((k) => k > todayKey)
        .sort()[0] ?? null
    : null;
  const nextDay =
    data && nextKey
      ? data.matches
          .filter((m) => dayKey(m.kickoffAt) === nextKey)
          .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt))
      : [];

  const card = (m: Match) => (
    <MatchCard
      key={m.id}
      match={m}
      myPred={data!.myPredictions[m.id]}
      onSaved={onSaved}
      drawRuleActive={data!.drawRuleActive}
    />
  );

  return (
    <div>
      <Polls />

      {info?.locked && info?.results && (
        <div style={{
          backgroundColor: "#fff3cd",
          border: "1px solid #ffc107",
          borderRadius: "4px",
          padding: "1.5rem",
          marginBottom: "2rem",
          lineHeight: "1.6",
        }}>
          <h3 style={{ margin: "0 0 0.75rem 0", color: "#856404" }}>⚽ ¡Torneo terminado!</h3>
          <p style={{ margin: "0.5rem 0", color: "#856404" }}>
            <strong>Ganador: {info.results.champion}</strong> 🏆
          </p>
          <p style={{ margin: "0.5rem 0 1rem 0", color: "#856404" }}>
            Hemos publicado los <strong>resultados oficiales de los bonos</strong>.
            Por favor revisa la sección de <strong>Bonos</strong> para ver:
          </p>
          <ul style={{ margin: "0.5rem 0 1rem 0", paddingLeft: "1.5rem", color: "#856404" }}>
            <li>Los resultados reales</li>
            <li>Tus predicciones vs. los resultados</li>
            <li>Qué escribió cada persona (para transparencia)</li>
          </ul>
          <p style={{ margin: "0.75rem 0 0.5rem 0", color: "#856404" }}>
            <strong>⚠️ Si encuentras un error o discrepancia en los bonos,</strong> por favor contacta al admin (nruiz@copec.cl)
            para confirmarlo. También compartiremos un archivo con los datos completos.
          </p>
        </div>
      )}

      <h2>Partidos de hoy</h2>
      <p className="muted">{formatDate(new Date().toISOString())}</p>

      {loading ? (
        <p className="muted center">cargando partidos…</p>
      ) : error ? (
        <p className="err center">{error}</p>
      ) : today.length === 0 ? (
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
