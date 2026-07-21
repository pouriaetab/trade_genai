import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";

// Read-only bridge from the Notebook/Lab tab. If you built and pinned cells
// for something with roughly the same name as this strategy (e.g. a Lab tab
// called "Efficient Frontier" or "EF test"), they show up here as reference
// while you work on the formal R&D version — no copy/paste needed, and the
// code stays editable right where you used it in the Lab.
export default function LabNotesPanel({ strategyName }) {
  const [matches, setMatches] = useState([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api(`/api/v1/rd/lab-notes?name=${encodeURIComponent(strategyName)}`)
      .then((r) => { if (!cancelled && r.success) setMatches(r.data.matches || []); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [strategyName]);

  if (!loaded || matches.length === 0) return null;

  const cellCount = matches.reduce((n, m) => n + m.cells.length, 0);

  return (
    <div className="lab-notes-panel">
      <button className="lab-notes-head" onClick={() => setOpen((v) => !v)}
        title="Cells from Notebook/Lab tabs whose name matches this strategy — pinned cells if you pinned any, otherwise the most recent few.">
        <span className="step-chevron">{open ? "▾" : "▸"}</span>
        <span>From your Lab work: {matches.length} matching tab{matches.length === 1 ? "" : "s"}, {cellCount} cell{cellCount === 1 ? "" : "s"}</span>
      </button>
      {open && matches.map((m) => (
        <div key={m.session_id} className="lab-notes-session">
          <p className="hint">
            {m.session_name} {m.used_pinned ? "(pinned)" : "(most recent)"}
          </p>
          {m.cells.map((c, i) => (
            <div key={i} className="lab-notes-cell">
              {c.input && <div className="lab-notes-input">{c.input}</div>}
              {c.code && <pre className="lab-notes-code">{c.code}</pre>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
