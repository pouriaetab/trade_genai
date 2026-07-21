import { useState } from "react";

// Minimal dependency-free SVG scatter plot for the simulated portfolios
// (volatility on x, expected return on y). No chart library needed — keeps
// this template lightweight. Reusable for other risk/return style strategies.
//
// Colors here are a dedicated chart palette, deliberately NOT tied to the
// app's UI theme (--color-brand/--color-accent/etc) — a light background and
// a colorful categorical palette, matching the look of the matplotlib charts
// rendered in Notebook/Lab cells, so R&D charts feel like the same family
// rather than a separate dark-mode-only style.
const W = 560, H = 320, PAD = 44;

const CHART = {
  bg: "#ffffff",
  grid: "#e6e8ee",
  axis: "#6b7280",
  text: "#4b5563",
  pointLow: "#4c72b0",   // matplotlib "tab10"-ish blue — low-Sharpe end
  pointHigh: "#dd8452",  // amber/orange — high-Sharpe end
  minVol: "#55a868",     // green marker
  maxSharpe: "#c44e52",  // red marker
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
  return { sx, sy, xMax, yLo, yHi };
}

function lerp(a, b, t) { return a + (b - a) * t; }
function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function sharpeColor(sharpe, lo, hi) {
  if (sharpe == null || !isFinite(sharpe) || hi === lo) return CHART.pointLow;
  const t = Math.max(0, Math.min(1, (sharpe - lo) / (hi - lo)));
  const [r1, g1, b1] = hexToRgb(CHART.pointLow);
  const [r2, g2, b2] = hexToRgb(CHART.pointHigh);
  return `rgb(${lerp(r1, r2, t) | 0}, ${lerp(g1, g2, t) | 0}, ${lerp(b1, b2, t) | 0})`;
}

const pct = (v) => `${(v * 100).toFixed(1)}%`;

export default function FrontierChart({ frontier, minLabel = "min-vol", maxLabel = "max-Sharpe" }) {
  const [hover, setHover] = useState(null); // { x, y, point }
  if (!frontier || !frontier.points || !frontier.points.length) return null;
  const { points, min_volatility: minVol, max_sharpe: maxSharpe, n_simulated } = frontier;
  const { sx, sy, xMax, yLo, yHi } = scaleFns(points, minVol, maxSharpe);
  const sharpes = points.map((p) => p.sharpe).filter((s) => s != null && isFinite(s));
  const sLo = sharpes.length ? Math.min(...sharpes) : 0;
  const sHi = sharpes.length ? Math.max(...sharpes) : 1;

  // A handful of light gridlines, matplotlib-style, for readability on white.
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => xMax * t);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => yLo + (yHi - yLo) * t);

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="frontier-svg" role="img" aria-label="Simulated portfolios chart"
        style={{ background: CHART.bg }}>
        {/* gridlines */}
        {xTicks.map((v, i) => (
          <line key={"gx" + i} x1={sx(v)} y1={PAD} x2={sx(v)} y2={H - PAD} stroke={CHART.grid} />
        ))}
        {yTicks.map((v, i) => (
          <line key={"gy" + i} x1={PAD} y1={sy(v)} x2={W - PAD} y2={sy(v)} stroke={CHART.grid} />
        ))}
        {/* axes */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={CHART.axis} />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke={CHART.axis} />
        <text x={W - PAD} y={H - PAD + 18} textAnchor="end" className="chart-label" fill={CHART.text}>volatility →</text>
        <text x={PAD} y={PAD - 12} textAnchor="start" className="chart-label" fill={CHART.text}>↑ expected return</text>

        {/* every sampled portfolio, colored by Sharpe ratio (low -> high), hoverable */}
        {points.map((p, i) => (
          <circle key={i} cx={sx(p.volatility)} cy={sy(p.return)} r={hover?.i === i ? 4.5 : 2.6}
            fill={sharpeColor(p.sharpe, sLo, sHi)} opacity={hover?.i === i ? 1 : 0.65}
            stroke={hover?.i === i ? "#111827" : "none"} strokeWidth="1"
            style={{ cursor: "pointer" }}
            onMouseEnter={() => setHover({ i, x: sx(p.volatility), y: sy(p.return), point: p })}
            onMouseLeave={() => setHover((h) => (h?.i === i ? null : h))}
          />
        ))}

        {/* lowest-volatility portfolio found */}
        <circle cx={sx(minVol.volatility)} cy={sy(minVol.return)} r="6"
          fill={CHART.bg} stroke={CHART.minVol} strokeWidth="2.5"
          style={{ cursor: "pointer" }}
          onMouseEnter={() => setHover({ i: "min", x: sx(minVol.volatility), y: sy(minVol.return), point: minVol, label: minLabel })}
          onMouseLeave={() => setHover((h) => (h?.i === "min" ? null : h))} />
        <text x={sx(minVol.volatility) + 8} y={sy(minVol.return) - 8} className="chart-label" fill={CHART.text}>
          {minLabel} ({pct(minVol.volatility)}, {pct(minVol.return)})
        </text>

        {/* best-Sharpe portfolio found */}
        <circle cx={sx(maxSharpe.volatility)} cy={sy(maxSharpe.return)} r="6"
          fill={CHART.bg} stroke={CHART.maxSharpe} strokeWidth="2.5"
          style={{ cursor: "pointer" }}
          onMouseEnter={() => setHover({ i: "max", x: sx(maxSharpe.volatility), y: sy(maxSharpe.return), point: maxSharpe, label: maxLabel })}
          onMouseLeave={() => setHover((h) => (h?.i === "max" ? null : h))} />
        <text x={sx(maxSharpe.volatility) + 8} y={sy(maxSharpe.return) + 16} className="chart-label" fill={CHART.text}>
          {maxLabel} ({pct(maxSharpe.volatility)}, {pct(maxSharpe.return)})
        </text>
      </svg>

      {hover && (
        <div className="frontier-tooltip" style={{
          left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%`,
        }}>
          {hover.label && <strong>{hover.label}</strong>}
          <div>return {pct(hover.point.return)}</div>
          <div>volatility {pct(hover.point.volatility)}</div>
          <div>Sharpe {hover.point.sharpe != null ? hover.point.sharpe.toFixed(2) : "—"}</div>
        </div>
      )}

      <p className="hint">Dot color: Sharpe ratio, blue (low) to amber (high). Hover any point for its exact numbers.</p>
      {n_simulated && <p className="hint">{n_simulated.toLocaleString()} portfolios simulated
        {points.length < n_simulated ? ` (showing a ${points.length.toLocaleString()}-point sample on the chart; the marked portfolios above are exact over all ${n_simulated.toLocaleString()})` : ""}.</p>}
    </div>
  );
}
