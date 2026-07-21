import { useEffect, useState } from "react";
import { api, post } from "../../lib/api.js";
import EfficientFrontier from "./EfficientFrontier.jsx";
import CodeStrategy from "./CodeStrategy.jsx";

// Built-in strategies ship their own step-by-step component — reuse this
// pattern for future built-ins: StepCard.jsx for collapsible numbered steps,
// GET/PUT /api/v1/rd/state/{strategy_id} (see backend/app/memory.py) for
// sticky inputs/results across tab switches and restarts, and RiskFreePicker
// / FrontierChart as examples of small reusable pieces.
const BUILTIN_STRATEGIES = [
  {
    id: "efficient_frontier",
    name: "Efficient Frontier",
    summary: "Mean-variance portfolio optimization across a symbol basket.",
    Component: EfficientFrontier,
  },
];

export default function RD() {
  const [customStrategies, setCustomStrategies] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [openId, setOpenId] = useState(BUILTIN_STRATEGIES[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  function loadCustom() {
    api("/api/v1/rd/strategies").then((r) => {
      if (r.success) setCustomStrategies(r.data || []);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }
  useEffect(loadCustom, []);

  async function createStrategy() {
    if (!newName.trim()) return;
    setCreating(true); setCreateError(null);
    const r = await post("/api/v1/rd/strategies", { name: newName.trim() });
    setCreating(false);
    if (!r.success) { setCreateError(r.message || "Could not create strategy."); return; }
    setCustomStrategies((prev) => [...prev, r.data]);
    setOpenId(r.data.id);
    setNewName("");
    setAdding(false);
  }

  const allStrategies = [
    ...BUILTIN_STRATEGIES,
    ...customStrategies.map((s) => ({
      id: s.id, name: s.name, summary: s.summary || "Custom strategy",
      Component: () => (
        <CodeStrategy
          strategy={s}
          onSaved={(updated) => setCustomStrategies((prev) => prev.map((x) => x.id === updated.id ? updated : x))}
          onDeleted={(id) => { setCustomStrategies((prev) => prev.filter((x) => x.id !== id)); setOpenId(null); }}
        />
      ),
    })),
  ];

  return (
    <div className="rd-page panel">
      <div className="panel-head">
        <h2>R&amp;D — trading strategies</h2>
      </div>
      <div className="panel-body">
        <p className="lead">
          Click a strategy to expand it. Work through it step by step — fetch data, transform it,
          inspect each table as it's built — or run the whole thing at once.
        </p>
        <div className="rd-list">
          {allStrategies.map((s) => {
            const open = openId === s.id;
            return (
              <div key={s.id} className={"rd-card" + (open ? " open" : "")}>
                <button className="rd-card-head" onClick={() => setOpenId(open ? null : s.id)}>
                  <span className="rd-card-chevron">{open ? "▾" : "▸"}</span>
                  <span className="rd-card-title">{s.name}</span>
                  <span className="rd-card-summary">{s.summary}</span>
                </button>
                {open && (
                  <div className="rd-card-body">
                    <s.Component />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!adding && (
          <div className="ef-runall" style={{ borderTop: "none", paddingTop: "12px" }}>
            <button className="ghost" onClick={() => setAdding(true)}>+ Add strategy</button>
          </div>
        )}
        {adding && (
          <div className="rd-add-form">
            <label className="ef-field ef-field-wide">
              <span title="If this name matches (or is close to) a Notebook/Lab tab you've been working in, the new strategy is seeded from that tab's most recent code automatically.">
                Strategy name
              </span>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Momentum, Pairs Trade, or match a Lab tab name" autoFocus />
            </label>
            <p className="rd-add-hint">
              Creates an editable code strategy you can run with the same kernel as the Notebook —
              if the name matches a Lab tab, its code is pulled in as a starting point.
            </p>
            {createError && <div className="err"><pre>{createError}</pre></div>}
            <div className="ef-row">
              <button className="brand" disabled={creating || !newName.trim()} onClick={createStrategy}>
                {creating ? "Creating…" : "Create"}
              </button>
              <button className="ghost" onClick={() => { setAdding(false); setNewName(""); setCreateError(null); }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
