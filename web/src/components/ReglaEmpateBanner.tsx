import { useEffect, useState } from "react";
import { api, getUser, type DrawRulePreview } from "../api";
import { formatDate } from "../util";

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
  const trigger = data.trigger;

  return (
    <div className={"regla-banner" + (active ? " applied" : "")}>
      <h3>
        {active
          ? "✅ Nueva regla del empate: ya aplicada"
          : "🗳️ La votación ganó: se recalculan los puntos"}
      </h3>
      <p className="small">
        Cambia la regla del <strong>empate</strong>. Antes, predecir cualquier
        empate (p. ej. 0-0) acertaba siempre la diferencia de goles y sumaba el
        bono de +1 “gratis”.
      </p>

      <div className="regla-rule">
        <strong>Nueva regla del empate:</strong> el bono de +1 se gana solo si tu
        marcador queda a <strong>1 gol</strong> del resultado real.
        <ul>
          <li>Pones <strong>1-1</strong> y queda <strong>2-2</strong> → +1 (a 1 gol). ✅</li>
          <li>Pones <strong>0-0</strong> y queda <strong>2-2</strong> → sin bono (a 2 goles). ❌</li>
        </ul>
        Acertar el empate sigue dando +3, y el marcador exacto +5. Con ganador
        definido nada cambia.
      </div>

      <p className="regla-apply">
        {active ? (
          <>
            ✅ El cambio <strong>ya rige</strong>
            {trigger && <> (se publicó {trigger.home} vs {trigger.away})</>}. Los
            puntos de abajo ya están recalculados con la regla nueva.
          </>
        ) : (
          <>
            ⏱️ El cambio se aplicará cuando termine el partido de{" "}
            <strong>
              {trigger ? `${trigger.home} vs ${trigger.away}` : "Colombia"}
            </strong>{" "}
            y se publique el resultado
            {trigger && <> ({formatDate(trigger.kickoffAt)}, ~las 12 de la noche)</>}.
            Hasta entonces los puntos siguen con la regla anterior.
          </>
        )}
      </p>

      {data.affectedCount === 0 ? (
        <p className="small muted">
          Con los resultados de ahora, a nadie le {active ? "bajó" : "baja"} el
          puntaje. 🎉
        </p>
      ) : (
        <>
          <p className="small muted">
            ℹ️ Son pocos porque casi todos los que pusieron empate quedaron a 1
            gol del marcador real (p. ej. 1-1 y quedó 2-2) y <strong>conservan
            el bono</strong>. Solo pierden el +1 quienes quedaron a 2 goles o más
            (p. ej. 0-0 y quedó 2-2).
          </p>

          <button className="link regla-toggle" onClick={() => setOpen((v) => !v)}>
            {open
              ? "▾ Ocultar detalle"
              : active
              ? "▸ Ver a quién le bajó"
              : "▸ Ver a quién le baja"}{" "}
            · {data.affectedCount} jugador{data.affectedCount === 1 ? "" : "es"} (−
            {data.pointsRemoved} pt{data.pointsRemoved === 1 ? "" : "s"} en total)
          </button>

          {open &&
            data.affected.map((u) => (
              <div
                key={u.userId}
                className={"regla-user" + (me?.id === u.userId ? " me" : "")}
              >
                <div className="regla-user-head">
                  <span>
                    {u.apodo}
                    {me?.id === u.userId && " (tú)"}
                  </span>
                  <span className="delta">
                    {u.oldTotal} → {u.newTotal} ({u.delta})
                  </span>
                </div>
                <ul className="regla-changes">
                  {u.changes.map((c) => (
                    <li key={c.matchId}>
                      {c.home} <strong>{c.actualHome}-{c.actualAway}</strong> {c.away}
                      {" · "}tu {c.predHome}-{c.predAway}
                      {" · "}
                      <span className="regla-pts">{c.oldPts} → {c.newPts}</span> pts
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
