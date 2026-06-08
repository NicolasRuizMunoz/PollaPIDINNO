import { useEffect, useMemo, useState } from "react";
import { api, type Match, type Team } from "../api";
import { sideName } from "../util";
import { TeamSelect } from "../components/TeamSelect";

export function Admin() {
  const [sub, setSub] = useState<"resultados" | "torneo" | "usuarios">("resultados");
  return (
    <div>
      <h2>Administración</h2>
      <div className="subnav">
        <button className={sub === "resultados" ? "active" : ""} onClick={() => setSub("resultados")}>
          Resultados y fixture
        </button>
        <button className={sub === "torneo" ? "active" : ""} onClick={() => setSub("torneo")}>
          Bonos y ajustes
        </button>
        <button className={sub === "usuarios" ? "active" : ""} onClick={() => setSub("usuarios")}>
          Usuarios
        </button>
      </div>
      {sub === "resultados" && <AdminResults />}
      {sub === "torneo" && <AdminTournament />}
      {sub === "usuarios" && <AdminUsers />}
    </div>
  );
}

// ----------------------------------------------------------------- resultados

type KoFilter = 'r32' | 'r16' | 'qf' | 'sf' | 'endgame';

const KO_ADMIN: { key: KoFilter; label: string }[] = [
  { key: 'r32',     label: '16avos' },
  { key: 'r16',     label: 'Octavos' },
  { key: 'qf',      label: 'Cuartos' },
  { key: 'sf',      label: 'Semis' },
  { key: 'endgame', label: '3º / Final' },
];

function AdminResults() {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [sel, setSel] = useState<string>("A");
  const [koStage, setKoStage] = useState<KoFilter>("r32");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api.matches().then((d) => setMatches(d.matches)).catch((e) => setError(e.message));
  }
  useEffect(() => {
    reload();
    api.teams().then(setTeams).catch((e) => setError(e.message));
  }, []);

  const groups = useMemo(() => {
    if (!matches) return [];
    const set = new Set<string>();
    matches.forEach((m) => m.grp && set.add(m.grp));
    return [...set].sort();
  }, [matches]);

  if (error) return <p className="err center">{error}</p>;
  if (!matches) return <p className="muted center">cargando…</p>;

  async function recalcular() {
    setMsg(null);
    try {
      const { assigned } = await api.adminRecalcular();
      setMsg(`Cuadro recalculado (${assigned} cupos asignados).`);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  const koStages = koStage === "endgame" ? ["third", "final"] : [koStage];

  const list =
    sel === "elim"
      ? matches
          .filter((m) => koStages.includes(m.stage))
          .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt))
      : matches
          .filter((m) => m.stage === "group" && m.grp === sel)
          .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt));

  return (
    <div>
      <div className="admin-toolbar">
        <div className="subnav">
          {groups.map((g) => (
            <button key={g} className={sel === g ? "active" : ""} onClick={() => setSel(g)}>
              {g}
            </button>
          ))}
          <button className={sel === "elim" ? "active" : ""} onClick={() => setSel("elim")}>
            Eliminatorias
          </button>
        </div>
        <button className="btn" onClick={recalcular} title="Vuelve a armar las llaves desde los resultados">
          ↻ Recalcular cuadro
        </button>
      </div>
      {msg && <p className="hint ok">{msg}</p>}

      {sel === "elim" && (
        <>
          <div className="subnav">
            {KO_ADMIN.map(({ key, label }) => (
              <button key={key} className={koStage === key ? "active" : ""} onClick={() => setKoStage(key)}>
                {label}
              </button>
            ))}
          </div>
          <p className="muted small">
            Los equipos se completan solos al publicar resultados. Si necesitas corregir, puedes
            fijar los equipos a mano o usar "Recalcular cuadro".
          </p>
        </>
      )}

      {list.map((m) => (
        <AdminMatchRow key={m.id} match={m} teams={teams} onChanged={reload} />
      ))}
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function AdminMatchRow({
  match,
  teams,
  onChanged,
}: {
  match: Match;
  teams: Team[];
  onChanged: () => void;
}) {
  const isKnockout = match.stage !== "group";
  const [home, setHome] = useState(match.homeScore?.toString() ?? "");
  const [away, setAway] = useState(match.awayScore?.toString() ?? "");
  const [kickoff, setKickoff] = useState(toLocalInput(match.kickoffAt));
  const [homeTeam, setHomeTeam] = useState(match.home?.id ?? "");
  const [awayTeam, setAwayTeam] = useState(match.away?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(publish: boolean) {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const hs = home === "" ? null : Number(home);
      const as = away === "" ? null : Number(away);
      await api.adminUpdateMatch(match.id, {
        kickoffAt: new Date(kickoff).toISOString(),
        ...(isKnockout ? { homeTeam: homeTeam || null, awayTeam: awayTeam || null } : {}),
        homeScore: hs,
        awayScore: as,
        finished: publish ? hs !== null && as !== null : match.finished,
      });
      setSaved(true);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`admin-match ${match.finished ? "finished" : ""}`}>
      <div className="admin-match-head">
        <span className="muted small">{match.label}</span>
        {match.finished && <span className="tag tag-done">publicado</span>}
      </div>

      <div className="admin-match-body">
        {isKnockout ? (
          <select value={homeTeam} onChange={(e) => setHomeTeam(e.target.value)} className="team-select">
            <option value="">{match.homeLabel ?? "Local"}</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.flag} {t.name}</option>
            ))}
          </select>
        ) : (
          <span className="team-name">{sideName(match.home, match.homeLabel)}</span>
        )}

        <input className="sc" type="number" min={0} value={home} onChange={(e) => setHome(e.target.value)} />
        <span className="vs">-</span>
        <input className="sc" type="number" min={0} value={away} onChange={(e) => setAway(e.target.value)} />

        {isKnockout ? (
          <select value={awayTeam} onChange={(e) => setAwayTeam(e.target.value)} className="team-select">
            <option value="">{match.awayLabel ?? "Visita"}</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.flag} {t.name}</option>
            ))}
          </select>
        ) : (
          <span className="team-name">{sideName(match.away, match.awayLabel)}</span>
        )}
      </div>

      <div className="admin-match-foot">
        <label className="kickoff">
          🕒
          <input type="datetime-local" value={kickoff} onChange={(e) => setKickoff(e.target.value)} />
        </label>
        <button className="btn" disabled={busy} onClick={() => save(false)}>Guardar</button>
        <button className="btn primary" disabled={busy} onClick={() => save(true)}>
          Publicar resultado
        </button>
        {saved && <span className="hint ok">✓</span>}
        {err && <span className="hint err">{err}</span>}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- torneo

function AdminTournament() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [champion, setChampion] = useState("");
  const [runnerUp, setRunnerUp] = useState("");
  const [topScorer, setTopScorer] = useState("");
  const [bestGoalkeeper, setBestGoalkeeper] = useState("");
  const [deadline, setDeadline] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.teams().then(setTeams).catch((e) => setError(e.message));
    api.tournament().then((i) => {
      if (i.results) {
        setChampion(i.results.champion ?? "");
        setRunnerUp(i.results.runnerUp ?? "");
        setTopScorer(i.results.topScorer ?? "");
        setBestGoalkeeper(i.results.bestGoalkeeper ?? "");
      }
      if (i.deadline) setDeadline(toLocalInput(i.deadline));
    });
  }, []);

  async function saveResults(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    try {
      await api.adminTournamentResults({
        champion: champion || null,
        runnerUp: runnerUp || null,
        topScorer: topScorer || null,
        bestGoalkeeper: bestGoalkeeper || null,
      });
      setMsg("Resultados de bonos guardados ✓ (los puntos se reparten al instante)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  async function saveDeadline() {
    setMsg(null);
    try {
      await api.adminSettings({
        bonosDeadline: deadline ? new Date(deadline).toISOString() : null,
      });
      setMsg("Fecha de cierre de bonos actualizada ✓");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  return (
    <div>
      <h3>Resultados de los bonos</h3>
      <p className="muted small">Define al campeón, subcampeón, goleador y mejor arquero reales.</p>
      <form onSubmit={saveResults} className="bonos">
        <label>
          🏆 Campeón <span className="muted small">(15 pts)</span>
          <TeamSelect teams={teams} value={champion} onChange={setChampion} />
        </label>
        <label>
          🥈 Subcampeón <span className="muted small">(10 pts)</span>
          <TeamSelect teams={teams} value={runnerUp} onChange={setRunnerUp} />
        </label>
        <label>
          ⚽ Goleador
          <input type="text" value={topScorer} onChange={(e) => setTopScorer(e.target.value)} />
        </label>
        <label>
          🧤 Mejor arquero
          <input type="text" value={bestGoalkeeper} onChange={(e) => setBestGoalkeeper(e.target.value)} />
        </label>
        <button type="submit" className="btn primary">Guardar resultados</button>
      </form>

      <h3 style={{ marginTop: 24 }}>Cierre de bonos</h3>
      <p className="muted small">
        Por defecto cierran cuando se juega el último partido de la primera fecha de grupos.
        Puedes ajustarlo aquí.
      </p>
      <div className="row">
        <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        <button className="btn" onClick={saveDeadline}>Guardar fecha</button>
      </div>

      {msg && <p className="hint ok">{msg}</p>}
      {error && <p className="err">{error}</p>}
    </div>
  );
}

// ----------------------------------------------------------------- usuarios

type AdminUser = {
  id: number;
  email: string;
  apodo: string;
  is_admin: number;
  is_active: number;
  created_at: string;
};

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  return `${email[0]}***${email.slice(at)}`;
}

function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);

  function reload() {
    api.adminUsers().then(setUsers).catch((e: Error) => setError(e.message));
  }

  useEffect(() => { reload(); }, []);

  async function downloadBackup() {
    setDownloading(true);
    try {
      const blob = await api.adminBackup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `polla-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al descargar backup");
    } finally {
      setDownloading(false);
    }
  }

  async function toggleActive(u: AdminUser) {
    setBusy(u.id);
    try {
      await api.adminSetUserActive(u.id, u.is_active === 0);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="err center">{error}</p>;
  if (!users) return <p className="muted center">cargando...</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <p className="muted small" style={{ margin: 0 }}>
          Los usuarios <strong>inactivos</strong> no aparecen en la tabla de posiciones ni se les cuenta puntaje.
          Activa una cuenta cuando confirmes el pago.
        </p>
        <button className="btn" onClick={downloadBackup} disabled={downloading}>
          {downloading ? "Descargando…" : "⬇ Descargar backup"}
        </button>
      </div>
      <table className="leaderboard">
        <thead>
          <tr>
            <th>Jugador</th>
            <th>Email</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.5 }}>
              <td>{u.apodo || <span className="muted">{maskEmail(u.email)}</span>}</td>
              <td className="muted small">{u.email}</td>
              <td>
                {u.is_active ? (
                  <span className="tag tag-done">activo</span>
                ) : (
                  <span className="tag">inactivo</span>
                )}
                {!!u.is_admin && <span className="tag" style={{ marginLeft: 4 }}>admin</span>}
              </td>
              <td>
                <button
                  className={`btn${u.is_active ? "" : " primary"}`}
                  disabled={busy === u.id}
                  onClick={() => toggleActive(u)}
                >
                  {u.is_active ? "Desactivar" : "Activar"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
