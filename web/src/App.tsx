import { useEffect, useState } from "react";
import {
  api,
  clearSession,
  getToken,
  getUser,
  setSession,
  type User,
} from "./api";
import { Login } from "./pages/Login";
import { ApodoSetup } from "./pages/ApodoSetup";
import { Hoy } from "./pages/Hoy";
import { Fixture } from "./pages/Fixture";
import { Standings } from "./pages/Standings";
import { Leaderboard } from "./pages/Leaderboard";
import { MisPartidos } from "./pages/MisPartidos";
import { Bonos } from "./pages/Bonos";
import { Admin } from "./pages/Admin";

type Tab = "hoy" | "partidos" | "bonos" | "posiciones" | "tabla" | "mis" | "admin";

const TABS: { id: Tab; label: string; adminOnly?: boolean }[] = [
  { id: "hoy", label: "Hoy" },
  { id: "partidos", label: "Partidos" },
  { id: "bonos", label: "Bonos" },
  { id: "posiciones", label: "Posiciones" },
  { id: "tabla", label: "Tabla" },
  { id: "mis", label: "Mis partidos" },
  { id: "admin", label: "Admin", adminOnly: true },
];

export function App() {
  const [user, setUser] = useState<User | null>(getUser());
  const [needsApodo, setNeedsApodo] = useState(false);
  const [tab, setTab] = useState<Tab>("hoy");
  const [loading, setLoading] = useState(true);

  // valida el token guardado al cargar
  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((u) => {
        setUser(u);
        setNeedsApodo(u.needsApodo);
        localStorage.setItem("polla_user", JSON.stringify(u));
      })
      .catch(() => {
        clearSession();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  function handleLogin(token: string, u: User, na: boolean) {
    setSession(token, u);
    setUser(u);
    setNeedsApodo(na);
  }

  function logout() {
    clearSession();
    setUser(null);
  }

  if (loading) {
    return <div className="center muted">Cargando…</div>;
  }

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  if (needsApodo) {
    return (
      <ApodoSetup
        onDone={(u) => {
          setUser(u);
          setNeedsApodo(false);
          localStorage.setItem("polla_user", JSON.stringify(u));
        }}
      />
    );
  }

  const visibleTabs = TABS.filter((t) => !t.adminOnly || user.isAdmin);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="cup">🏆</span>
          <div>
            <div className="title">Polla Mundial 2026</div>
            <div className="subtitle">Copec</div>
          </div>
        </div>
        <div className="user">
          <span className="who">{user.apodo}</span>
          {user.isAdmin && <span className="badge">admin</span>}
          <button className="link" onClick={logout}>salir</button>
        </div>
      </header>

      <nav className="tabs">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="content">
        {tab === "hoy" && <Hoy onGoToBonos={() => setTab("bonos")} />}
        {tab === "partidos" && <Fixture />}
        {tab === "bonos" && <Bonos />}
        {tab === "posiciones" && <Standings />}
        {tab === "tabla" && <Leaderboard />}
        {tab === "mis" && <MisPartidos />}
        {tab === "admin" && user.isAdmin && <Admin />}
      </main>

      <footer className="foot muted">
        Puntaje: exacto = 5 · ganador = 3 (+1 si aciertas la diferencia) · campeón = 15 · resto de bonos = 10
      </footer>
    </div>
  );
}
