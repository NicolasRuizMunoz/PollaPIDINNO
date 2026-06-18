import { useEffect, useState } from "react";
import { api, getUser, type DrawRulePreview } from "../api";

/**
 * Aviso (arriba de "Hoy") del cambio de regla del empate aprobado en la
 * votación. Muestra la regla nueva y, por jugador, cuánto baja y en qué
 * partidos. Es informativo. El cambio se ACTIVA solo cuando se publica el
 * partido disparador (Colombia): hasta entonces los puntos usan la regla vieja.
 */
export function ReglaEmpateBanner() {
  const [data, setData] = useState<DrawRulePreview | null>(null);
  const [open, setOpen] = useState(false);
  const me = getUser();

  useEffect(() => {
    api.reglaEmpate().then(setData).catch(() => setData(null));
  }, []);

  if (!data) return null;

  const active = data.active;

  return (
    <div className={“regla-banner” + (active ? “ applied” : “”)}>
      <h3>
        {active
          ? “✅ Nueva regla del empate: ya aplicada”
          : “🗳️ La votación ganó: se recalculan los puntos”}
      </h3>

      <div className=”regla-rule”>
        <strong>Nueva regla del empate:</strong> el bono de +1 se gana solo si tu
        marcador queda a <strong>1 gol</strong> del resultado real.
        <ul>
          <li>Pones <strong>1-1</strong> y queda <strong>2-2</strong> → +1 (a 1 gol). ✅</li>
          <li>Pones <strong>0-0</strong> y queda <strong>2-2</strong> → sin bono (a 2 goles). ❌</li>
        </ul>
        Acertar el empate sigue dando +3, y el marcador exacto +5. Con ganador
        definido nada cambia.
      </div>

      {data.affectedCount === 0 ? (
        <p className=”small muted”>
          Con los resultados de ahora, a nadie le {active ? “bajó” : “baja”} el
          puntaje. 🎉
        </p>
      ) : (
        <>
          <button className=”link regla-toggle” onClick={() => setOpen((v) => !v)}>
            {open
              ? “▾ Ocultar detalle”
              : active
              ? “▸ Ver a quién le bajó”
              : “▸ Ver a quién le baja”}{“ “}
            · {data.affectedCount} jugador{data.affectedCount === 1 ? “” : “es”} (−
            {data.pointsRemoved} pt{data.pointsRemoved === 1 ? “” : “s”} en total)
          </button>

          {open &&
            data.affected.map((u) => (
              <div
                key={u.userId}
                className={“regla-user” + (me?.id === u.userId ? “ me” : “”)}
              >
                <div className=”regla-user-head”>
                  <span>
                    {u.apodo}
                    {me?.id === u.userId && “ (tú)”}
                  </span>
                  <span className=”delta”>
                    {u.oldTotal} → {u.newTotal} ({u.delta})
                  </span>
                </div>
                <ul className=”regla-changes”>
                  {u.changes.map((c) => (
                    <li key={c.matchId}>
                      {c.home} <strong>{c.actualHome}-{c.actualAway}</strong> {c.away}
                      {“ · “}tu {c.predHome}-{c.predAway}
                      {“ · “}
                      <span className=”regla-pts”>{c.oldPts} → {c.newPts}</span> pts
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </>
      )}
    </div>
  );
}
