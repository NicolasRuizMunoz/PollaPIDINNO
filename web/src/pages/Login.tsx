import { useEffect, useRef, useState } from "react";
import { api, type User } from "../api";

declare global {
  interface Window {
    google?: any;
  }
}

export function Login({
  onLogin,
}: {
  onLogin: (token: string, user: User, needsApodo: boolean) => void;
}) {
  const [clientId, setClientId] = useState<string | null>(null);
  const [devLogin, setDevLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const btnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .config()
      .then((c) => {
        setClientId(c.googleClientId);
        setDevLogin(c.devLogin);
      })
      .catch(() => setError("No se pudo contactar al servidor"))
      .finally(() => setLoading(false));
  }, []);

  // carga el script de Google y renderiza el boton cuando hay client id
  useEffect(() => {
    if (!clientId) return;
    const onReady = () => {
      window.google?.accounts.id.initialize({
        client_id: clientId,
        callback: async (resp: { credential: string }) => {
          try {
            const { token, user, needsApodo } = await api.loginGoogle(resp.credential);
            onLogin(token, user, needsApodo);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Error con Google");
          }
        },
      });
      if (btnRef.current) {
        window.google?.accounts.id.renderButton(btnRef.current, {
          theme: "filled_blue",
          size: "large",
          text: "continue_with",
          locale: "es",
        });
      }
    };

    if (window.google?.accounts?.id) {
      onReady();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = onReady;
    document.head.appendChild(script);
  }, [clientId]);

  async function devSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { token, user, needsApodo } = await api.loginDev(email);
      onLogin(token, user, needsApodo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al entrar");
    }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="cup big">🏆</div>
        <h1>Polla Mundial 2026</h1>
        <p className="muted">Copec · pronostica los partidos y compite con tus amigos</p>

        {loading && <p className="muted">cargando…</p>}

        {!loading && clientId && (
          <>
            <div ref={btnRef} className="gbtn" />
            <p className="muted small">Inicia sesión con tu cuenta de Google</p>
          </>
        )}

        {!loading && devLogin && (
          <form onSubmit={devSubmit} className="devform">
            <input
              type="email"
              placeholder="tu-email@correo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button type="submit" className="btn primary">Entrar</button>
          </form>
        )}

        {error && <p className="err">{error}</p>}
      </div>
    </div>
  );
}
