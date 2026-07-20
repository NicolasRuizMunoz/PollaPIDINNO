import { useEffect, useState, useMemo } from "react";
import {
  api,
  getUser,
  type LeaderboardTimelineData,
  type TimelinePrediction,
} from "../api";
import { scoreMatch } from "../scoring";

interface TimelineRow {
  userId: number;
  apodo: string;
  puntaje: number;
  exactos: number;
  jugados: number;
  promedio: number;
  tasa: number;
}

function calculateLeaderboardAtTime(
  data: LeaderboardTimelineData,
  referenceTimestamp: string,
  selectedGroups: Set<string>,
  selectedTeams: Set<string>
): TimelineRow[] {
  const cutoffTime = new Date(referenceTimestamp).getTime();
  const relevantMatches = data.matches.filter((m) => {
    const matchTime = new Date(m.kickoffAt).getTime();
    return matchTime <= cutoffTime && m.finished;
  });

  const matchIdsByFilter = new Set<number>();
  for (const match of relevantMatches) {
    const homeInGroup = selectedGroups.has(match.grp || "");
    const homeInTeam = selectedTeams.has(match.homeTeam || "");
    const awayInTeam = selectedTeams.has(match.awayTeam || "");

    if (selectedGroups.size > 0 && selectedTeams.size === 0) {
      if (homeInGroup) matchIdsByFilter.add(match.id);
    } else if (selectedTeams.size > 0 && selectedGroups.size === 0) {
      if (homeInTeam || awayInTeam) matchIdsByFilter.add(match.id);
    } else {
      if (homeInGroup || homeInTeam || awayInTeam) matchIdsByFilter.add(match.id);
    }
  }

  const matchById = new Map(relevantMatches.map((m) => [m.id, m]));
  const predsByUser = new Map<number, TimelinePrediction[]>();
  for (const pred of data.predictions) {
    if (matchIdsByFilter.has(pred.matchId)) {
      if (!predsByUser.has(pred.userId)) predsByUser.set(pred.userId, []);
      predsByUser.get(pred.userId)!.push(pred);
    }
  }

  const rows: TimelineRow[] = data.users.map((user) => {
    const userPreds = predsByUser.get(user.id) ?? [];
    let puntaje = 0;
    let exactos = 0;

    for (const pred of userPreds) {
      const match = matchById.get(pred.matchId);
      if (!match || match.homeScore === null || match.awayScore === null) continue;

      const pts = scoreMatch(
        { home: pred.homeScore, away: pred.awayScore },
        { home: match.homeScore, away: match.awayScore }
      );
      puntaje += pts;
      if (pts === 5) exactos++;
    }

    const jugados = userPreds.length;
    const promedio = jugados > 0 ? +(puntaje / jugados).toFixed(2) : 0;
    const tasa = jugados > 0 ? +(exactos / jugados).toFixed(3) : 0;

    return {
      userId: user.id,
      apodo: user.apodo,
      puntaje,
      exactos,
      jugados,
      promedio,
      tasa,
    };
  });

  rows.sort((a, b) => b.puntaje - a.puntaje || a.apodo.localeCompare(b.apodo));
  return rows;
}

export function LeaderboardTimeline() {
  const me = getUser();
  const [data, setData] = useState<LeaderboardTimelineData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"accumulated" | "day">("accumulated");
  const [rangeMode, setRangeMode] = useState(false);

  const [currentDate, setCurrentDate] = useState<string>("");
  const [rangeStart, setRangeStart] = useState<string>("");
  const [rangeEnd, setRangeEnd] = useState<string>("");

  const [highlighted, setHighlighted] = useState<Set<number>>(new Set(me ? [me.id] : []));
  const [showHighlightModal, setShowHighlightModal] = useState(false);
  const [showGroupsDropdown, setShowGroupsDropdown] = useState(false);
  const [showTeamsDropdown, setShowTeamsDropdown] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    api
      .leaderboardTimeline()
      .then((d) => {
        setData(d);
        if (d.matches.length > 0) {
          const firstMatch = d.matches[0];
          const lastMatch = d.matches[d.matches.length - 1];
          setCurrentDate(firstMatch.kickoffAt);
          setRangeStart(firstMatch.kickoffAt);
          setRangeEnd(lastMatch.kickoffAt);

          // Inicializar filtros con todas las selecciones
          const allGroups = Array.from(new Set(d.matches.map((m) => m.grp).filter(Boolean))) as string[];
          const allTeams = new Set<string>();
          for (const match of d.matches) {
            if (match.homeTeam) allTeams.add(match.homeTeam);
            if (match.awayTeam) allTeams.add(match.awayTeam);
          }
          setSelectedGroups(new Set(allGroups));
          setSelectedTeams(allTeams);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.matches.map((m) => m.grp).filter(Boolean))) as string[];
  }, [data]);

  const teams = useMemo(() => {
    if (!data) return [];
    const teamSet = new Set<string>();
    for (const match of data.matches) {
      if (match.homeTeam) teamSet.add(match.homeTeam);
      if (match.awayTeam) teamSet.add(match.awayTeam);
    }
    return Array.from(teamSet).sort();
  }, [data]);

  const visibleRows = useMemo(() => {
    if (!data) return [];

    const referenceTime = rangeMode ? rangeEnd : currentDate;
    let rows = calculateLeaderboardAtTime(data, referenceTime, selectedGroups, selectedTeams);

    if (mode === "day" && !rangeMode) {
      // Filtrar solo partidos de ese día
      const dayStart = new Date(currentDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(currentDate);
      dayEnd.setHours(23, 59, 59, 999);

      const dayMatches = data.matches.filter(
        (m) =>
          m.finished &&
          new Date(m.kickoffAt).getTime() >= dayStart.getTime() &&
          new Date(m.kickoffAt).getTime() <= dayEnd.getTime()
      );

      const matchIdsByFilter = new Set<number>();
      for (const match of dayMatches) {
        const homeInGroup = selectedGroups.has(match.grp || "");
        const homeInTeam = selectedTeams.has(match.homeTeam || "");
        const awayInTeam = selectedTeams.has(match.awayTeam || "");

        if (selectedGroups.size === 0 && selectedTeams.size === 0) {
          matchIdsByFilter.add(match.id);
        } else if (selectedGroups.size > 0 && selectedTeams.size === 0) {
          if (homeInGroup) matchIdsByFilter.add(match.id);
        } else if (selectedTeams.size > 0 && selectedGroups.size === 0) {
          if (homeInTeam || awayInTeam) matchIdsByFilter.add(match.id);
        } else {
          if (homeInGroup || homeInTeam || awayInTeam) matchIdsByFilter.add(match.id);
        }
      }

      const matchById = new Map(dayMatches.map((m) => [m.id, m]));
      rows = data.users
        .map((user) => {
          const userPreds = data.predictions.filter(
            (p) => p.userId === user.id && matchIdsByFilter.has(p.matchId)
          );
          let puntaje = 0;
          let exactos = 0;

          for (const pred of userPreds) {
            const match = matchById.get(pred.matchId);
            if (!match || match.homeScore === null || match.awayScore === null) continue;

            const pts = scoreMatch(
              { home: pred.homeScore, away: pred.awayScore },
              { home: match.homeScore, away: match.awayScore }
            );
            puntaje += pts;
            if (pts === 5) exactos++;
          }

          const jugados = userPreds.length;
          const promedio = jugados > 0 ? +(puntaje / jugados).toFixed(2) : 0;
          const tasa = jugados > 0 ? +(exactos / jugados).toFixed(3) : 0;

          return {
            userId: user.id,
            apodo: user.apodo,
            puntaje,
            exactos,
            jugados,
            promedio,
            tasa,
          };
        })
        .sort((a, b) => b.puntaje - a.puntaje || a.apodo.localeCompare(b.apodo));
    }

    return rows;
  }, [data, currentDate, selectedGroups, selectedTeams, mode, rangeMode, rangeEnd]);

  const getHighlightColor = (userId: number): string | null => {
    if (!highlighted.has(userId)) return null;
    const colors = [
      "#FFB6C1",
      "#87CEEB",
      "#98FB98",
      "#FFD700",
      "#FFB347",
      "#DDA0DD",
      "#F0E68C",
      "#FFB0FF",
    ];
    const index = Array.from(highlighted).indexOf(userId);
    return colors[index % colors.length];
  };

  const filteredUsers = data?.users.filter((u) =>
    u.apodo.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const currentMatchIndex = data
    ? data.matches.findIndex((m) => m.kickoffAt.startsWith(currentDate.split("T")[0]))
    : 0;
  const finishedCount = data
    ? data.matches.filter((m) => m.finished && m.kickoffAt <= currentDate).length
    : 0;

  if (error) return <p className="err center">{error}</p>;
  if (loading || !data) return <p className="muted center">cargando timeline…</p>;

  return (
    <div className="timeline-container">
      <div className="timeline-mode">
        <div className="mode-toggle">
          <button
            className={mode === "accumulated" ? "active" : ""}
            onClick={() => setMode("accumulated")}
          >
            Acumulado
          </button>
          <button
            className={mode === "day" ? "active" : ""}
            onClick={() => setMode("day")}
          >
            Este día
          </button>
        </div>
        {mode === "accumulated" && (
          <label className="range-toggle">
            <input
              type="checkbox"
              checked={rangeMode}
              onChange={(e) => setRangeMode(e.target.checked)}
            />
            Rango
          </label>
        )}
      </div>

      <div className="timeline-slider-section">
        {rangeMode ? (
          <div className="range-inputs">
            <label>
              Desde:
              <input
                type="date"
                value={rangeStart.split("T")[0]}
                onChange={(e) => setRangeStart(e.target.value + "T00:00:00Z")}
              />
            </label>
            <label>
              Hasta:
              <input
                type="date"
                value={rangeEnd.split("T")[0]}
                onChange={(e) => setRangeEnd(e.target.value + "T23:59:59Z")}
              />
            </label>
          </div>
        ) : (
          <div className="slider-wrapper">
            <div className="slider-progress">
              <div className="progress-bar" style={{ width: `${(currentMatchIndex / (data.matches.length - 1)) * 100}%` }}></div>
            </div>
            <input
              type="range"
              min="0"
              max={data.matches.length - 1}
              value={currentMatchIndex}
              onChange={(e) => {
                const idx = Number(e.target.value);
                setCurrentDate(data.matches[idx].kickoffAt);
              }}
            />
            <div className="timeline-labels">
              <span className="date-label">{currentDate.split("T")[0]}</span>
              <span className="progress-label">{finishedCount} / {data.matches.length}</span>
            </div>
          </div>
        )}
      </div>

      <div className="timeline-filters">
        <div className="filter-button-group">
          <button
            className={`filter-btn ${selectedGroups.size === groups.length ? "all-selected" : "partial"}`}
            onClick={() => setShowGroupsDropdown(!showGroupsDropdown)}
          >
            📊 Grupos ({selectedGroups.size})
          </button>
          {showGroupsDropdown && (
            <div className="filter-dropdown">
              <button
                className="reset-btn"
                onClick={() => setSelectedGroups(new Set(groups))}
              >
                Seleccionar todos
              </button>
              {groups.map((g) => (
                <label key={g}>
                  <input
                    type="checkbox"
                    checked={selectedGroups.has(g)}
                    onChange={(e) => {
                      const newGroups = new Set(selectedGroups);
                      if (e.target.checked) newGroups.add(g);
                      else newGroups.delete(g);
                      setSelectedGroups(newGroups);
                    }}
                  />
                  Grupo {g}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="filter-button-group">
          <button
            className={`filter-btn ${selectedTeams.size === teams.length ? "all-selected" : "partial"}`}
            onClick={() => setShowTeamsDropdown(!showTeamsDropdown)}
          >
            🏳️ Países ({selectedTeams.size})
          </button>
          {showTeamsDropdown && (
            <div className="filter-dropdown countries">
              <button
                className="reset-btn"
                onClick={() => setSelectedTeams(new Set(teams))}
              >
                Seleccionar todos
              </button>
              {teams.map((team) => (
                <label key={team}>
                  <input
                    type="checkbox"
                    checked={selectedTeams.has(team)}
                    onChange={(e) => {
                      const newTeams = new Set(selectedTeams);
                      if (e.target.checked) newTeams.add(team);
                      else newTeams.delete(team);
                      setSelectedTeams(newTeams);
                    }}
                  />
                  {team}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="filter-button-group">
          <button
            className="filter-btn highlight-btn"
            onClick={() => setShowHighlightModal(!showHighlightModal)}
          >
            👁️ Destacados ({highlighted.size})
          </button>
          {showHighlightModal && (
            <div className="filter-dropdown highlight">
              <input
                type="text"
                placeholder="Buscar…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoFocus
              />
              {filteredUsers?.map((u) => (
                <label key={u.id}>
                  <input
                    type="checkbox"
                    checked={highlighted.has(u.id)}
                    onChange={(e) => {
                      const newHighlighted = new Set(highlighted);
                      if (e.target.checked) newHighlighted.add(u.id);
                      else newHighlighted.delete(u.id);
                      setHighlighted(newHighlighted);
                    }}
                  />
                  {u.apodo}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <table className="leaderboard timeline">
        <thead>
          <tr>
            <th>#</th>
            <th>Jugador</th>
            <th>Puntaje</th>
            {!isMobile && (
              <>
                <th>Exactos</th>
                <th>Jugados</th>
                <th>Promedio</th>
                <th>Tasa</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, i) => {
            const bgColor = getHighlightColor(row.userId);
            return (
              <tr key={row.userId} className={me?.id === row.userId ? "me" : ""} style={{ backgroundColor: bgColor || undefined }}>
                <td className="rank">{medal(i)}</td>
                <td>{row.apodo}</td>
                <td className="mono">{row.puntaje}</td>
                {!isMobile && (
                  <>
                    <td className="mono">{row.exactos}</td>
                    <td className="mono">{row.jugados}</td>
                    <td className="mono">{row.promedio}</td>
                    <td className="mono">{(row.tasa * 100).toFixed(1)}%</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function medal(i: number): string {
  return ["🥇", "🥈", "🥉"][i] ?? String(i + 1);
}
