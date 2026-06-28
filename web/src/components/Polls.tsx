import { useEffect, useState } from "react";
import { api, type Poll } from "../api";
import { formatDateTime } from "../util";

export function Polls() {
  const [polls, setPolls] = useState<Poll[] | null>(null);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    api
      .polls()
      .then((d) => {
        setPolls(d.polls);
        setDeadline(d.deadline);
        setLocked(d.locked);
        setShowResults(d.showResults);
      })
      .catch(() => setPolls([]));
  }, []);

  // Voto OPTIMISTA: actualiza la UI al instante y manda la petición en segundo
  // plano; si falla, revierte. Así no se espera el round-trip a la base remota.
  function vote(key: string, choice: string) {
    if (locked || !polls) return;
    const prev = polls;
    const poll = prev.find((p) => p.key === key);
    if (!poll || poll.myChoice === choice) return;

    const next = prev.map((p) => {
      if (p.key !== key) return p;
      let counts = p.counts;
      if (counts) {
        const c = { ...counts.counts };
        const wasNew = p.myChoice === null;
        if (p.myChoice && p.myChoice !== choice) c[p.myChoice] = Math.max(0, (c[p.myChoice] ?? 0) - 1);
        c[choice] = (c[choice] ?? 0) + 1;
        counts = { counts: c, total: counts.total + (wasNew ? 1 : 0) };
      }
      return { ...p, myChoice: choice, counts };
    });
    setPolls(next);
    setErrors((e) => ({ ...e, [key]: "" }));

    api.votePoll(key, choice).catch((err: Error) => {
      setPolls(prev); // revertir
      setErrors((e) => ({ ...e, [key]: err.message }));
    });
  }

  if (!polls || polls.length === 0) return null;

  // Cerrada: resumen compacto con los resultados ganadores (ocupa poco espacio).
  // Solo se muestra si el admin tiene encendido "mostrar resultados"; si está
  // apagado no se renderiza nada (no ocupa espacio).
  if (locked) {
    if (!showResults) return null;
    const winners = polls
      .map((p) => ({ key: p.key, question: p.question, win: winnerOf(p) }))
      .filter((w): w is { key: string; question: string; win: Winner } => !!w.win);
    if (winners.length === 0) return null;
    return (
      <div className="polls-summary">
        <span className="ps-label">🗳️ Votación cerrada — ganó:</span>
        {winners.map((w) => (
          <span key={w.key} className="ps-win" title={w.question}>
            {w.win.label}{" "}
            <span className="ps-pct">
              {w.win.pct}% · {w.win.n} voto{w.win.n === 1 ? "" : "s"}
            </span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="polls">
      <div className="section-head">
        <h3>🗳️ Votación de la comunidad</h3>
        {!locked && deadline && (
          <span className="muted small">Abierta hasta el {formatDateTime(deadline)}</span>
        )}
      </div>
      {polls.map((p) => (
        <PollCard key={p.key} poll={p} locked={locked} err={errors[p.key]} onVote={vote} />
      ))}
    </div>
  );
}

interface Winner { label: string; pct: number; n: number }

/** Opción más votada de un poll (o null si no hay conteo/votos). */
function winnerOf(poll: Poll): Winner | null {
  if (!poll.counts || poll.counts.total === 0) return null;
  let best: { value: string; n: number } | null = null;
  for (const o of poll.options) {
    const n = poll.counts.counts[o.value] ?? 0;
    if (!best || n > best.n) best = { value: o.value, n };
  }
  if (!best || best.n === 0) return null;
  const opt = poll.options.find((o) => o.value === best!.value)!;
  return { label: opt.label, pct: Math.round((best.n / poll.counts.total) * 100), n: best.n };
}

function PollCard({
  poll,
  locked,
  err,
  onVote,
}: {
  poll: Poll;
  locked: boolean;
  err?: string;
  onVote: (key: string, choice: string) => void;
}) {
  const total = poll.counts?.total ?? 0;

  return (
    <div className="poll-card">
      <p className="poll-q">{poll.question}</p>
      <div className="poll-options">
        {poll.options.map((o) => {
          const mine = poll.myChoice === o.value;
          const n = poll.counts?.counts[o.value] ?? 0;
          const pct = poll.counts && total > 0 ? Math.round((n / total) * 100) : 0;
          return (
            <button
              key={o.value}
              type="button"
              className={`poll-opt${mine ? " mine" : ""}`}
              disabled={locked}
              onClick={() => onVote(poll.key, o.value)}
            >
              {poll.counts && <span className="poll-bar" style={{ width: `${pct}%` }} />}
              <span className="poll-opt-label">
                {mine ? "✓ " : ""}
                {o.label}
              </span>
              {poll.counts && (
                <span className="poll-opt-count">
                  {pct}% · {n}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="poll-foot">
        {locked ? (
          <span className="muted small">Votación cerrada 🔒</span>
        ) : poll.myChoice ? (
          <span className="muted small">Tu voto quedó registrado · puedes cambiarlo</span>
        ) : (
          <span className="muted small">Elige una opción</span>
        )}
        {poll.counts && <span className="muted small">{total} voto{total === 1 ? "" : "s"}</span>}
        {err && <span className="hint err">{err}</span>}
      </div>
    </div>
  );
}
