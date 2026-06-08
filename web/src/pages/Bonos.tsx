import { useEffect, useState } from "react";
import { api, type Team, type TournamentInfo } from "../api";
import { formatDateTime } from "../util";
import { TeamSelect } from "../components/TeamSelect";
import { PointsBadge } from "../components/PointsBadge";

export function Bonos() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [info, setInfo] = useState<TournamentInfo | null>(null);
  const [champion, setChampion] = useState("");
  const [runnerUp, setRunnerUp] = useState("");
  const [topScorer, setTopScorer] = useState("");
  const [bestGoalkeeper, setBestGoalkeeper] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.teams(), api.tournament()])
      .then(([t, i]) => {
        setTeams(t);
        setInfo(i);
        if (i.mine) {
          setChampion(i.mine.champion ?? "");
          setRunnerUp(i.mine.runner_up ?? "");
          setTopScorer(i.mine.top_scorer ?? "");
          setBestGoalkeeper(i.mine.best_goalkeeper ?? "");
        }
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="err center">{error}</p>;
  if (!info) return <p className="muted center">cargando…</p>;

  const locked = info.locked;
  const teamName = (id: string | null) =>
    teams.find((t) => t.id === id)?.name ?? id ?? "—";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setError(null);
    try {
      await api.saveTournament({
        champion: champion || null,
        runnerUp: runnerUp || null,
        topScorer: topScorer || null,
        bestGoalkeeper: bestGoalkeeper || null,
      });
      setStatus("Bonos guardados ✓");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    }
  }

  return (
    <div>
      <h2>Bonos del torneo</h2>
      <p className="muted small">
        Campeón vale <strong>15 puntos</strong>; subcampeón, goleador y mejor arquero,{" "}
        <strong>10 c/u</strong>.{" "}
        {locked ? (
          <span className="err">Cerrados (ya empezó la primera fecha).</span>
        ) : (
          <>
            Puedes editarlos hasta{" "}
            {info.deadline ? formatDateTime(info.deadline) : "el inicio del torneo"}.
          </>
        )}
      </p>

      <form onSubmit={save} className="bonos">
        <label>
          🏆 Campeón <span className="muted small">(15 pts)</span>
          <TeamSelect teams={teams} value={champion} disabled={locked} onChange={setChampion} />
        </label>

        <label>
          🥈 Subcampeón <span className="muted small">(10 pts)</span>
          <TeamSelect teams={teams} value={runnerUp} disabled={locked} onChange={setRunnerUp} />
        </label>

        <label>
          ⚽ Goleador
          <input
            type="text"
            placeholder="Nombre del jugador"
            value={topScorer}
            disabled={locked}
            onChange={(e) => setTopScorer(e.target.value)}
          />
        </label>

        <label>
          🧤 Mejor arquero
          <input
            type="text"
            placeholder="Nombre del jugador"
            value={bestGoalkeeper}
            disabled={locked}
            onChange={(e) => setBestGoalkeeper(e.target.value)}
          />
        </label>

        {!locked && (
          <button type="submit" className="btn primary">Guardar bonos</button>
        )}
        {status && <p className="hint ok">{status}</p>}
        {error && <p className="err">{error}</p>}
      </form>

      {locked && info.results && (
        <div className="results-box">
          <h3>Resultados oficiales</h3>
          <ResultRow label="🏆 Campeón" value={15} mine={teamName(info.mine?.champion ?? null)} real={teamName(info.results.champion)} />
          <ResultRow label="🥈 Subcampeón" value={10} mine={teamName(info.mine?.runner_up ?? null)} real={teamName(info.results.runnerUp)} />
          <ResultRow label="⚽ Goleador" value={10} mine={info.mine?.top_scorer ?? "—"} real={info.results.topScorer ?? "—"} />
          <ResultRow label="🧤 Mejor arquero" value={10} mine={info.mine?.best_goalkeeper ?? "—"} real={info.results.bestGoalkeeper ?? "—"} />
        </div>
      )}
    </div>
  );
}

function ResultRow({
  label,
  value,
  mine,
  real,
}: {
  label: string;
  value: number;
  mine: string;
  real: string;
}) {
  const hit = real !== "—" && mine.trim().toLowerCase() === real.trim().toLowerCase();
  return (
    <div className="result-row">
      <span>{label}</span>
      <span className="muted">tú: {mine}</span>
      <span>real: <strong>{real}</strong></span>
      <PointsBadge
        points={hit ? value : 0}
        label={hit ? `+${value}` : "0"}
        rule={hit ? `Acertaste → +${value}` : `No acertaste → 0 (valía ${value})`}
      />
    </div>
  );
}
