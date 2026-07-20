import { useEffect, useState } from "react";
import { api, type Team, type TournamentInfo, type BonusSummary } from "../api";
import { formatDateTime } from "../util";
import { TeamSelect } from "../components/TeamSelect";
import { PointsBadge } from "../components/PointsBadge";

export function Bonos() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [info, setInfo] = useState<TournamentInfo | null>(null);
  const [summary, setSummary] = useState<BonusSummary | null>(null);
  const [champion, setChampion] = useState("");
  const [runnerUp, setRunnerUp] = useState("");
  const [topScorer, setTopScorer] = useState("");
  const [bestGoalkeeper, setBestGoalkeeper] = useState("");
  const [bestPlayer, setBestPlayer] = useState("");
  const [bestYoungPlayer, setBestYoungPlayer] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([api.teams(), api.tournament(), api.bonosSummary()])
      .then(([t, i, s]) => {
        setTeams(t);
        setInfo(i);
        setSummary(s);
        if (i.mine) {
          setChampion(i.mine.champion ?? "");
          setRunnerUp(i.mine.runner_up ?? "");
          setTopScorer(i.mine.top_scorer ?? "");
          setBestGoalkeeper(i.mine.best_goalkeeper ?? "");
          setBestPlayer(i.mine.best_player ?? "");
          setBestYoungPlayer(i.mine.best_young_player ?? "");
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
        bestPlayer: bestPlayer || null,
        bestYoungPlayer: bestYoungPlayer || null,
      });
      setStatus("Bonos guardados ✓");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    }
  }

  function toggleExpanded(key: string) {
    const newSet = new Set(expanded);
    if (newSet.has(key)) newSet.delete(key);
    else newSet.add(key);
    setExpanded(newSet);
  }

  return (
    <div>
      <h2>Bonos del torneo</h2>
      <p className="muted small">
        Campeón vale <strong>15 puntos</strong>; subcampeón, goleador, mejor arquero,
        mejor jugador y mejor jugador joven, <strong>10 c/u</strong>.{" "}
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

        <label>
          ⭐ Mejor jugador
          <input
            type="text"
            placeholder="Nombre del jugador"
            value={bestPlayer}
            disabled={locked}
            onChange={(e) => setBestPlayer(e.target.value)}
          />
        </label>

        <label>
          🌟 Mejor jugador joven
          <input
            type="text"
            placeholder="Nombre del jugador"
            value={bestYoungPlayer}
            disabled={locked}
            onChange={(e) => setBestYoungPlayer(e.target.value)}
          />
        </label>

        {!locked && (
          <button type="submit" className="btn primary">Guardar bonos</button>
        )}
        {status && <p className="hint ok">{status}</p>}
        {error && <p className="err">{error}</p>}
      </form>

      {locked && info.results && summary && (
        <div className="results-box">
          <h3>Resultados oficiales</h3>
          <ResultRow label="🏆 Campeón" value={15} mine={teamName(info.mine?.champion ?? null)} real={teamName(info.results.champion)} />
          <ResultRow label="🥈 Subcampeón" value={10} mine={teamName(info.mine?.runner_up ?? null)} real={teamName(info.results.runnerUp)} />
          <ResultRow label="⚽ Goleador" value={10} mine={info.mine?.top_scorer ?? "—"} real={info.results.topScorer ?? "—"} />
          <ResultRow label="🧤 Mejor arquero" value={10} mine={info.mine?.best_goalkeeper ?? "—"} real={info.results.bestGoalkeeper ?? "—"} />
          <ResultRow label="⭐ Mejor jugador" value={10} mine={info.mine?.best_player ?? "—"} real={info.results.bestPlayer ?? "—"} />
          <ResultRow label="🌟 Mejor jugador joven" value={10} mine={info.mine?.best_young_player ?? "—"} real={info.results.bestYoungPlayer ?? "—"} />

          <h3 style={{ marginTop: "2rem" }}>Resumen de predicciones</h3>
          <SummaryCategory
            title="🏆 Campeón"
            category={summary.champion}
            expanded={expanded.has("champion")}
            onToggle={() => toggleExpanded("champion")}
          />
          <SummaryCategory
            title="🥈 Subcampeón"
            category={summary.runnerUp}
            expanded={expanded.has("runnerUp")}
            onToggle={() => toggleExpanded("runnerUp")}
          />
          <SummaryCategory
            title="⚽ Goleador"
            category={summary.topScorer}
            expanded={expanded.has("topScorer")}
            onToggle={() => toggleExpanded("topScorer")}
          />
          <SummaryCategory
            title="🧤 Mejor arquero"
            category={summary.bestGoalkeeper}
            expanded={expanded.has("bestGoalkeeper")}
            onToggle={() => toggleExpanded("bestGoalkeeper")}
          />
          <SummaryCategory
            title="⭐ Mejor jugador"
            category={summary.bestPlayer}
            expanded={expanded.has("bestPlayer")}
            onToggle={() => toggleExpanded("bestPlayer")}
          />
          <SummaryCategory
            title="🌟 Mejor jugador joven"
            category={summary.bestYoungPlayer}
            expanded={expanded.has("bestYoungPlayer")}
            onToggle={() => toggleExpanded("bestYoungPlayer")}
          />
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

function SummaryCategory({
  title,
  category,
  expanded,
  onToggle,
}: {
  title: string;
  category: any;
  expanded: boolean;
  onToggle: () => void;
}) {
  // Agrupar por valor normalizado, pero mostrar todas las variantes
  const grouped: Record<string, Array<{ original: string; normalized: string; users: string[] }>> = {};

  for (const [normalized, data] of Object.entries(category.predictions)) {
    if (!grouped[normalized]) {
      grouped[normalized] = [];
    }
    grouped[normalized].push(...(data as any).predictions);
  }

  const predictions = Object.entries(grouped)
    .map(([normalized, variants]) => ({
      normalized,
      variants,
      totalCount: variants.reduce((sum, v) => sum + v.users.length, 0),
      allUsers: variants.flatMap(v => v.users),
      hit: normalized === category.real,
    }))
    .sort((a, b) => b.totalCount - a.totalCount);

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div
        onClick={onToggle}
        style={{
          cursor: "pointer",
          padding: "0.75rem",
          backgroundColor: "#f5f5f5",
          borderRadius: "4px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <strong>{title}</strong>
        <span style={{ fontSize: "0.9rem", color: "#666" }}>
          Real: <strong style={{ color: category.real ? "green" : "#999" }}>{category.real || "—"}</strong>
          {" "}
          {expanded ? "▼" : "▶"}
        </span>
      </div>

      {expanded && (
        <div style={{ paddingTop: "0.75rem", paddingLeft: "1rem" }}>
          {predictions.length === 0 ? (
            <p className="muted">Nadie completó esta predicción</p>
          ) : (
            predictions.map((p) => (
              <div
                key={p.normalized}
                style={{
                  padding: "0.75rem",
                  marginBottom: "0.75rem",
                  backgroundColor: p.hit ? "#e8f5e9" : "#ffebee",
                  borderLeft: `4px solid ${p.hit ? "#4caf50" : "#f44336"}`,
                  borderRadius: "2px",
                }}
              >
                <div style={{ fontWeight: "600", color: p.hit ? "#2e7d32" : "#c62828", marginBottom: "0.5rem" }}>
                  {p.normalized} ({p.totalCount} {p.totalCount === 1 ? "persona" : "personas"})
                  {p.hit && " ✓"}
                </div>

                {p.variants.length > 0 && (
                  <div style={{ fontSize: "0.85rem", color: "#555" }}>
                    {p.variants.map((variant, idx) => (
                      <div key={idx} style={{ marginBottom: "0.25rem", marginLeft: "0.5rem" }}>
                        <span style={{ color: "#999" }}>"{variant.original}"</span>
                        {variant.original !== variant.normalized && (
                          <span style={{ color: "#999" }}> → {variant.normalized}</span>
                        )}
                        <div style={{ fontSize: "0.8rem", color: "#666", marginLeft: "1rem" }}>
                          {variant.users.join(", ")}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
