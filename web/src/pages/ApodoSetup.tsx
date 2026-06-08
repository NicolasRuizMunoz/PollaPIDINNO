import { useState } from "react";
import { api, type User } from "../api";

export function ApodoSetup({ onDone }: { onDone: (u: User) => void }) {
  const [apodo, setApodo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const u = await api.setApodo(apodo);
      onDone(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setSaving(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="cup big">✍️</div>
        <h1>Elige tu apodo</h1>
        <p className="muted">Así te verán los demás en la tabla de posiciones.</p>
        <form onSubmit={submit} className="devform">
          <input
            type="text"
            placeholder="Ej: El Crack, Nico10, La Roja…"
            value={apodo}
            maxLength={24}
            onChange={(e) => setApodo(e.target.value)}
            autoFocus
            required
          />
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "Guardando…" : "Confirmar apodo"}
          </button>
        </form>
        {error && <p className="err">{error}</p>}
      </div>
    </div>
  );
}
