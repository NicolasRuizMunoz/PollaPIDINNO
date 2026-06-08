import { useEffect, useRef, useState } from "react";
import type { Team } from "../api";

/** Selector de equipo con búsqueda: escribes y filtra el listado. */
export function TeamSelect({
  teams,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  teams: Team[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const selected = teams.find((t) => t.id === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? teams.filter((t) => t.name.toLowerCase().includes(q))
    : teams;

  const display = selected ? `${selected.flag ?? ""} ${selected.name}` : "";

  return (
    <div className="combo" ref={ref}>
      <input
        type="text"
        disabled={disabled}
        placeholder={placeholder ?? "Buscar equipo…"}
        value={open ? query : display}
        onFocus={() => {
          if (disabled) return;
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
      />
      {open && !disabled && (
        <ul className="combo-list">
          <li
            className="muted"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            — ninguno —
          </li>
          {filtered.length === 0 && <li className="muted">sin resultados</li>}
          {filtered.map((t) => (
            <li
              key={t.id}
              className={t.id === value ? "sel" : ""}
              onClick={() => {
                onChange(t.id);
                setQuery("");
                setOpen(false);
              }}
            >
              <span className="flag">{t.flag}</span> {t.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
