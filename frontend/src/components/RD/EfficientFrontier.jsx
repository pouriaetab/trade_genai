import { useEffect, useRef, useState } from "react";
import { api, post, put } from "../../lib/api.js";
import { useElapsed } from "../../lib/useElapsed.js";
import Table, { RecordsTable } from "./Table.jsx";
import FrontierChart from "./FrontierChart.jsx";
import StepCard from "./StepCard.jsx";
import RiskFreePicker from "./RiskFreePicker.jsx";
import LabNotesPanel from "./LabNotesPanel.jsx";

const STRATEGY_ID = "efficient_frontier";
const STRATEGY_NAME = "Efficient Frontier";

function ResultBlock({ title, point, symbols, highlight }) {
  if (!point) return null;
  return (
    <div className={"ef-result-block" + (highlight ? " highlight" : "")}>
      <p className="ef-result-title">{title}</p>
      <div className="ef-result-metrics">
        <div className="ef-metric">
          <span className="ef-metric-label">Expected return</span>
          <span className="ef-metric-value">{(point.return * 100).toFixed(2)}%</span>
        </div>
        <div className="ef-metric">
          <span className="ef-metric-label">Risk (volatility)</span>
          <span className="ef-metric-value">{(point.volatility * 100).toFixed(2)}%</span>
        </div>
        <div className="ef-metric">
          <span className="ef-metric-label">Sharpe ratio</span>
          <span className="ef-metric-value">{point.sharpe != null ? point.sharpe.toFixed(2) : "—"}</span>
        </div>
      </div>
      <p className="hint">Allocation</p>
      <table className="rd-table"><thead><tr>
        {symbols.map((s) => <th key={s}>{s}</th>)}
      </tr></thead><tbody><tr>
        {symbols.map((s) => <td key={s}>{((point.weights[s] || 0) * 100).toFixed(1)}%</td>)}
      </tr></tbody></table>
    </div>
  );
}

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

const DEFAULTS = {
  symbolsText: "SPY, QQQ, TLT",
  start: yearAgoISO(),
  end: todayISO(),
  returnKind: "simple",
  riskFreeChoice: "BIL",
  riskFreeCustomRate: 2,
  riskFreeResolvedRate: null,
  nPortfolios: 10000,
  excludedSymbols: [],
  fetchResult: null,
  returnsResult: null,
  statsResult: null,
  frontierResult: null,
  collapsed: { 1: false, 2: true, 3: true, 4: true, 5: false },
};

export default function EfficientFrontier() {
  const [state, setState] = useState(DEFAULTS);
  const [loadedState, setLoadedState] = useState(false);
  const patch = (p) => setState((s) => ({ ...s, ...p }));
  const setCollapsed = (step, v) => setState((s) => ({ ...s, collapsed: { ...s.collapsed, [step]: v } }));

  const [showRaw, setShowRaw] = useState(false);
  const [busy, setBusy] = useState(null); // which step is running
  const [error, setError] = useState(null);
  const [rfFetching, setRfFetching] = useState(false);
  const [rfError, setRfError] = useState(null);
  const elapsed = useElapsed(!!busy);
  const skipNextSave = useRef(true);

  // Load sticky state once — symbols, dates, choices, and every result you'd
  // otherwise lose on tab switch / reload. Every future strategy should
  // persist the same way (see the R&D README note in RD/index.jsx).
  useEffect(() => {
    api(`/api/v1/rd/state/${STRATEGY_ID}`).then((r) => {
      if (r.success && r.data && Object.keys(r.data).length) {
        setState((s) => ({ ...s, ...r.data }));
      }
      setLoadedState(true);
    }).catch(() => setLoadedState(true));
  }, []);

  // Debounced autosave, same pattern as the Lab workspace.
  useEffect(() => {
    if (!loadedState) return;
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    const t = setTimeout(() => { put(`/api/v1/rd/state/${STRATEGY_ID}`, { state }); }, 700);
    return () => clearTimeout(t);
  }, [state, loadedState]);

  const symbols = () => state.symbolsText.split(",").map((s) => s.trim()).filter(Boolean);
  const symCount = symbols().length;
  const excludedSet = () => new Set((state.excludedSymbols || []).map((s) => s.toUpperCase()));
  const activeSymbols = () => symbols().filter((s) => !excludedSet().has(s.toUpperCase()));
  function toggleExclude(sym) {
    const up = sym.toUpperCase();
    setState((s) => {
      const cur = new Set((s.excludedSymbols || []).map((x) => x.toUpperCase()));
      if (cur.has(up)) cur.delete(up); else cur.add(up);
      return { ...s, excludedSymbols: [...cur] };
    });
  }

  function resolvedRiskFreeRate() {
    if (state.riskFreeChoice === "custom") return Number(state.riskFreeCustomRate) / 100 || 0;
    if (state.riskFreeChoice === "none") return 0;
    return state.riskFreeResolvedRate || 0;
  }
  function riskFreeLabel() {
    return state.riskFreeChoice === "custom" ? "Custom rate"
      : state.riskFreeChoice === "none" ? "Risk-Free" : state.riskFreeChoice;
  }

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

  async function fetchRiskFreeRate() {
    const preset = state.riskFreeChoice;
    if (preset === "none" || preset === "custom") return;
    setRfFetching(true); setRfError(null);
    const r = await post("/api/v1/rd/ef/risk-free", { symbol: preset, start: state.start, end: state.end });
    setRfFetching(false);
    if (!r.success) { setRfError(r.message); return; }
    patch({ riskFreeResolvedRate: r.data.annual_rate });
  }

  async function doFetch() {
    const data = await runStep("fetch", () =>
      post("/api/v1/rd/ef/fetch", { symbols: symbols(), start: state.start, end: state.end }));
    if (data) {
      patch({ fetchResult: data, returnsResult: null, statsResult: null, frontierResult: null });
      setShowRaw(true);
      setCollapsed(2, false);
    }
  }

  async function doTransform() {
    if (!state.fetchResult) return;
    const data = await runStep("transform", () =>
      post("/api/v1/rd/ef/returns", { wide: state.fetchResult.wide, kind: state.returnKind }));
    if (data) { patch({ returnsResult: data, statsResult: null, frontierResult: null }); setCollapsed(3, false); }
  }

  async function doStats() {
    if (!state.returnsResult) return;
    const data = await runStep("stats", () =>
      post("/api/v1/rd/ef/stats", { returns: state.returnsResult.returns, periods_per_year: 252 }));
    if (data) { patch({ statsResult: data, frontierResult: null }); setCollapsed(4, false); }
  }

  async function doFrontier() {
    if (!state.statsResult) return;
    const data = await runStep("frontier", () =>
      post("/api/v1/rd/ef/frontier", {
        annual_returns: state.statsResult.annual_returns,
        cov_matrix: state.statsResult.cov_matrix,
        risk_free_rate: resolvedRiskFreeRate(),
        risk_free_label: riskFreeLabel(),
        n_portfolios: Number(state.nPortfolios),
        exclude: [...excludedSet()],
      }));
    if (data) { patch({ frontierResult: data }); setCollapsed(5, false); }
  }

  async function runAll() {
    const data = await runStep("run", () =>
      post("/api/v1/rd/ef/run", {
        symbols: symbols(), start: state.start, end: state.end, kind: state.returnKind,
        risk_free_rate: resolvedRiskFreeRate(), risk_free_label: riskFreeLabel(),
        n_portfolios: Number(state.nPortfolios),
        exclude: [...excludedSet()],
      }));
    if (data) {
      patch({
        fetchResult: { raw_preview: data.raw_preview, raw_row_count: data.raw_row_count, wide: data.wide },
        returnsResult: { returns: data.returns },
        statsResult: { annual_returns: data.annual_returns, cov_matrix: data.cov_matrix },
        frontierResult: { symbols: data.symbols, points: data.points, n_simulated: data.n_simulated,
          min_volatility: data.min_volatility, max_sharpe: data.max_sharpe, note: data.note },
        collapsed: { 1: true, 2: true, 3: true, 4: true, 5: false },
      });
      setShowRaw(true);
    }
  }

  const summary1 = state.fetchResult ? `${symbols().join(", ")} · ${state.start} → ${state.end}` : "not run yet";
  const summary2 = state.returnsResult ? RETURN_KINDS.find((k) => k.id === state.returnKind)?.label.split(" ")[1] + " returns" : "not run yet";
  const summary3 = state.statsResult ? `${Object.keys(state.statsResult.annual_returns).length} symbols` : "not run yet";
  const summary4 = state.frontierResult
    ? `${state.frontierResult.n_simulated?.toLocaleString() || ""} portfolios · rf ${(resolvedRiskFreeRate() * 100).toFixed(1)}%`
    : "not run yet";

  return (
    <div className="ef-strategy">
      <LabNotesPanel strategyName={STRATEGY_NAME} />
      <StepCard index={1} title="Symbols & date range" done={!!state.fetchResult}
        collapsed={state.collapsed[1]} onToggle={() => setCollapsed(1, !state.collapsed[1])}
        summary={summary1}>
        <div className="ef-row">
          <label className="ef-field ef-field-wide">
            <span title="One or more tickers, comma-separated. One symbol works too — it'll be blended with your risk-free choice below instead of diversified against other stocks.">
              Symbols (comma-separated)
            </span>
            <input type="text" value={state.symbolsText} onChange={(e) => patch({ symbolsText: e.target.value })}
              placeholder="SPY, QQQ, TLT" />
          </label>
          <label className="ef-field">
            <span>Start date</span>
            <input type="date" value={state.start} onChange={(e) => patch({ start: e.target.value })} />
          </label>
          <label className="ef-field">
            <span>End date</span>
            <input type="date" value={state.end} onChange={(e) => patch({ end: e.target.value })} />
          </label>
          <button className="brand" disabled={busy === "fetch"} onClick={doFetch}>
            {busy === "fetch" ? `Fetching… ${elapsed}s` : "Fetch data"}
          </button>
        </div>
        {busy === "fetch" && (
          <p className="hint">Fetching {symCount || 1} symbol{symCount === 1 ? "" : "s"} from the market
            data API — usually ~1–3s per symbol, so roughly {Math.max(symCount, 1) * 1}–{Math.max(symCount, 1) * 3}s total.</p>
        )}
        {symCount > 1 && (
          <div className="ef-exclude-row" title="Untick a symbol to leave it out of the simulation and results — without re-fetching or re-typing anything.">
            <span className="hint">Include in simulation:</span>
            {symbols().map((s) => (
              <label key={s} className="ef-exclude-chip">
                <input type="checkbox" checked={!excludedSet().has(s.toUpperCase())}
                  onChange={() => toggleExclude(s)} />
                {s.toUpperCase()}
              </label>
            ))}
          </div>
        )}
      </StepCard>

      {error && <div className="err ef-error"><pre>{error}</pre></div>}

      {state.fetchResult && (
        <StepCard index={2} title="Raw data" done={!!state.fetchResult}
          collapsed={state.collapsed[2]} onToggle={() => setCollapsed(2, !state.collapsed[2])}
          summary={`${state.fetchResult.raw_row_count} rows fetched`}
          tooltip="The unmodified OHLCV rows the fetch step returned, before any transform">
          <button className="ghost" onClick={() => setShowRaw((v) => !v)}>{showRaw ? "hide" : "show"} table</button>
          {showRaw && <RecordsTable records={state.fetchResult.raw_preview} />}
        </StepCard>
      )}

      {state.fetchResult && (
        <StepCard index={3} title="Transform raw prices" done={!!state.returnsResult}
          collapsed={state.collapsed[3]} onToggle={() => setCollapsed(3, !state.collapsed[3])}
          summary={summary2}>
          <div className="ef-row">
            <label className="ef-field ef-field-wide">
              <span title="Prices are already reshaped date-indexed, one column per symbol (the 'wide' table) — this turns that into daily returns.">
                Transform
              </span>
              <select value={state.returnKind} onChange={(e) => patch({ returnKind: e.target.value })}>
                {RETURN_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </label>
            <button className="brand" disabled={busy === "transform"} onClick={doTransform}>
              {busy === "transform" ? `Transforming… ${elapsed}s` : "Apply transform"}
            </button>
          </div>
          {state.returnsResult && <Table table={state.returnsResult.returns} />}
        </StepCard>
      )}

      {state.returnsResult && (
        <StepCard index={4} title="Build annual_returns & cov_matrix" done={!!state.statsResult}
          collapsed={state.collapsed[4]} onToggle={() => setCollapsed(4, !state.collapsed[4])}
          summary={summary3}
          tooltip="daily_returns is the table above; this step turns it into one annualized average return per symbol, and the annualized covariance matrix between them.">
          <button className="brand" disabled={busy === "stats"} onClick={doStats}>
            {busy === "stats" ? `Computing… ${elapsed}s` : "Compute annual_returns + cov_matrix"}
          </button>
          {state.statsResult && (
            <div className="ef-stats-grid">
              <div>
                <p className="hint">annual_returns</p>
                <table className="rd-table">
                  <thead><tr>{Object.keys(state.statsResult.annual_returns).map((s) => <th key={s}>{s}</th>)}</tr></thead>
                  <tbody><tr>{Object.values(state.statsResult.annual_returns).map((v, i) =>
                    <td key={i}>{(v * 100).toFixed(2)}%</td>)}</tr></tbody>
                </table>
              </div>
              <div>
                <p className="hint">cov_matrix (annualized)</p>
                <Table table={state.statsResult.cov_matrix} numberFmt={(v) => v.toFixed(5)} />
              </div>
            </div>
          )}
        </StepCard>
      )}

      {state.statsResult && (
        <StepCard index={5} title="Simulate portfolios" done={!!state.frontierResult}
          collapsed={state.collapsed[5]} onToggle={() => setCollapsed(5, !state.collapsed[5])}
          summary={summary4}>
          <div className="ef-row">
            <RiskFreePicker
              choice={state.riskFreeChoice} onChoice={(v) => patch({ riskFreeChoice: v, riskFreeResolvedRate: null })}
              customRate={state.riskFreeCustomRate} onCustomRate={(v) => patch({ riskFreeCustomRate: v })}
              resolvedRate={state.riskFreeResolvedRate} onFetchRate={fetchRiskFreeRate}
              fetching={rfFetching} error={rfError}
            />
          </div>
          <div className="ef-row">
            <label className="ef-field">
              <span title="How many random long-only portfolios to draw and score. More = a smoother/more reliable picture of the best & worst found, but takes a bit longer. 10,000 is a solid default; try 1,000 for a quick look or 50,000 for a thorough one.">
                Number of simulated portfolios
              </span>
              <input type="number" step="500" min="100" max="100000" value={state.nPortfolios}
                onChange={(e) => patch({ nPortfolios: e.target.value })} />
            </label>
            <button className="brand" disabled={busy === "frontier"} onClick={doFrontier}>
              {busy === "frontier" ? `Simulating… ${elapsed}s` : "Run simulation"}
            </button>
          </div>
          {state.frontierResult && (
            <>
              {state.frontierResult.note && <p className="hint">{state.frontierResult.note}</p>}
              <FrontierChart frontier={state.frontierResult}
                minLabel={symbols().length === 1 ? "all risk-free" : "min-vol"}
                maxLabel={symbols().length === 1 ? "50/50 point" : "max-Sharpe"} />
              <div className="ef-results-grid">
                <ResultBlock
                  title={symbols().length === 1 ? "All risk-free" : "Min-volatility portfolio"}
                  point={state.frontierResult.min_volatility}
                  symbols={state.frontierResult.symbols}
                />
                <ResultBlock
                  title={symbols().length === 1 ? "50/50 point" : "Max-Sharpe portfolio"}
                  point={state.frontierResult.max_sharpe}
                  symbols={state.frontierResult.symbols}
                  highlight
                />
              </div>
              <p className="hint">
                Weights are long-only (0–100% each, sum to 100%) — the random-portfolio method, so no shorting.
              </p>
            </>
          )}
        </StepCard>
      )}

      <div className="ef-runall">
        <button className="ghost" disabled={busy === "run"} onClick={runAll}>
          {busy === "run" ? `Running full pipeline… ${elapsed}s` : "Or just run all steps at once →"}
        </button>
      </div>
    </div>
  );
}
