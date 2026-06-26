import { useEffect, useMemo, useState } from "react";
import { api, getUser, type MyMatch } from "../api";
import { Flag } from "../components/Flag";
import { PointsBadge } from "../components/PointsBadge";
import { formatDate, sideName, scoreBreakdown, STAGE_LABEL } from "../util";

type Estado = "todos" | "jugados" | "pendientes";
type Acierto = "todos" | "exacto" | "parcial" | "cero";
type Fase = "todas" | "group" | "elim";
type Orden = "cronologico" | "recientes";

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function MisPartidos() {
  const me = getUser();
  const [matches, setMatches] = useState<MyMatch[] | null>(null);
  const [ruleV2, setRuleV2] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [estado, setEstado] = useState<Estado>("todos");
  const [acierto, setAcierto] = useState<Acierto>("todos");
  const [fase, setFase] = useState<Fase>("todas");
  const [orden, setOrden] = useState<Orden>("recientes");

  useEffect(() => {
    api
      .myMatches()
      .then((d) => {
        setMatches(d.matches);
        setRuleV2(d.drawRuleActive);
      })
      .catch((e) => setError(e.message));
  }, []);

  const filtered = useMemo(() => {
    if (!matches) return [];
    const nq = norm(q.trim());
    let list = matches.filter((m) => {
      const finished = m.finished && m.homeScore !== null && m.awayScore !== null;
      if (estado === "jugados" && !finished) return false;
      if (estado === "pendientes" && finished) return false;

      if (fase === "group" && m.stage !== "group") return false;
      if (fase === "elim" && m.stage === "group") return false;

      if (acierto !== "todos") {
        if (!finished) return false;
        const p = m.points ?? 0;
        if (acierto === "exacto" && p !== 5) return false;
        if (acierto === "parcial" && !(p === 3 || p === 4)) return false;
        if (acierto === "cero" && p !== 0) return false;
      }

      if (nq) {
        const home = norm(sideName(m.home, m.homeLabel));
        const away = norm(sideName(m.away, m.awayLabel));
        const real = finished ? `${m.homeScore}-${m.awayScore}` : "";
        const tu = `${m.pred.home}-${m.pred.away}`;
        if (![home, away, real, tu].some((s) => s.includes(nq))) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) =>
      orden === "recientes"
        ? b.kickoffAt.localeCompare(a.kickoffAt)
        : a.kickoffAt.localeCompare(b.kickoffAt)
    );
    return list;
  }, [matches, q, estado, acierto, fase, orden]);

  const stats = useMemo(() => {
    if (!matches) return { jugados: 0, puntos: 0, exactos: 0 };
    let jugados = 0,
      puntos = 0,
      exactos = 0;
    for (const m of matches) {
      if (m.finished && m.points !== null) {
        jugados++;
        puntos += m.points;
        if (m.points === 5) exactos++;
      }
    }
    return { jugados, puntos, exactos };
  }, [matches]);

  if (error) return <p className="err center">{error}</p>;
  if (!matches) return <p className="muted center">cargando tu historial…</p>;

  return (
    <div>
      <h2>Mis partidos</h2>
      <p className="muted small">
        {me?.apodo} · {matches.length} pronósticos · {stats.jugados} jugados ·{" "}
        <strong>{stats.puntos} pts</strong> · {stats.exactos} exactos
      </p>

      <div className="hist-filters">
        <input
          className="hist-search"
          placeholder="Buscar equipo o marcador…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={estado} onChange={(e) => setEstado(e.target.value as Estado)}>
          <option value="todos">Todos</option>
          <option value="jugados">Jugados</option>
          <option value="pendientes">Pendientes</option>
        </select>
        <select value={acierto} onChange={(e) => setAcierto(e.target.value as Acierto)}>
          <option value="todos">Cualquier acierto</option>
          <option value="exacto">Exactos (5)</option>
          <option value="parcial">Parciales (3-4)</option>
          <option value="cero">Sin puntos (0)</option>
        </select>
        <select value={fase} onChange={(e) => setFase(e.target.value as Fase)}>
          <option value="todas">Todas las fases</option>
          <option value="group">Grupos</option>
          <option value="elim">Eliminatorias</option>
        </select>
        <select value={orden} onChange={(e) => setOrden(e.target.value as Orden)}>
          <option value="recientes">Recientes primero</option>
          <option value="cronologico">Cronológico</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="muted center">No hay partidos con esos filtros.</p>
      ) : (
        <div className="hist-list">
          {filtered.map((m) => (
            <HistRow key={m.id} m={m} ruleV2={ruleV2} />
          ))}
        </div>
      )}
    </div>
  );
}

function HistRow({ m, ruleV2 }: { m: MyMatch; ruleV2: boolean }) {
  const finished = m.finished && m.homeScore !== null && m.awayScore !== null;
  const bd = finished
    ? scoreBreakdown(m.pred, { home: m.homeScore, away: m.awayScore }, ruleV2)
    : null;

  return (
    <div className={"hist-item" + (finished ? " played" : "")}>
      <div className="hist-top">
        <span className="hist-when">
          {formatDate(m.kickoffAt)} · {STAGE_LABEL[m.stage]}
          {m.grp ? ` ${m.grp}` : ""}
        </span>
        {finished && bd ? (
          <PointsBadge points={bd.points} rule={bd.rule} label={`${bd.points} pts`} />
        ) : (
          <span className="tag">pendiente</span>
        )}
      </div>

      <div className="hist-teams">
        <span className="hist-side">
          <Flag teamId={m.home?.id} emoji={m.home?.flag} size={18} />
          <span className="name">{sideName(m.home, m.homeLabel)}</span>
        </span>
        <span className="hist-score mono">
          {finished ? `${m.homeScore} - ${m.awayScore}` : "vs"}
        </span>
        <span className="hist-side away">
          <span className="name">{sideName(m.away, m.awayLabel)}</span>
          <Flag teamId={m.away?.id} emoji={m.away?.flag} size={18} />
        </span>
      </div>

      <div className="hist-pred muted small">
        Tu pronóstico: <strong>{m.pred.home} - {m.pred.away}</strong>
        {finished && bd && bd.points === 5 && " · ¡exacto! 🎯"}
      </div>
    </div>
  );
}
