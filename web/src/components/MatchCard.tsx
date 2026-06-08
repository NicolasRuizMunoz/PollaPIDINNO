import { useEffect, useRef, useState } from "react";
import { api, type Match, type MatchPredictions } from "../api";
import {
  formatDateTime,
  hasTeams,
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
}: {
  match: Match;
  myPred?: { home: number; away: number };
  onSaved?: (matchId: number, home: number, away: number) => void;
}) {
  const editable = !match.locked && hasTeams(match);
  const [home, setHome] = useState(myPred ? String(myPred.home) : "");
  const [away, setAway] = useState(myPred ? String(myPred.away) : "");
  const [save, setSave] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(false);

  useEffect(() => {
    setHome(myPred ? String(myPred.home) : "");
    setAway(myPred ? String(myPred.away) : "");
  }, [myPred?.home, myPred?.away]);

  const timer = useRef<number | undefined>(undefined);
  const lastSaved = useRef<string>(myPred ? `${myPred.home}-${myPred.away}` : "");

  function scheduleSave(h: string, a: string) {
    if (timer.current) window.clearTimeout(timer.current);
    const hi = parseInt(h, 10);
    const ai = parseInt(a, 10);
    if (!Number.isInteger(hi) || !Number.isInteger(ai) || hi < 0 || ai < 0) return;
    if (`${hi}-${ai}` === lastSaved.current) return;
    timer.current = window.setTimeout(async () => {
      setSave("saving");
      setError(null);
      try {
        await api.savePrediction(match.id, hi, ai);
        lastSaved.current = `${hi}-${ai}`;
        setSave("saved");
        onSaved?.(match.id, hi, ai);
        window.setTimeout(() => setSave("idle"), 1500);
      } catch (e) {
        setSave("error");
        setError(e instanceof Error ? e.message : "Error al guardar");
      }
    }, 600);
  }

  const userBreakdown =
    match.finished && myPred
      ? scoreBreakdown(myPred, { home: match.homeScore, away: match.awayScore })
      : null;

  return (
    <div className={`match ${match.finished ? "finished" : ""}`}>
      <div className="match-meta">
        <span>{formatDateTime(match.kickoffAt)}</span>
        {match.locked && !match.finished && <span className="tag">🔒 cerrado</span>}
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

      {showPanel && <ParticipantsPanel matchId={match.id} />}
    </div>
  );
}

function ParticipantsPanel({ matchId }: { matchId: number }) {
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
          <span className="muted"> · los marcadores se revelan cuando el admin publique el resultado</span>
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

  return (
    <div className="panel">
      <div className="panel-title">
        Pronósticos ({data.count}) · resultado {data.match!.homeScore}-{data.match!.awayScore}
      </div>
      <table className="preds">
        <tbody>
          {data.predictions!.map((p) => {
            const bd = scoreBreakdown(
              { home: p.home, away: p.away },
              { home: data.match!.homeScore, away: data.match!.awayScore }
            );
            return (
              <tr key={p.apodo}>
                <td>{p.apodo}</td>
                <td className="mono">{p.home} - {p.away}</td>
                <td className="pts-cell">
                  <PointsBadge points={p.points} rule={bd.rule} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
