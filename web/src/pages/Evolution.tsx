import { useEffect, useState } from "react";
import { api, type EvolutionEntry } from "../api";
import "./Evolution.css";

export function Evolution() {
  const [data, setData] = useState<EvolutionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.evolution().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="evolution-error">{error}</p>;
  if (!data) return <p className="evolution-loading">Cargando evolución…</p>;

  return (
    <div className="evolution-container">
      <div className="evolution-header">
        <h1>Tu Evolución</h1>
        <p className="evolution-subtitle">Posición y puntos jornada a jornada</p>
      </div>

      <div className="evolution-table-wrapper">
        <table className="evolution-table">
          <thead>
            <tr>
              <th className="col-jornada">Jornada</th>
              <th className="col-stage">Etapa</th>
              <th className="col-position">Posición</th>
              <th className="col-points">Puntos</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <tr key={idx} className={idx === data.length - 1 ? "is-latest" : ""}>
                <td className="col-jornada">{row.jornada}</td>
                <td className="col-stage">{row.stage}</td>
                <td className="col-position">#{row.position}</td>
                <td className="col-points">{row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
