import { useState } from "react";
import { post } from "../../lib/api.js";
import { useElapsed } from "../../lib/useElapsed.js";
import Table, { RecordsTable } from "./Table.jsx";
import FrontierChart from "./FrontierChart.jsx";

function todayISO() { return new Date().toISOString().slice(0, 10); }
function yearAgoISO() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

const RETURN_KINDS = [
  { id: "simple", label: "Daily simple returns  (Pt/Pt-1 - 1)" },
  { id: "log", label: "Daily log returns  (ln Pt/Pt-1)" },
];

export default function EfficientFrontier() {
  const [symbolsText, setSymbolsText] = useState("SPY, QQQ, TLT");
  const [start, setStart] = useState(yearAgoISO());
  const [end, setEnd] = useState(todayISO());
  const [returnKind, setReturnKind] = useState("simple");
  const [riskFreeRate, setRiskFreeRate] = useState(2);
  const [nPoints, setNPoints] = useState(40);

  const [fetchResult, setFetchResult] = useState(null);
  const [returnsResult, setReturnsResult] = useState(null);
  const [statsResult, setStatsResult] = useState(null);
  const [frontierResult, setFrontierResult] = useState(null);
  const [showRaw, setShowRaw] = useState(false);

  const [busy, setBusy] = useState(null); // which step is running
  const [error, setError] = useState(null);
  const elapsed = useElapsed(!!busy);

  const symbols = () => symbolsText.split(",").map((s) => s.trim()).filter(Boolean);
  const symCount = symbols().length;

  async function runStep(name, fn) {
    setBusy(name);
    setError(null);
    try {
      const r = await fn();
      if (!r.success) { setError(r.message || "Request failed."); return null; }
      return r.data;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function doFetch() {
    const data = await runStep("fetch", () =>
      post("/api/v1/rd/ef/fetch", { symbols: symbols(), start, end }));
    if (data) {
      setFetchResult(data);
      setReturnsResult(null); setStatsResult(null); setFrontierResult(null);
      setShowRaw(true);
    }
  }

  async function doTransform() {
    if (!fetchResult) return;
    const data = await runStep("transform", () =>
      post("/api/v1/rd/ef/returns", { wide: fetchResult.wide, kind: returnKind }));
    if (data) { setReturnsResult(data); setStatsResult(null); setFrontierResult(null); }
  }

  async function doStats() {
    if (!returnsResult) return;
    const data = await runStep("stats", () =>
      post("/api/v1/rd/ef/stats", { returns: returnsResult.returns, periods_per_year: 252 }));
    if (data) { setStatsResult(data); setFrontierResult(null); }
  }

  async function doFrontier() {
    if (!statsResult) return;
    const data = await runStep("frontier", () =>
      post("/api/v1/rd/ef/frontier", {
        annual_returns: statsResult.annual_returns,
        cov_matrix: statsResult.cov_matrix,
        risk_free_rate: Number(riskFreeRate) / 100,
        n_points: Number(nPoints),
      }));
    if (data) setFrontierResult(data);
  }

  async function runAll() {
    const data = await runStep("run", () =>
      post("/api/v1/rd/ef/run", {
        symbols: symbols(), start, end, kind: returnKind,
        risk_free_rate: Number(riskFreeRate) / 100, n_points: Number(nPoints),
      }));
    if (data) {
      setFetchResult({ raw_preview: data.raw_preview, raw_row_count: data.raw_row_count, wide: data.wide });
      setReturnsResult({ returns: data.returns });
      setStatsResult({ annual_returns: data.annual_returns, cov_matrix: data.cov_matrix });
      setFrontierResult({ symbols: data.symbols, points: data.points,
        min_volatility: data.min_volatility, max_sharpe: data.max_sharpe });
      setShowRaw(true);
    }
  }

  return (
    <div className="ef-strategy">
      {/* Step 1 — symbols + date range */}
      <div className="ef-step">
        <div className="ef-step-title">1. Symbols &amp; date range</div>
        <div className="ef-row">
          <label className="ef-field ef-field-wide">
            <span>Symbols (comma-separated)</span>
            <input type="text" value={symbolsText} onChange={(e) => setSymbolsText(e.target.value)}
              placeholder="SPY, QQQ, TLT" />
          </label>
          <label className="ef-field">
            <span>Start date</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="ef-field">
            <span>End date</span>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <button className="brand" disabled={busy === "fetch"} onClick={doFetch}>
            {busy === "fetch" ? `Fetching… ${elapsed}s` : "Fetch data"}
          </button>
        </div>
        {busy === "fetch" && (
          <p className="hint">Fetching {symCount || 1} symbol{symCount === 1 ? "" : "s"} from the market
            data API — usually ~1–3s per symbol, so roughly {Math.max(symCount, 1) * 1}–{Math.max(symCount, 1) * 3}s total.</p>
        )}
      </div>

      {error && <div className="err ef-error"><pre>{error}</pre></div>}

      {/* Step 2 — raw data preview */}
      {fetchResult && (
        <div className="ef-step">
          <div className="ef-step-title">
            2. Raw data
            <button className="ghost ef-toggle" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? "hide" : "show"} ({fetchResult.raw_row_count} rows fetched)
            </button>
          </div>
          {showRaw && <RecordsTable records={fetchResult.raw_preview} />}
        </div>
      )}

      {/* Step 3 — transform */}
      {fetchResult && (
        <div className="ef-step">
          <div className="ef-step-title">3. Transform raw prices</div>
          <div className="ef-row">
            <label className="ef-field ef-field-wide">
              <span>Transform</span>
              <select value={returnKind} onChange={(e) => setReturnKind(e.target.value)}>
                {RETURN_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </label>
            <button className="brand" disabled={busy === "transform"} onClick={doTransform}>
              {busy === "transform" ? `Transforming… ${elapsed}s` : "Apply transform"}
            </button>
          </div>
          <p className="hint">Prices are already reshaped date-indexed, one column per symbol
            (see the <code>wide</code> table under the hood) — this step turns that into daily returns.</p>
          {returnsResult && <Table table={returnsResult.returns} />}
        </div>
      )}

      {/* Step 4 — daily_returns / annual_returns / cov_matrix */}
      {returnsResult && (
        <div className="ef-step">
          <div className="ef-step-title">4. Build daily_returns, annual_returns, cov_matrix</div>
          <button className="brand" disabled={busy === "stats"} onClick={doStats}>
            {busy === "stats" ? `Computing… ${elapsed}s` : "Compute annual_returns + cov_matrix"}
          </button>
          {statsResult && (
            <div className="ef-stats-grid">
              <div>
                <p className="hint">annual_returns</p>
                <table className="rd-table">
                  <thead><tr>{Object.keys(statsResult.annual_returns).map((s) => <th key={s}>{s}</th>)}</tr></thead>
                  <tbody><tr>{Object.values(statsResult.annual_returns).map((v, i) =>
                    <td key={i}>{(v * 100).toFixed(2)}%</td>)}</tr></tbody>
                </table>
              </div>
              <div>
                <p className="hint">cov_matrix (annualized)</p>
                <Table table={statsResult.cov_matrix} numberFmt={(v) => v.toFixed(5)} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 5 — efficient frontier */}
      {statsResult && (
        <div className="ef-step">
          <div className="ef-step-title">5. Efficient frontier</div>
          <div className="ef-row">
            <label className="ef-field">
              <span>Risk-free rate (%/yr)</span>
              <input type="number" step="0.1" value={riskFreeRate}
                onChange={(e) => setRiskFreeRate(e.target.value)} />
            </label>
            <label className="ef-field">
              <span>Frontier points</span>
              <input type="number" step="5" min="5" max="200" value={nPoints}
                onChange={(e) => setNPoints(e.target.value)} />
            </label>
            <button className="brand" disabled={busy === "frontier"} onClick={doFrontier}>
              {busy === "frontier" ? `Solving… ${elapsed}s` : "Compute efficient frontier"}
            </button>
          </div>
          {frontierResult && (
            <>
              <FrontierChart frontier={frontierResult} />
              <div className="ef-stats-grid">
                <div>
                  <p className="hint">min-volatility weights</p>
                  <table className="rd-table"><thead><tr>
                    {frontierResult.symbols.map((s) => <th key={s}>{s}</th>)}
                  </tr></thead><tbody><tr>
                    {frontierResult.symbols.map((s) =>
                      <td key={s}>{(frontierResult.min_volatility.weights[s] * 100).toFixed(1)}%</td>)}
                  </tr></tbody></table>
                </div>
                <div>
                  <p className="hint">max-Sharpe weights</p>
                  <table className="rd-table"><thead><tr>
                    {frontierResult.symbols.map((s) => <th key={s}>{s}</th>)}
                  </tr></thead><tbody><tr>
                    {frontierResult.symbols.map((s) =>
                      <td key={s}>{(frontierResult.max_sharpe.weights[s] * 100).toFixed(1)}%</td>)}
                  </tr></tbody></table>
                </div>
              </div>
              <p className="hint">Weights are the unconstrained (long/short allowed) Markowitz solution —
                the textbook closed form. Add a no-short constraint yourself if your use case needs one.</p>
            </>
          )}
        </div>
      )}

      <div className="ef-runall">
        <button className="ghost" disabled={busy === "run"} onClick={runAll}>
          {busy === "run" ? `Running full pipeline… ${elapsed}s` : "Or just run all steps at once →"}
        </button>
      </div>
    </div>
  );
}
