import { useState } from "react";
import EfficientFrontier from "./EfficientFrontier.jsx";

// Each entry is one strategy card in the R&D tab. Add new strategies here —
// give them an id, name, one-line summary, and the component that renders
// inside the expanded panel (fetch/transform/compute controls, tables, charts).
//
// Blueprint: EfficientFrontier.jsx is the reference implementation for a new
// strategy. Reuse its pattern — StepCard.jsx for collapsible numbered steps,
// GET/PUT /api/v1/rd/state/{strategy_id} (see backend/app/memory.py) for
// sticky inputs/results across tab switches and restarts, and RiskFreePicker
// / FrontierChart as examples of small reusable pieces.
const STRATEGIES = [
  {
    id: "efficient_frontier",
    name: "Efficient Frontier",
    summary: "Mean-variance portfolio optimization across a symbol basket.",
    Component: EfficientFrontier,
  },
];

export default function RD() {
  const [openId, setOpenId] = useState(STRATEGIES[0]?.id ?? null);

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
          {STRATEGIES.map((s) => {
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
      </div>
    </div>
  );
}
