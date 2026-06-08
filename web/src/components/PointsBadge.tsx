import { useEffect, useRef, useState } from "react";

/**
 * Muestra un puntaje. Al pasar el mouse (desktop) o al tocar/clickear
 * (móvil y desktop) despliega el desglose: qué regla dio cuántos puntos.
 */
export function PointsBadge({
  points,
  rule,
  label,
}: {
  points: number;
  rule: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <span className="pointsbadge" ref={ref}>
      <button
        type="button"
        className={`pts tip ${points > 0 ? "pos" : "zero"}`}
        title={rule}
        onClick={() => setOpen((v) => !v)}
      >
        {label ?? `+${points}`}
      </button>
      {open && (
        <span className="pts-pop" role="tooltip">
          {rule}
        </span>
      )}
    </span>
  );
}
