import { useCallback, useEffect, useState } from "react";
import { api, type MatchesResponse } from "./api";

export function useMatches() {
  const [data, setData] = useState<MatchesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // `silent` evita el parpadeo de "cargando…" en recargas automáticas (polling)
  const reload = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    return api
      .matches()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // actualiza la prediccion en memoria sin recargar todo. `advances` undefined =
  // se conserva la elección previa de "quién pasa" (un guardado de marcador no la pisa).
  const onSaved = useCallback(
    (matchId: number, home: number, away: number, advances?: string | null) => {
      setData((prev) => {
        if (!prev) return prev;
        const existing = prev.myPredictions[matchId];
        const nextAdvances = advances !== undefined ? advances : existing?.advances ?? null;
        return {
          ...prev,
          myPredictions: {
            ...prev.myPredictions,
            [matchId]: { home, away, advances: nextAdvances },
          },
        };
      });
    },
    []
  );

  return { data, loading, error, reload, onSaved };
}
