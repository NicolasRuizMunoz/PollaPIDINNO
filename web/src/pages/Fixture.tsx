import { useMemo, useState } from "react";
import { useMatches } from "../useMatches";
import { MatchCard } from "../components/MatchCard";
import { STAGE_LABEL, STAGE_ORDER } from "../util";
import type { Match, Stage } from "../api";

const KO_SHORT: Record<string, string> = {
  r32: "16avos",
  r16: "Octavos",
  qf: "Cuartos",
  sf: "Semis",
  third: "3º puesto",
  final: "Final",
};

export function Fixture() {
  const { data, loading, error, onSaved } = useMatches();
  const [sel, setSel] = useState<string>("A");
  const [koStage, setKoStage] = useState<Stage>("r32");

  const groups = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    data.matches.forEach((m) => m.grp && set.add(m.grp));
    return [...set].sort();
  }, [data]);

  if (loading) return <p className="muted center">cargando partidos…</p>;
  if (error) return <p className="err center">{error}</p>;
  if (!data) return null;

  const renderMatch = (m: Match) => (
    <MatchCard
      key={m.id}
      match={m}
      myPred={data.myPredictions[m.id]}
      onSaved={onSaved}
      drawRuleActive={data.drawRuleActive}
    />
  );

  const groupMatches = (g: string) =>
    data.matches
      .filter((m) => m.stage === "group" && m.grp === g)
      .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt));

  const knockoutStages = STAGE_ORDER.filter((s) => s !== "group");

  // progreso de predicciones del grupo seleccionado
  const progress = (g: string) => {
    const ms = groupMatches(g);
    const done = ms.filter((m) => data.myPredictions[m.id]).length;
    return `${done}/${ms.length}`;
  };

  return (
    <div>
      <h2>Partidos</h2>

      <div className="subnav">
        {groups.map((g) => (
          <button key={g} className={sel === g ? "active" : ""} onClick={() => setSel(g)}>
            Grupo {g}
          </button>
        ))}
        <button className={sel === "elim" ? "active" : ""} onClick={() => setSel("elim")}>
          Eliminatorias
        </button>
      </div>

      {sel !== "elim" ? (
        <div>
          <div className="section-head">
            <h3>Grupo {sel}</h3>
            <span className="muted">predichos {progress(sel)}</span>
          </div>
          {groupMatches(sel).map(renderMatch)}
        </div>
      ) : (
        <div>
          <div className="subnav">
            {knockoutStages.map((stage) => (
              <button
                key={stage}
                className={koStage === stage ? "active" : ""}
                onClick={() => setKoStage(stage)}
              >
                {KO_SHORT[stage]}
              </button>
            ))}
          </div>

          <h3>{STAGE_LABEL[koStage]}</h3>
          {data.matches
            .filter((m) => m.stage === koStage)
            .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt))
            .map(renderMatch)}

          <p className="muted small">
            Los equipos de las eliminatorias aparecen automáticamente cuando se cargan los
            resultados de las fases anteriores.
          </p>
        </div>
      )}
    </div>
  );
}
