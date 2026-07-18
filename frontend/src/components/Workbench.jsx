import { useEffect, useMemo, useState } from "react";
import { post } from "../lib/api.js";

const uid = () => (globalThis.crypto?.randomUUID?.() || `c${Date.now()}${Math.random()}`);

function summarizeExec(exec) {
  if (!exec) return "";
  if (exec.error) return "error:\n" + exec.error.split("\n").slice(-3).join("\n");
  const parts = [];
  if (exec.stdout && exec.stdout.trim()) parts.push(exec.stdout.trim());
  if (exec.result_text) parts.push(exec.result_text);
  if (exec.result_html) parts.push("(table output)");
  if ((exec.figures || []).length) parts.push("(chart)");
  return parts.join("\n").slice(0, 1200);
}

function ExecOutput({ exec }) {
  if (!exec) return null;
  if (exec.running) return <div className="out"><pre style={{ color: "var(--color-accent)" }}>running…</pre></div>;
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

export default function Workbench({ models, cells, onCells }) {
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [mode, setMode] = useState("prompt");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!models.length) return;
    if (!models.find((p) => p.id === providerId)) {
      const pref = models.find((p) => p.ready) || models.find((p) => p.has_free_tier) || models[0];
      setProviderId(pref.id);
      return;
    }
    const prov = models.find((p) => p.id === providerId);
    if (prov && !prov.models.find((m) => m.id === modelId)) setModelId(prov.models[0]?.id || "");
  }, [models, providerId, modelId]);

  const provider = useMemo(() => models.find((p) => p.id === providerId) || null, [models, providerId]);
  const model = useMemo(() => (provider ? provider.models.find((m) => m.id === modelId) : null), [provider, modelId]);

  const patch = (id, p) => onCells(cells.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const removeCell = (id) => onCells(cells.filter((c) => c.id !== id));

  function buildMessages(list) {
    const msgs = [];
    for (const c of list) {
      if (c.kind === "code") {
        msgs.push({ role: "user", content: `I ran:\n\`\`\`python\n${c.code}\n\`\`\``
          + (c.execSummary ? `\n[result]\n${c.execSummary}` : "") });
      } else {
        msgs.push({ role: "user", content: c.input || "" });
        let a = c.answer && c.answer !== "…" ? c.answer : "";
        if (c.code) a += `\n\n\`\`\`python\n${c.code}\n\`\`\``;
        if (c.execSummary) a += `\n\n[result]\n${c.execSummary}`;
        if (a) msgs.push({ role: "assistant", content: a });
      }
    }
    return msgs;
  }

  async function runCode(id, code) {
    patch(id, { execution: { running: true } });
    const r = await post("/api/v1/kernel/run", { code });
    const exec = r.data || {};
    patch(id, { execution: exec, execSummary: summarizeExec(exec) });
  }

  async function send() {
    const input = text.trim();
    if (!input || busy) return;
    setText("");

    if (mode === "code") {
      const cell = { id: uid(), kind: "code", code: input, execution: { running: true } };
      onCells([...cells, cell]);
      const r = await post("/api/v1/kernel/run", { code: input });
      const exec = r.data || {};
      onCells([...cells, { ...cell, execution: exec, execSummary: summarizeExec(exec) }]);
      return;
    }

    if (!provider || !model) return;
    const id = uid();
    const base = [...cells];
    onCells([...base, { id, kind: "prompt", input, answer: "…" }]);
    setBusy(true);
    const messages = [...buildMessages(base), { role: "user", content: input }];
    const r = await post("/api/v1/agent", { provider: provider.id, model: model.id, messages, max_tokens: 1024 });
    setBusy(false);
    if (!r.success) {
      onCells([...base, { id, kind: "prompt", input, answer: r.message, meta: "error" }]);
      return;
    }
    const d = r.data;
    onCells([...base, {
      id, kind: "prompt", input, answer: d.text, code: d.code || null,
      execution: d.execution || null, execSummary: summarizeExec(d.execution),
      meta: `${d.model} · ~$${(d.est_cost_usd || 0).toFixed(4)}`,
    }]);
  }

  if (!models.length) {
    return (
      <div className="panel"><div className="panel-head"><h2>Workbench</h2></div>
        <div className="panel-body">
          <p className="placeholder">No models loaded — is the backend running on <code>:8003</code>?
          Start it with <code>./run.sh</code>, then reload.</p>
        </div></div>
    );
  }

  return (
    <div className="panel workbench">
      <div className="panel-head">
        <h2>Workbench</h2>
        <div className="spacer" />
        <select className="mini" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
          {models.map((p) => <option key={p.id} value={p.id}>{p.label}{p.ready ? "" : " (add key)"}</option>)}
        </select>
        <select className="mini" value={modelId} onChange={(e) => setModelId(e.target.value)}>
          {(provider?.models || []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <div className="mode-toggle">
          <button className={mode === "prompt" ? "on" : "ghost"} onClick={() => setMode("prompt")}>Prompt</button>
          <button className={mode === "code" ? "on" : "ghost"} onClick={() => setMode("code")}>Code</button>
        </div>
      </div>

      <div className="panel-body">
        {/* New cell — always on top; new results push older ones down */}
        <div className="new-cell">
          <textarea value={text}
            style={mode === "code" ? { fontFamily: "var(--font-mono)", fontSize: "12.5px" } : undefined}
            placeholder={mode === "prompt"
              ? "Ask for data or analysis — e.g. “last 100 daily closes of SPY, adjusted, as date + price”. Enter to send."
              : "# Python — runs in the shared kernel. Shift+Enter to run."}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              const submit = mode === "code" ? (e.shiftKey || e.metaKey || e.ctrlKey) : !e.shiftKey;
              if (e.key === "Enter" && submit) { e.preventDefault(); send(); }
            }} />
          <button className="brand" onClick={send} disabled={busy}>{mode === "code" ? "Run" : "Send"}</button>
        </div>
        {model && (
          <p className="model-meta">
            <span className={"badge " + model.tier}>{model.tier}</span> {model.cost_hint}
            {provider && !provider.ready &&
              <> · <span style={{ color: "var(--color-warning)" }}>needs {provider.env_var}</span></>}
          </p>
        )}

        <div className="thread">
          {cells.length === 0 && (
            <p className="placeholder">Your cells appear here, newest on top. Ask something, keep the
            result, then ask again — each new cell stacks above the last. Everything in this tab is saved
            automatically.</p>
          )}
          {[...cells].reverse().map((c) => (
            <div key={c.id} className="cell-unit">
              <div className="cell-bar">
                <span className="cell-tag">{c.kind === "code" ? "code" : "prompt"}</span>
                <div className="spacer" />
                <button className="ghost" title="Delete cell" onClick={() => removeCell(c.id)}>×</button>
              </div>
              {c.kind === "prompt" && c.input && <div className="msg user"><span>{c.input}</span></div>}
              {c.answer === "…" ? <span className="dots">…</span>
                : c.answer && <div className="answer">{c.answer}</div>}
              {c.code != null && (
                <div className="code-block">
                  <div className="code-head">
                    <span>python</span><div className="spacer" />
                    <button className="ghost" onClick={() => runCode(c.id, c.code)}>▶ Re-run</button>
                  </div>
                  <textarea spellCheck={false} value={c.code}
                    onChange={(e) => patch(c.id, { code: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.shiftKey || e.metaKey || e.ctrlKey)) {
                        e.preventDefault(); runCode(c.id, c.code);
                      }
                    }} />
                </div>
              )}
              {c.execution ? <ExecOutput exec={c.execution} />
                : c.execSummary ? <pre className="exec-summary">{c.execSummary}</pre> : null}
              {c.meta && <span className="meta">{c.meta}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
