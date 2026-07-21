// A small set of common risk-free proxies (short-term Treasury ETFs) so you
// don't have to guess a rate — pick one and its *actual* annualized return
// over your chosen date range is fetched from the same data provider as
// everything else. "Custom" is there for anyone who wants to type a number
// instead (e.g. matching a textbook problem).
export const RISK_FREE_PRESETS = [
  { id: "none", label: "None — 0%", symbol: null },
  { id: "BIL", label: "3-Month T-Bill (BIL)", symbol: "BIL" },
  { id: "SGOV", label: "0-3 Month Treasury (SGOV)", symbol: "SGOV" },
  { id: "SHY", label: "1-3 Year Treasury (SHY)", symbol: "SHY" },
  { id: "custom", label: "Custom rate", symbol: null },
];

export default function RiskFreePicker({
  choice, onChoice, customRate, onCustomRate,
  resolvedRate, onFetchRate, fetching, error,
}) {
  const preset = RISK_FREE_PRESETS.find((p) => p.id === choice) || RISK_FREE_PRESETS[0];

  return (
    <div className="risk-free-picker">
      <label className="ef-field ef-field-wide">
        <span title="Used to compute the Sharpe ratio (return per unit of risk) — and, if you're only running one stock, blended with it to show an allocation between the two.">
          Risk-free rate
        </span>
        <select value={choice} onChange={(e) => onChoice(e.target.value)}>
          {RISK_FREE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>

      {preset.symbol && (
        <>
          <button className="ghost" disabled={fetching} onClick={onFetchRate}
            title={`Fetch ${preset.symbol}'s actual annualized return over your date range`}>
            {fetching ? "Fetching…" : resolvedRate == null ? "Get rate" : "Refresh rate"}
          </button>
          {resolvedRate != null && (
            <span className="rf-resolved">{preset.symbol}: {(resolvedRate * 100).toFixed(2)}%/yr</span>
          )}
        </>
      )}

      {choice === "custom" && (
        <label className="ef-field">
          <span>Rate (%/yr)</span>
          <input type="number" step="0.1" value={customRate}
            onChange={(e) => onCustomRate(e.target.value)} />
        </label>
      )}

      {error && <span className="rf-error">{error}</span>}
    </div>
  );
}
