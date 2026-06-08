import { useState } from "react";

const FIFA_TO_ISO: Record<string, string> = {
  // Grupo A
  MEX: "mx", RSA: "za", KOR: "kr", CZE: "cz",
  // Grupo B
  CAN: "ca", BIH: "ba", QAT: "qa", SUI: "ch",
  // Grupo C
  BRA: "br", MAR: "ma", HAI: "ht", SCO: "gb-sct",
  // Grupo D
  USA: "us", PAR: "py", AUS: "au", TUR: "tr",
  // Grupo E
  GER: "de", CUW: "cw", CIV: "ci", ECU: "ec",
  // Grupo F
  NED: "nl", JPN: "jp", SWE: "se", TUN: "tn",
  // Grupo G
  BEL: "be", EGY: "eg", IRN: "ir", NZL: "nz",
  // Grupo H
  ESP: "es", CPV: "cv", KSA: "sa", URU: "uy",
  // Grupo I
  FRA: "fr", SEN: "sn", IRQ: "iq", NOR: "no",
  // Grupo J
  ARG: "ar", ALG: "dz", AUT: "at", JOR: "jo",
  // Grupo K
  POR: "pt", COD: "cd", UZB: "uz", COL: "co",
  // Grupo L
  ENG: "gb-eng", CRO: "hr", GHA: "gh", PAN: "pa",
};

export function flagUrl(teamId: string): string | null {
  const iso = FIFA_TO_ISO[teamId];
  return iso ? `https://flagcdn.com/h20/${iso}.png` : null;
}

export function Flag({
  teamId,
  emoji,
  size = 20,
}: {
  teamId?: string | null;
  emoji?: string | null;
  size?: number;
}) {
  const iso = teamId ? FIFA_TO_ISO[teamId] : null;
  const [failed, setFailed] = useState(false);

  if (iso && !failed) {
    return (
      <img
        src={`https://flagcdn.com/h${size}/${iso}.png`}
        srcSet={`https://flagcdn.com/h${size * 2}/${iso}.png 2x`}
        height={size}
        alt=""
        className="flag-img"
        onError={() => setFailed(true)}
      />
    );
  }
  return <span className="flag">{emoji ?? "🏳️"}</span>;
}
