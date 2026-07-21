import { useState } from "react";
import { post, put, del } from "../../lib/api.js";
import { useElapsed } from "../../lib/useElapsed.js";
import LabNotesPanel from "./LabNotesPanel.jsx";

// Generic editable-code strategy card for anything the user adds from the
// R&D UI directly (as opposed to a built-in strategy like Efficient Frontier
// that ships its own step-by-step component). Reuses the same kernel the
// Notebook/Lab cells run in — /api/v1/kernel/run — so there's no separate
// execution path to maintain.
function ExecOutput({ exec }) {
  const elapsed = useElapsed(!!exec?.running);
  if (!exec) return null;
  if (exec.running) return <div className="out"><pre style={{ color: "var(--color-accent)" }}>running… {elapsed}s</pre></div>;
  const nothing = !exec.stdout && !exec.result_html && !exec.result_text && !(exec.figures || []).length && !exec.error;
  return (
    <div className="out">
      {exec.stdout && exec.stdout.trim() && <pre>{exec.stdout}</pre>}
      {exec.result_html && <div dangerouslySetInnerHTML={{ __html: exec.result_html }} />}
      {exec.result_text && <pre>{exec.result_text}</pre>}
      {(exec.figures || []).map((f, i) => <img key={i} src={`data:image/png;base64,${f}`} alt="chart" />)}
      {exec.error && <div className="err"><pre>{exec.error}</pre></div>}
      {nothing && <pre style={{ color: "var(--color-text-muted)" }}>(no output)</pre>}
    </div>
  );
}

export default function CodeStrategy({ strategy, onSaved, onDeleted }) {
  const [code, setCode] = useState(strategy.code || "");
  const [summary, setSummary] = useState(strategy.summary || "");
  const [dirty, setDirty] = useState(false);
  const [exec, setExec] = useState(null);
  const [saving, setSaving] = useState(false);

  async function run() {
    setExec({ running: true });
    const r = await post("/api/v1/kernel/run", { code });
    setExec(r.success ? r.data : { error: r.message || "Run failed." });
  }

  async function save() {
    setSaving(true);
    const r = await put(`/api/v1/rd/strategies/${strategy.id}`, {
      name: strategy.name, summary, code,
    });
    setSaving(false);
    if (r.success) { setDirty(false); onSaved?.(r.data); }
  }

  async function remove() {
    if (!confirm(`Delete the "${strategy.name}" strategy? This can't be undone.`)) return;
    await del(`/api/v1/rd/strategies/${strategy.id}`);
    onDeleted?.(strategy.id);
  }

  return (
    <div className="code-strategy">
      {strategy.seeded_from && !strategy.reviewed && (
        <div className="rd-review-banner">
          Seeded from your Lab tab "{strategy.seeded_from}" because the names matched — that's a
          convenience, not a correctness check. Read through the code below before trusting or
          running it; saving here marks it reviewed.
        </div>
      )}
      <LabNotesPanel strategyName={strategy.name} />
      <label className="ef-field ef-field-wide">
        <span>Summary</span>
        <input type="text" value={summary}
          onChange={(e) => { setSummary(e.target.value); setDirty(true); }}
          placeholder="One line describing what this strategy does" />
      </label>
      <label className="ef-field ef-field-wide code-strategy-code">
        <span title="Runs in the same kernel as Notebook/Lab cells — pandas as pd, numpy as np, matplotlib as plt, and genai_trader as gt are already available.">
          Code
        </span>
        <textarea rows={12} value={code}
          onChange={(e) => { setCode(e.target.value); setDirty(true); }}
          placeholder="# write or paste your strategy code here" />
      </label>
      <div className="ef-row">
        <button className="brand" disabled={exec?.running} onClick={run}>
          {exec?.running ? "Running…" : "Run"}
        </button>
        <button className="ghost" disabled={!dirty || saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="ghost" onClick={remove} style={{ marginLeft: "auto", color: "var(--color-error)" }}>
          Delete strategy
        </button>
      </div>
      <ExecOutput exec={exec} />
    </div>
  );
}
