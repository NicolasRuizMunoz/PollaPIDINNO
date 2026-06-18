import { useEffect, useState } from "react";
import { api, type TournamentInfo } from "../api";
import { formatDateTime } from "../util";

export function BonosReabiertosBanner({ onGoToBonos }: { onGoToBonos: () => void }) {
  const [info, setInfo] = useState<TournamentInfo | null>(null);

  useEffect(() => {
    api.tournament().then(setInfo).catch(() => setInfo(null));
  }, []);

  if (!info || info.locked) return null;

  return (
    <div className="bonos-reopen-banner">
      <span>
        🔓 <strong>¡Bonos re-habilitados!</strong> Puedes editarlos hasta{" "}
        <strong>{info.deadline ? formatDateTime(info.deadline) : "el inicio del torneo"}</strong>
        {" "}(antes de Brasil vs Haití).
      </span>
      <button className="btn primary small" onClick={onGoToBonos}>
        Ir a bonos →
      </button>
    </div>
  );
}
