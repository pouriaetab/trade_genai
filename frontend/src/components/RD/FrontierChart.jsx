// Minimal dependency-free SVG scatter plot for the simulated portfolios
// (volatility on x, expected return on y). No chart library needed — keeps
// this template lightweight. Reusable for other risk/return style strategies.
const W = 560, H = 320, PAD = 44;

function scaleFns(points, minVol, maxSharpePoint) {
  const xs = points.map((p) => p.volatility).concat([minVol.volatility, maxSharpePoint.volatility]);
  const ys = points.map((p) => p.return).concat([minVol.return, maxSharpePoint.return]);
  const xMin = 0, xMax = Math.max(...xs) * 1.08 || 1;
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const ySpan = (yMax - yMin) || 1;
  const yLo = yMin - ySpan * 0.1, yHi = yMax + ySpan * 0.1;
  const sx = (v) => PAD + (v - xMin) / (xMax - xMin || 1) * (W - 2 * PAD);
  const sy = (v) => H - PAD - (v - yLo) / (yHi - yLo || 1) * (H - 2 * PAD);
  return { sx, sy };
}

const pct = (v) => `${(v * 100).toFixed(1)}%`;

export default function FrontierChart({ frontier, minLabel = "min-vol", maxLabel = "max-Sharpe" }) {
  if (!frontier || !frontier.points || !frontier.points.length) return null;
  const { points, min_volatility: minVol, max_sharpe: maxSharpe, n_simulated } = frontier;
  const { sx, sy } = scaleFns(points, minVol, maxSharpe);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="frontier-svg" role="img" aria-label="Simulated portfolios chart">
        {/* axes */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--color-border-strong)" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--color-border-strong)" />
        <text x={W - PAD} y={H - PAD + 18} textAnchor="end" className="chart-label">volatility →</text>
        <text x={PAD} y={PAD - 12} textAnchor="start" className="chart-label">↑ expected return</text>

        {/* every sampled portfolio */}
        {points.map((p, i) => (
          <circle key={i} cx={sx(p.volatility)} cy={sy(p.return)} r="2.2"
            fill="var(--color-brand)" opacity="0.35" />
        ))}

        {/* lowest-volatility portfolio found */}
        <circle cx={sx(minVol.volatility)} cy={sy(minVol.return)} r="5.5"
          fill="var(--color-surface)" stroke="var(--color-accent)" strokeWidth="2" />
        <text x={sx(minVol.volatility) + 8} y={sy(minVol.return) - 8} className="chart-label">
          {minLabel} ({pct(minVol.volatility)}, {pct(minVol.return)})
        </text>

        {/* best-Sharpe portfolio found */}
        <circle cx={sx(maxSharpe.volatility)} cy={sy(maxSharpe.return)} r="5.5"
          fill="var(--color-surface)" stroke="var(--color-warning)" strokeWidth="2" />
        <text x={sx(maxSharpe.volatility) + 8} y={sy(maxSharpe.return) + 16} className="chart-label">
          {maxLabel} ({pct(maxSharpe.volatility)}, {pct(maxSharpe.return)})
        </text>
      </svg>
      {n_simulated && <p className="hint">{n_simulated.toLocaleString()} portfolios simulated
        {points.length < n_simulated ? ` (showing a ${points.length.toLocaleString()}-point sample on the chart; the marked portfolios above are exact over all ${n_simulated.toLocaleString()})` : ""}.</p>}
    </div>
  );
}
