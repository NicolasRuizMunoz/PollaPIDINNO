import { useEffect, useState } from "react";
import { api, type WrappedStats } from "../api";
import "./Wrapped.css";

interface WrappedProps {
  onNavigate?: (tab: string) => void;
}

export function Wrapped({ onNavigate }: WrappedProps = {}) {
  const [data, setData] = useState<WrappedStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.wrapped().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="wrapped-error">{error}</p>;
  if (!data) return <p className="wrapped-loading">Cargando tu wrapped…</p>;

  return (
    <div className="wrapped-container">
      <div className="wrapped-hero">
        <div className="wrapped-year">2026</div>
        <h1 className="wrapped-title">Mi Wrapped</h1>
        {onNavigate && (
          <button className="wrapped-evolution-link" onClick={() => onNavigate("evolucion")}>
            📊 Ver evolución
          </button>
        )}

        <div className="wrapped-position-card">
          <div className="position-rank">#{data.position}</div>
          <div className="position-text">
            <div className="position-label">Tu posición</div>
            <div className="position-score">{data.totalPoints}</div>
            <div className="position-label">puntos</div>
          </div>
        </div>
      </div>

      {data.awards.length > 0 && (
        <section className="wrapped-section">
          <h2 className="wrapped-section-title">Tus premios 🏆</h2>
          <div className="awards-grid">
            {data.awards.map((a) => (
              <div key={a.id} className="award-card">
                <div className="award-emoji">{a.emoji}</div>
                <div className="award-name">{a.name}</div>
                <div className="award-desc">{a.description}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.globalAwards.length > 0 && (
        <section className="wrapped-section">
          <h2 className="wrapped-section-title">Ranking General</h2>
          <div className="global-awards-grid">
            {data.globalAwards.map((award) => (
              <GlobalAwardCard key={award.id} award={award} />
            ))}
          </div>
        </section>
      )}

      <section className="wrapped-section">
        <h2 className="wrapped-section-title">Tus estadísticas</h2>
        <div className="stats-grid">
          <StatCard stat={data.bestDay} highlight />
          <StatCard stat={data.worstDay} />
          <StatCard stat={data.longestWinStreak} />
          <StatCard stat={data.longestLossStreak} />
          <StatCard stat={data.exactPercentage} highlight />
          {data.luckyTeam && <StatCard stat={data.luckyTeam} />}
          {data.cursedTeam && <StatCard stat={data.cursedTeam} />}
          <StatCard stat={data.draws} />
          <StatCard stat={data.favoriteScore} />
          {data.gloryMatch && <StatCard stat={data.gloryMatch} highlight />}
        </div>
      </section>
    </div>
  );
}

function GlobalAwardCard({ award }: { award: any }) {
  return (
    <div className="global-award-card">
      <div className="global-award-header">
        <h3 className="global-award-title">
          {award.emoji} {award.name}
        </h3>
        <p className="global-award-desc">{award.description}</p>
      </div>
      <table className="global-award-table">
        <tbody>
          {award.ranking.map((item: any) => (
            <tr key={`${item.position}-${item.apodo}`} className={item.isMe ? "is-me" : ""}>
              <td className="rank-pos">#{item.position}</td>
              <td className="rank-apodo">{item.apodo}</td>
              <td className="rank-value">{item.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({ stat, highlight }: { stat: any; highlight?: boolean }) {
  return (
    <div className={`stat-card ${highlight ? "stat-card--highlight" : ""}`}>
      <div className="stat-card-content">
        <div className="stat-card-name">{stat.name}</div>
        <div className="stat-card-value">{stat.description || formatShortValue(stat.value)}</div>
      </div>
    </div>
  );
}

function formatShortValue(v: any): string {
  if (typeof v === "object") {
    if (v.count !== undefined && v.score !== undefined) return `${v.score} (${v.count}x)`;
    if (v.count !== undefined) return `${v.count}`;
    if (v.percentage !== undefined) return `${v.percentage}%`;
    if (v.points !== undefined) return `${v.points} pts`;
    if (v.name !== undefined) return v.name;
    return "N/A";
  }
  return String(v);
}
