import { useEffect, useState } from "react";
import { api, type StandingsResponse } from "../api";
import { Flag } from "../components/Flag";

export function Standings() {
  const [data, setData] = useState<StandingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.standings().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="err center">{error}</p>;
  if (!data) return <p className="muted center">cargando posiciones…</p>;

  return (
    <div>
      <h2>Posiciones de grupos</h2>
      <p className="muted small">
        Clasifican 1º y 2º de cada grupo + los 8 mejores terceros (marcados en verde).
      </p>

      <div className="groups-grid">
        {data.groups.map((g) => (
          <div key={g.grp} className="group-card">
            <h3>Grupo {g.grp}</h3>
            <table className="standings">
              <thead>
                <tr>
                  <th></th>
                  <th>Equipo</th>
                  <th title="Jugados">PJ</th>
                  <th title="Diferencia de gol">DG</th>
                  <th title="Puntos">Pts</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.teamId} className={r.qualifies ? "qual" : ""}>
                    <td className="pos">{r.position}</td>
                    <td>
                      <Flag teamId={r.teamId} emoji={r.flag} /> {r.name}
                    </td>
                    <td className="mono">{r.played}</td>
                    <td className="mono">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                    <td className="mono total">{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {data.bestThirds.length > 0 && (
        <div className="thirds">
          <h3>Mejores terceros clasificados</h3>
          <div className="chips">
            {data.bestThirds.map((t) => (
              <span key={t.id} className="chip qual">
                <Flag teamId={t.id} emoji={t.flag} /> {t.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
