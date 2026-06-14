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

  // actualiza la prediccion en memoria sin recargar todo
  const onSaved = useCallback((matchId: number, home: number, away: number) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            myPredictions: { ...prev.myPredictions, [matchId]: { home, away } },
          }
        : prev
    );
  }, []);

  return { data, loading, error, reload, onSaved };
}
