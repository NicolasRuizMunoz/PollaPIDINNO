import { useEffect, useRef, useState } from "react";
import { api, type Match, type MatchPredictions } from "../api";
import {
  formatDateTime,
  hasTeams,
  isLiveMatch,
  liveLabel,
  scoreBreakdown,
  sideName,
} from "../util";
import { Flag } from "./Flag";
import { PointsBadge } from "./PointsBadge";

type SaveState = "idle" | "saving" | "saved" | "error";

export function MatchCard({
  match,
  myPred,
  onSaved,
  drawRuleActive = false,
}: {
  match: Match;
  myPred?: { home: number; away: number; advances?: string | null };
  onSaved?: (matchId: number, home: number, away: number, advances?: string | null) => void;
  drawRuleActive?: boolean;
}) {
  const editable = !match.locked && hasTeams(match);
  const isKnockout = match.stage !== "group";
  const [home, setHome] = useState(myPred ? String(myPred.home) : "");
  const [away, setAway] = useState(myPred ? String(myPred.away) : "");
  const [advances, setAdvances] = useState<string | null>(myPred?.advances ?? null);
  const [save, setSave] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(false);

  useEffect(() => {
    setHome(myPred ? String(myPred.home) : "");
    setAway(myPred ? String(myPred.away) : "");
  }, [myPred?.home, myPred?.away]);

  useEffect(() => {
    setAdvances(myPred?.advances ?? null);
  }, [myPred?.advances]);

  const timer = useRef<number | undefined>(undefined);
  const lastSaved = useRef<string>(myPred ? `${myPred.home}-${myPred.away}` : "");
  // Último "quién pasa" que autocompletamos nosotros a partir del marcador. Sirve
  // para distinguir una elección MANUAL del usuario (que respetamos) de una
  // autocompletada (que podemos actualizar si cambia el marcador). null = manual
  // o sin autocompletar. Las elecciones ya existentes cuentan como manuales.
  const autoAdvancer = useRef<string | null>(null);

  function scheduleSave(h: string, a: string) {
    if (timer.current) window.clearTimeout(timer.current);
    const hi = parseInt(h, 10);
    const ai = parseInt(a, 10);
    if (!Number.isInteger(hi) || !Number.isInteger(ai) || hi < 0 || ai < 0) return;

    // Ayuda (eliminatorias): un marcador decisivo implica quién pasa. Autocompletamos
    // al ganador SOLO si el usuario no eligió a mano. En empate se deja libre (penales).
    // No es determinístico: el usuario puede cambiarlo con los botones.
    let advToSend: string | null | undefined = undefined;
    if (isKnockout && hi !== ai) {
      const winner = hi > ai ? match.home?.id ?? null : match.away?.id ?? null;
      const isManual = advances != null && advances !== autoAdvancer.current;
      if (winner && !isManual && advances !== winner) advToSend = winner;
    }

    if (`${hi}-${ai}` === lastSaved.current && advToSend === undefined) return;
    timer.current = window.setTimeout(async () => {
      setSave("saving");
      setError(null);
      try {
        await api.savePrediction(match.id, hi, ai, advToSend);
        lastSaved.current = `${hi}-${ai}`;
        if (advToSend !== undefined) {
          autoAdvancer.current = advToSend;
          setAdvances(advToSend);
        }
        setSave("saved");
        onSaved?.(match.id, hi, ai, advToSend);
        window.setTimeout(() => setSave("idle"), 1500);
      } catch (e) {
        setSave("error");
        setError(e instanceof Error ? e.message : "Error al guardar");
      }
    }, 600);
  }

  // "Quién pasa de ronda" (solo eliminatorias): guarda el clasificado junto con el
  // marcador actual. Requiere un marcador válido (la predicción guarda home/away).
  async function pickAdvancer(teamId: string) {
    const hi = parseInt(home, 10);
    const ai = parseInt(away, 10);
    if (!Number.isInteger(hi) || !Number.isInteger(ai) || hi < 0 || ai < 0) {
      setSave("error");
      setError("Ingresa primero tu marcador");
      return;
    }
    const next = advances === teamId ? null : teamId; // volver a tocar = quitar
    setAdvances(next);
    autoAdvancer.current = null; // elección manual: no la pisamos al cambiar el marcador
    setSave("saving");
    setError(null);
    try {
      await api.savePrediction(match.id, hi, ai, next);
      lastSaved.current = `${hi}-${ai}`;
      setSave("saved");
      onSaved?.(match.id, hi, ai, next);
      window.setTimeout(() => setSave("idle"), 1500);
    } catch (e) {
      setAdvances(myPred?.advances ?? null); // revertir si falló
      setSave("error");
      setError(e instanceof Error ? e.message : "Error al guardar");
    }
  }

  const advancerTeam =
    match.advancer === match.home?.id ? match.home : match.advancer === match.away?.id ? match.away : null;

  const userBreakdown =
    match.finished && myPred
      ? scoreBreakdown(myPred, { home: match.homeScore, away: match.awayScore }, drawRuleActive)
      : null;

  const live = isLiveMatch(match);
  const liveBreakdown =
    live && myPred
      ? scoreBreakdown(myPred, { home: match.liveHome, away: match.liveAway }, drawRuleActive)
      : null;

  return (
    <div className={`match ${match.finished ? "finished" : ""} ${live ? "live" : ""}`}>
      <div className="match-meta">
        <span>{formatDateTime(match.kickoffAt)}</span>
        {live && (
          <span className={`tag tag-live ${match.status === "FT" ? "final" : ""}`}>
            {match.status === "FT" ? "✅" : "🔴"} {liveLabel(match)}
          </span>
        )}
        {match.locked && !match.finished && !live && <span className="tag">🔒 cerrado</span>}
        {match.finished && <span className="tag tag-done">finalizado</span>}
      </div>

      <div className="match-row">
        <div className="team home">
          <Flag teamId={match.home?.id} emoji={match.home?.flag} />
          <span className="name">{sideName(match.home, match.homeLabel)}</span>
        </div>

        <div className="scorebox">
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={home}
            disabled={!editable}
            onChange={(e) => {
              setHome(e.target.value);
              scheduleSave(e.target.value, away);
            }}
          />
          <span className="vs">-</span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={away}
            disabled={!editable}
            onChange={(e) => {
              setAway(e.target.value);
              scheduleSave(home, e.target.value);
            }}
          />
        </div>

        <div className="team away">
          <span className="name">{sideName(match.away, match.awayLabel)}</span>
          <Flag teamId={match.away?.id} emoji={match.away?.flag} />
        </div>
      </div>

      {isKnockout && hasTeams(match) && (
        <div className="advancer">
          <span className="advancer-q">¿Quién pasa de ronda? <span className="muted">(+1)</span></span>
          <div className="advancer-opts">
            {[match.home!, match.away!].map((t) => {
              const selected = advances === t.id;
              const isActual = match.advancer === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`advancer-opt ${selected ? "sel" : ""} ${
                    match.finished && match.advancer ? (isActual ? "ok" : "no") : ""
                  }`}
                  disabled={!editable}
                  onClick={() => pickAdvancer(t.id)}
                  title={t.name}
                >
                  <Flag teamId={t.id} emoji={t.flag} size={16} />
                  <span className="adv-code">{t.id}</span>
                  {selected && <span className="adv-check">✓</span>}
                </button>
              );
            })}
          </div>
          {match.finished && advancerTeam && (
            <span className="advancer-result muted small">
              Pasó: <strong>{advancerTeam.name}</strong>
              {myPred?.advances &&
                (myPred.advances === match.advancer ? (
                  <span className="pts"> acertaste +1 ✓</span>
                ) : (
                  <span className="pts zero"> +0</span>
                ))}
            </span>
          )}
        </div>
      )}

      {live && (
        <div className="match-result live">
          {match.status === "FT" ? "✅ Final (provisional):" : "🔴 Va:"}{" "}
          <strong>{match.liveHome} - {match.liveAway}</strong>{" "}
          <span className="muted small">({liveLabel(match)})</span>
          {liveBreakdown !== null &&
            (myPred ? (
              <PointsBadge
                points={liveBreakdown.points}
                rule={`Provisional — ${liveBreakdown.rule}`}
                label={`${liveBreakdown.points} pts (provisional)`}
              />
            ) : (
              <span className="pts zero">no jugaste</span>
            ))}
        </div>
      )}

      {match.finished && (
        <div className="match-result">
          Resultado real: <strong>{match.homeScore} - {match.awayScore}</strong>
          {userBreakdown !== null &&
            (myPred ? (
              <PointsBadge
                points={userBreakdown.points}
                rule={userBreakdown.rule}
                label={`ganaste ${userBreakdown.points} pts`}
              />
            ) : (
              <span className="pts zero">no jugaste</span>
            ))}
        </div>
      )}

      <div className="match-foot">
        {save === "saving" && <span className="hint">guardando…</span>}
        {save === "saved" && <span className="hint ok">guardado ✓</span>}
        {save === "error" && <span className="hint err">{error}</span>}
        {!editable && !match.finished && hasTeams(match) && (
          <span className="hint">predicción cerrada</span>
        )}
        <button className="link" onClick={() => setShowPanel((v) => !v)}>
          {showPanel ? "ocultar" : "ver participantes"}
        </button>
      </div>

      {showPanel && (
        <ParticipantsPanel matchId={match.id} drawRuleActive={drawRuleActive} isKnockout={isKnockout} />
      )}
    </div>
  );
}

function ParticipantsPanel({
  matchId,
  drawRuleActive = false,
  isKnockout = false,
}: {
  matchId: number;
  drawRuleActive?: boolean;
  isKnockout?: boolean;
}) {
  const [data, setData] = useState<MatchPredictions | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .matchPredictions(matchId)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [matchId]);

  if (err) return <div className="panel err">{err}</div>;
  if (!data) return <div className="panel">cargando…</div>;

  if (!data.revealed) {
    return (
      <div className="panel">
        <div className="panel-title">
          Ya confirmaron ({data.count})
          <span className="muted"> · los pronósticos se revelan cuando empiece el partido</span>
        </div>
        {data.count === 0 ? (
          <p className="muted">Nadie ha confirmado todavía.</p>
        ) : (
          <div className="chips">
            {data.confirmed!.map((c) => (
              <span key={c.apodo} className="chip">{c.apodo}</span>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Ya empezó: se revelan los pronósticos. El resultado puede ser oficial,
  // provisional (en vivo) o aún no haber resultado.
  const result = data.match
    ? data.result === "live"
      ? `provisional ${data.match.homeScore}-${data.match.awayScore} (en vivo)`
      : `resultado ${data.match.homeScore}-${data.match.awayScore}`
    : "aún sin resultado";

  return (
    <div className="panel">
      <div className="panel-title">
        Pronósticos ({data.count}) · {result}
      </div>
      <table className="preds">
        <tbody>
          {data.predictions!.map((p) => {
            const bd = data.match
              ? scoreBreakdown(
                  { home: p.home, away: p.away },
                  { home: data.match.homeScore, away: data.match.awayScore },
                  drawRuleActive
                )
              : null;
            return (
              <tr key={p.apodo}>
                <td>{p.apodo}</td>
                <td className="mono">{p.home} - {p.away}</td>
                {isKnockout && (
                  <td className="mono adv-cell" title="Quién pasa">
                    {p.advances ? (
                      <span
                        className={
                          data.advancer ? (p.advances === data.advancer ? "adv-hit" : "adv-miss") : ""
                        }
                      >
                        ⏩{p.advances}
                        {data.advancer && p.advances === data.advancer ? " ✓" : ""}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                )}
                <td className="pts-cell">
                  {p.points !== null && bd ? (
                    <PointsBadge points={p.points} rule={bd.rule} />
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
