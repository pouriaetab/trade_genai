// Reusable "pipeline step" wrapper for R&D strategies: a numbered card that
// can be collapsed to a single summary line once you've seen its result, and
// expanded again to inspect/redo it. Efficient Frontier is the first strategy
// built on this — future strategies should reuse it for the same step-by-step
// feel instead of inventing a new pattern.
export default function StepCard({ index, title, summary, done, collapsed, onToggle, children, tooltip }) {
  return (
    <div className={"step-card" + (done ? " done" : "")}>
      <button className="step-head" onClick={onToggle} title={tooltip || (collapsed ? "Expand" : "Collapse to one line")}>
        <span className="step-index">{index}</span>
        <span className="step-title">{title}</span>
        {collapsed && summary && <span className="step-summary">{summary}</span>}
        <div className="spacer" />
        <span className="step-chevron">{collapsed ? "▸" : "▾"}</span>
      </button>
      {!collapsed && <div className="step-body">{children}</div>}
    </div>
  );
}
