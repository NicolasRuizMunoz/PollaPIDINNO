import { useEffect, useState } from "react";
import { api, getUser, type LeaderRow } from "../api";

export function Leaderboard() {
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const me = getUser();

  useEffect(() => {
    api.leaderboard().then(setRows).catch((e) => setError(e.message));
  }, []);

  const anyLive = !!rows?.some((r) => r.livePoints !== 0);

  // si hay puntos en vivo, refresca la tabla cada 60s
  useEffect(() => {
    if (!anyLive) return;
    const id = window.setInterval(() => {
      api.leaderboard().then(setRows).catch(() => {});
    }, 60_000);
    return () => window.clearInterval(id);
  }, [anyLive]);

  if (error) return <p className="err center">{error}</p>;
  if (!rows) return <p className="muted center">cargando tabla…</p>;

  return (
    <div>
      <h2>Tabla de posiciones</h2>
      {anyLive && (
        <p className="muted small">
          🔴 Incluye puntos <strong>provisionales</strong> de partidos en curso o aún sin
          confirmar (se vuelven oficiales cuando el admin publica el resultado).
        </p>
      )}
      {rows.length === 0 ? (
        <p className="muted">Todavía no hay jugadores.</p>
      ) : (
        <table className="leaderboard">
          <thead>
            <tr>
              <th>#</th>
              <th>Jugador</th>
              <th title="Puntos por partidos">Part.</th>
              <th title="Puntos por bonos">Bonos</th>
              <th title="Marcadores exactos">Exactos</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.userId} className={me?.id === r.userId ? "me" : ""}>
                <td className="rank">{medal(i)}</td>
                <td>{r.apodo}</td>
                <td className="mono">{r.matchPoints}</td>
                <td className="mono">{r.bonusPoints}</td>
                <td className="mono">{r.exactCount}</td>
                <td className="mono total">
                  {r.liveTotal}
                  {r.livePoints !== 0 && (
                    <span
                      className="tag tag-live"
                      title={`Oficial: ${r.total} · provisional en vivo: ${r.livePoints > 0 ? "+" : ""}${r.livePoints}`}
                    >
                      🔴 {r.livePoints > 0 ? "+" : ""}{r.livePoints}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function medal(i: number): string {
  return ["🥇", "🥈", "🥉"][i] ?? String(i + 1);
}
