// Minimal dependency-free SVG scatter plot for the simulated portfolios
// (volatility on x, expected return on y). No chart library needed — keeps
// this template lightweight. Reusable for other risk/return style strategies.
//
// Colors here are a dedicated chart palette, deliberately NOT tied to the
// app's UI theme (--color-brand/--color-accent/etc). Keeping charts visually
// distinct from chrome/buttons/panels makes plotted data easier to read at a
// glance and keeps them readable if the UI theme changes later.
const W = 560, H = 320, PAD = 44;

const CHART = {
  axis: "#8a93a6",
  point: "#3b7ddd",      // sampled-portfolio dots
  pointLow: "#5b6bd6",   // low-Sharpe end of the gradient
  pointHigh: "#e8a33d",  // high-Sharpe end of the gradient
  minVol: "#2ec4b6",     // lowest-volatility marker
  maxSharpe: "#e8543f",  // best-Sharpe marker
  bg: "#12141c",
  text: "#aab2c5",
};

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

function lerp(a, b, t) { return a + (b - a) * t; }
function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function sharpeColor(sharpe, lo, hi) {
  if (sharpe == null || !isFinite(sharpe) || hi === lo) return CHART.point;
  const t = Math.max(0, Math.min(1, (sharpe - lo) / (hi - lo)));
  const [r1, g1, b1] = hexToRgb(CHART.pointLow);
  const [r2, g2, b2] = hexToRgb(CHART.pointHigh);
  return `rgb(${lerp(r1, r2, t) | 0}, ${lerp(g1, g2, t) | 0}, ${lerp(b1, b2, t) | 0})`;
}

const pct = (v) => `${(v * 100).toFixed(1)}%`;

export default function FrontierChart({ frontier, minLabel = "min-vol", maxLabel = "max-Sharpe" }) {
  if (!frontier || !frontier.points || !frontier.points.length) return null;
  const { points, min_volatility: minVol, max_sharpe: maxSharpe, n_simulated } = frontier;
  const { sx, sy } = scaleFns(points, minVol, maxSharpe);
  const sharpes = points.map((p) => p.sharpe).filter((s) => s != null && isFinite(s));
  const sLo = sharpes.length ? Math.min(...sharpes) : 0;
  const sHi = sharpes.length ? Math.max(...sharpes) : 1;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="frontier-svg" role="img" aria-label="Simulated portfolios chart"
        style={{ background: CHART.bg }}>
        {/* axes */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={CHART.axis} />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke={CHART.axis} />
        <text x={W - PAD} y={H - PAD + 18} textAnchor="end" className="chart-label" fill={CHART.text}>volatility →</text>
        <text x={PAD} y={PAD - 12} textAnchor="start" className="chart-label" fill={CHART.text}>↑ expected return</text>

        {/* every sampled portfolio, colored by Sharpe ratio (low -> high) */}
        {points.map((p, i) => (
          <circle key={i} cx={sx(p.volatility)} cy={sy(p.return)} r="2.4"
            fill={sharpeColor(p.sharpe, sLo, sHi)} opacity="0.55" />
        ))}

        {/* lowest-volatility portfolio found */}
        <circle cx={sx(minVol.volatility)} cy={sy(minVol.return)} r="5.5"
          fill={CHART.bg} stroke={CHART.minVol} strokeWidth="2.5" />
        <text x={sx(minVol.volatility) + 8} y={sy(minVol.return) - 8} className="chart-label" fill={CHART.text}>
          {minLabel} ({pct(minVol.volatility)}, {pct(minVol.return)})
        </text>

        {/* best-Sharpe portfolio found */}
        <circle cx={sx(maxSharpe.volatility)} cy={sy(maxSharpe.return)} r="5.5"
          fill={CHART.bg} stroke={CHART.maxSharpe} strokeWidth="2.5" />
        <text x={sx(maxSharpe.volatility) + 8} y={sy(maxSharpe.return) + 16} className="chart-label" fill={CHART.text}>
          {maxLabel} ({pct(maxSharpe.volatility)}, {pct(maxSharpe.return)})
        </text>
      </svg>
      <p className="hint">Dot color: Sharpe ratio, indigo (low) to amber (high).</p>
      {n_simulated && <p className="hint">{n_simulated.toLocaleString()} portfolios simulated
        {points.length < n_simulated ? ` (showing a ${points.length.toLocaleString()}-point sample on the chart; the marked portfolios above are exact over all ${n_simulated.toLocaleString()})` : ""}.</p>}
    </div>
  );
}
