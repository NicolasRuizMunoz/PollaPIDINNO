import { useEffect, useState } from "react";
import { api, type StandingsResponse, type StandingRow, type Match } from "../api";
import { Flag } from "../components/Flag";

const STAGE_SHORT: Record<string, string> = {
  r32: "16avos",
  r16: "Octavos",
  qf: "Cuartos",
  sf: "Semis",
};

export function Standings() {
  const [view, setView] = useState<"grupos" | "elim">("grupos");
  const [data, setData] = useState<StandingsResponse | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.standings().then(setData).catch((e) => setError(e.message));
    api.matches().then((d) => setMatches(d.matches)).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="err center">{error}</p>;
  if (!data) return <p className="muted center">cargando posiciones…</p>;

  return (
    <div>
      <h2>Posiciones</h2>

      <div className="subnav">
        <button className={view === "grupos" ? "active" : ""} onClick={() => setView("grupos")}>
          Grupos
        </button>
        <button className={view === "elim" ? "active" : ""} onClick={() => setView("elim")}>
          Eliminatorias
        </button>
      </div>

      {view === "grupos" ? (
        <GroupTables data={data} />
      ) : matches ? (
        <Bracket matches={matches} />
      ) : (
        <p className="muted center">cargando cuadro…</p>
      )}
    </div>
  );
}

const STATUS_CLASS: Record<StandingRow["status"], string> = {
  qualified: "qual",
  third: "third",
  eliminated: "out",
  alive: "",
};

function GroupTables({ data }: { data: StandingsResponse }) {
  const allRows = data.groups.flatMap((g) => g.rows);
  return (
    <div>
      <p className="muted small">
        Orden y desempates según las reglas FIFA (puntos, enfrentamiento directo,
        diferencia de gol, goles a favor). Clasifican 1º y 2º de cada grupo + los
        8 mejores terceros, según van hoy las posiciones.
      </p>

      <div className="standings-legend">
        <span><i className="dot qual" /> Clasifica</span>
        <span><i className="dot third" /> Posible mejor tercero</span>
        <span><i className="dot out" /> Eliminado</span>
      </div>

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
                  <tr key={r.teamId} className={STATUS_CLASS[r.status]}>
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
          <h3>Mejores terceros (proyección actual)</h3>
          <div className="chips">
            {data.bestThirds.map((t) => (
              <span key={t.id} className="chip qual">
                <Flag teamId={t.id} emoji={t.flag} /> {t.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <TeamChips
        title="Posibles mejores terceros"
        cls="third"
        rows={allRows.filter((r) => r.status === "third")}
      />
      <TeamChips
        title="Eliminados"
        cls="out"
        rows={allRows.filter((r) => r.status === "eliminated")}
      />
    </div>
  );
}

/** Lista de equipos como chips, agrupados por estado (amarillos, eliminados…). */
function TeamChips({
  title,
  cls,
  rows,
}: {
  title: string;
  cls: string;
  rows: StandingRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="thirds">
      <h3>{title}</h3>
      <div className="chips">
        {rows.map((r) => (
          <span key={r.teamId} className={`chip ${cls}`}>
            <Flag teamId={r.teamId} emoji={r.flag} /> {r.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Sigue una fuente "WM:<code>"/"LM:<code>" hasta el partido que la alimenta. */
function feederOf(src: string | null, byCode: Map<string, Match>): Match | null {
  if (!src) return null;
  const [kind, arg] = src.split(":");
  return kind === "WM" || kind === "LM" ? byCode.get(arg) ?? null : null;
}

/** Niveles del arbol desde una raiz: [raiz], [feeders], [feeders de feeders]... */
function levelsFrom(root: Match | null, byCode: Map<string, Match>): Match[][] {
  const out: Match[][] = [];
  let cur: (Match | null)[] = [root];
  while (cur.some(Boolean)) {
    out.push(cur.filter((m): m is Match => !!m));
    const next: (Match | null)[] = [];
    for (const m of cur) {
      next.push(feederOf(m?.homeSrc ?? null, byCode), feederOf(m?.awaySrc ?? null, byCode));
    }
    cur = next;
  }
  return out;
}

function Bracket({ matches }: { matches: Match[] }) {
  const ko = matches.filter((m) => m.stage !== "group");
  if (ko.length === 0) return <p className="muted center">Aún no hay eliminatorias.</p>;

  const byCode = new Map(ko.filter((m) => m.code).map((m) => [m.code as string, m]));
  const final = ko.find((m) => m.stage === "final") ?? null;
  const third = ko.find((m) => m.stage === "third") ?? null;

  if (!final) return <p className="muted center">El cuadro aún no está disponible.</p>;

  // mitad izquierda = rama de un semifinalista; derecha = la otra
  const leftCols = [...levelsFrom(feederOf(final.homeSrc, byCode), byCode)].reverse();
  const rightCols = levelsFrom(feederOf(final.awaySrc, byCode), byCode);

  const Column = (col: Match[]) => (
    <div key={col[0].id} className="bk-col">
      <h4>{STAGE_SHORT[col[0].stage] ?? col[0].stage}</h4>
      <div className="bk-col-body">
        {col.map((m) => (
          <BracketMatch key={m.id} m={m} />
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <p className="muted small">
        El cuadro se va completando solo a medida que se publican los resultados.
      </p>

      <div className="bracket2">
        <div className="bk-half">{leftCols.map(Column)}</div>

        <div className="bk-col bk-center">
          <h4>Final</h4>
          <div className="bk-col-body bk-center-body">
            <BracketMatch m={final} />
            {third && (
              <div className="bk-third-inline">
                <h4>3er puesto</h4>
                <BracketMatch m={third} />
              </div>
            )}
          </div>
        </div>

        <div className="bk-half">{rightCols.map(Column)}</div>
      </div>
    </div>
  );
}

function BracketMatch({ m }: { m: Match }) {
  const decided = m.finished && m.homeScore !== null && m.awayScore !== null;
  const homeWin = decided && (m.homeScore as number) > (m.awayScore as number);
  const awayWin = decided && (m.awayScore as number) > (m.homeScore as number);
  return (
    <div className={`bk-match ${m.finished ? "done" : ""}`}>
      <BracketSide team={m.home} src={m.homeSrc} score={m.homeScore} win={homeWin} />
      <BracketSide team={m.away} src={m.awaySrc} score={m.awayScore} win={awayWin} />
    </div>
  );
}

/** Token corto para una plaza sin definir (ej. "2°A", "G·M2"). */
function shortSrc(src: string | null): string {
  if (!src) return "—";
  const [kind, arg] = src.split(":");
  switch (kind) {
    case "WG": return `1°${arg}`;
    case "RU": return `2°${arg}`;
    case "TH": return `3°·${arg}`;
    case "WM": return `G·${arg}`;
    case "LM": return `P·${arg}`;
    default: return "—";
  }
}

function BracketSide({
  team,
  src,
  score,
  win,
}: {
  team: Match["home"];
  src: string | null;
  score: number | null;
  win: boolean;
}) {
  // Solo banderas: para equipos definidos se muestra la bandera (nombre en el
  // tooltip); para los cupos sin definir, el token corto (1°A, G·M2, etc.).
  return (
    <div className={`bk-side ${win ? "win" : ""} ${team ? "" : "tbd"}`} title={team?.name ?? undefined}>
      <Flag teamId={team?.id} emoji={team?.flag} size={20} />
      <span className="bk-name">{team ? "" : shortSrc(src)}</span>
      <span className="bk-score">{score ?? ""}</span>
    </div>
  );
}
