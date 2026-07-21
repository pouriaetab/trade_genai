import { useEffect, useMemo, useState } from "react";
import { post } from "../lib/api.js";
import { useElapsed } from "../lib/useElapsed.js";

const uid = () => (globalThis.crypto?.randomUUID?.() || `c${Date.now()}${Math.random()}`);
const DEFAULT_MAX_TOKENS = 4096;
const TOKENS_PER_WORD = 1.33; // rough, matches the backend's estimate

function estimateTokens(text) {
  const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.round(words * TOKENS_PER_WORD);
}

// The model's raw reply repeats the code inside a ```python fence, which is
// redundant once that code is pulled out into its own editable box below —
// strip the fence(s) from the prose so it isn't shown twice.
const CODE_FENCE_RE = /```(?:python|py)?\s*\n[\s\S]*?```/g;
function proseOnly(answer, hasExtractedCode) {
  if (!answer || !hasExtractedCode) return answer;
  return answer.replace(CODE_FENCE_RE, "").trim();
}

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

export default function Workbench({ models, cells, onCells, onModelChange }) {
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [mode, setMode] = useState("prompt");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const busyElapsed = useElapsed(busy);

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

  // Let the header/status bar reflect whatever model is currently selected here.
  useEffect(() => {
    if (provider && model) {
      onModelChange?.({ providerLabel: provider.label, modelLabel: model.label, tier: model.tier, ready: provider.ready });
    }
  }, [provider, model]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (id, p) => onCells(cells.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const removeCell = (id) => onCells(cells.filter((c) => c.id !== id));
  const togglePin = (id) => patch(id, { pinned: !cells.find((c) => c.id === id)?.pinned });
  const jumpTo = (id) => document.getElementById(`cell-${id}`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
  const pinned = cells.filter((c) => c.pinned);

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
    const r = await post("/api/v1/agent", {
      provider: provider.id, model: model.id, messages, max_tokens: DEFAULT_MAX_TOKENS,
    });
    setBusy(false);
    if (!r.success) {
      onCells([...base, { id, kind: "prompt", input, answer: r.message, meta: "error" }]);
      return;
    }
    const d = r.data;
    const usage = d.usage || {};
    const tokBit = (usage.input_tokens != null && usage.output_tokens != null)
      ? `${usage.input_tokens}→${usage.output_tokens} tok · ` : "";
    onCells([...base, {
      id, kind: "prompt", input, answer: d.text, code: d.code || null,
      execution: d.execution || null, execSummary: summarizeExec(d.execution),
      meta: `${d.model} · ${tokBit}~$${(d.est_cost_usd || 0).toFixed(4)}`,
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
        <select className="mini" value={providerId} onChange={(e) => setProviderId(e.target.value)}
          title="Which LLM provider to send prompts to — manage keys and available providers in Settings">
          {models.map((p) => <option key={p.id} value={p.id}>{p.label}{p.ready ? "" : " (add key)"}</option>)}
        </select>
        <select className="mini" value={modelId} onChange={(e) => setModelId(e.target.value)}
          title="Which model from the selected provider to use — see the badge below for its tier and cost">
          {(provider?.models || []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <div className="mode-toggle" title="Prompt: ask in plain English, the model writes and runs the code. Code: write and run Python yourself in the same shared kernel.">
          <button className={mode === "prompt" ? "on" : "ghost"} onClick={() => setMode("prompt")}>Prompt</button>
          <button className={mode === "code" ? "on" : "ghost"} onClick={() => setMode("code")}>Code</button>
        </div>
      </div>

      <div className="panel-body">
        {/* New cell — always on top; new results push older ones down */}
        <div className={"new-cell" + (expanded ? " expanded" : "")}>
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
          <div className="new-cell-actions">
            <button className="ghost" title={expanded ? "Collapse" : "Expand — bigger box for long prompts/code"}
              onClick={() => setExpanded((v) => !v)}>{expanded ? "⤡" : "⤢"}</button>
            <button className="brand" onClick={send} disabled={busy}>
              {busy ? `Thinking… ${busyElapsed}s` : (mode === "code" ? "Run" : "Send")}
            </button>
            {mode === "prompt" && text.trim() &&
              <span className="token-estimate" title="Rough estimate from word count — the real count (and its cost) shows on the reply once it comes back">
                ~{estimateTokens(text)} tok
              </span>}
          </div>
        </div>
        {pinned.length > 0 && (
          <div className="pinned-strip">
            <span className="pinned-label">Pinned</span>
            {pinned.map((c) => (
              <button key={c.id} className="pinned-chip" onClick={() => jumpTo(c.id)}
                title={c.kind === "code" ? c.code : c.input}>
                ★ {(c.kind === "code" ? c.code : c.input || c.answer || "").slice(0, 28) || "(cell)"}
              </button>
            ))}
          </div>
        )}
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
            <div key={c.id} id={`cell-${c.id}`} className={"cell-unit" + (c.pinned ? " pinned" : "")}>
              <div className="cell-bar">
                <span className="cell-tag">{c.kind === "code" ? "code" : "prompt"}</span>
                <div className="spacer" />
                <button className={"ghost pin-btn" + (c.pinned ? " on" : "")}
                  title={c.pinned ? "Unpin" : "Pin as important"}
                  onClick={() => togglePin(c.id)}>{c.pinned ? "★" : "☆"}</button>
                <button className="ghost" title="Delete cell" onClick={() => removeCell(c.id)}>×</button>
              </div>
              {c.kind === "prompt" && c.input && <div className="msg user"><span>{c.input}</span></div>}
              {c.answer === "…" ? <span className="dots">…</span>
                : proseOnly(c.answer, c.code != null) &&
                  <div className="answer">{proseOnly(c.answer, c.code != null)}</div>}
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
