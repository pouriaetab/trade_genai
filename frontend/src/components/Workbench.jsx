import { useEffect, useMemo, useRef, useState } from "react";
import { post } from "../lib/api.js";

const uid = () => (globalThis.crypto?.randomUUID?.() || `t${Date.now()}${Math.random()}`);

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
  if (!exec || exec.running) return exec?.running
    ? <div className="out"><pre style={{ color: "var(--color-accent)" }}>running…</pre></div> : null;
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

export default function Workbench({ models, thread, onThread }) {
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [mode, setMode] = useState("prompt"); // "prompt" | "code"
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef(null);

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

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [thread, busy]);

  function patch(id, p) { onThread(thread.map((t) => (t.id === id ? { ...t, ...p } : t))); }

  function buildMessages(items) {
    return items.map((t) => {
      if (t.role === "user") return { role: "user", content: t.text || "" };
      if (t.role === "assistant") {
        let c = t.text && t.text !== "…" ? t.text : "";
        if (t.code) c += `\n\n\`\`\`python\n${t.code}\n\`\`\``;
        if (t.execSummary) c += `\n\n[result]\n${t.execSummary}`;
        return { role: "assistant", content: c || "(ran code)" };
      }
      // code turn -> feed as user context so the model remembers it
      return { role: "user", content: `I ran:\n\`\`\`python\n${t.code}\n\`\`\``
        + (t.execSummary ? `\n[result]\n${t.execSummary}` : "") };
    });
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
      const entry = { id: uid(), role: "code", code: input, execution: { running: true } };
      onThread([...thread, entry]);
      const r = await post("/api/v1/kernel/run", { code: input });
      const exec = r.data || {};
      onThread([...thread, { ...entry, execution: exec, execSummary: summarizeExec(exec) }]);
      return;
    }

    if (!provider || !model) return;
    const userEntry = { id: uid(), role: "user", text: input };
    const pendingId = uid();
    const base = [...thread, userEntry];
    onThread([...base, { id: pendingId, role: "assistant", text: "…" }]);
    setBusy(true);
    const r = await post("/api/v1/agent", {
      provider: provider.id, model: model.id, messages: buildMessages(base), max_tokens: 1024,
    });
    setBusy(false);
    if (!r.success) {
      onThread([...base, { id: pendingId, role: "assistant", text: r.message, meta: "error" }]);
      return;
    }
    const d = r.data;
    onThread([...base, {
      id: pendingId, role: "assistant", text: d.text, code: d.code || null,
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
        {model && (
          <p className="model-meta">
            <span className={"badge " + model.tier}>{model.tier}</span> {model.cost_hint}
            {provider && !provider.ready &&
              <> · <span style={{ color: "var(--color-warning)" }}>needs {provider.env_var}</span></>}
          </p>
        )}

        <div className="thread" ref={logRef}>
          {thread.length === 0 && (
            <p className="placeholder">Ask in plain English — e.g. <i>“get the last 100 daily closes of
            SPY, split &amp; dividend adjusted, as date + price”</i> — then follow up with <i>“now plot
            it.”</i> The model writes the code, it runs here, and results appear below. Switch to
            <b> Code</b> to write Python yourself.</p>
          )}
          {thread.map((t) => (
            <div key={t.id} className="turn">
              {t.role === "user" && <div className="msg user"><span>{t.text}</span></div>}
              {(t.role === "assistant" || t.role === "code") && (
                <div className="msg assistant">
                  {t.text === "…" ? <span>…</span> : t.text && <div className="answer">{t.text}</div>}
                  {t.code != null && (
                    <div className="code-block">
                      <div className="code-head">
                        <span>python</span><div className="spacer" />
                        <button className="ghost" onClick={() => runCode(t.id, t.code)}>▶ Re-run</button>
                      </div>
                      <textarea spellCheck={false} value={t.code}
                        onChange={(e) => patch(t.id, { code: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.shiftKey || e.metaKey || e.ctrlKey)) {
                            e.preventDefault(); runCode(t.id, t.code);
                          }
                        }} />
                    </div>
                  )}
                  {t.execution ? <ExecOutput exec={t.execution} />
                    : t.execSummary ? <pre className="exec-summary">{t.execSummary}</pre> : null}
                  {t.meta && <span className="meta">{t.meta}</span>}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="msg assistant"><span>…</span></div>}
        </div>

        <div className="chat-input">
          <textarea value={text}
            style={mode === "code" ? { fontFamily: "var(--font-mono)", fontSize: "12.5px" } : undefined}
            placeholder={mode === "prompt"
              ? "Ask for data or analysis…  (Enter to send, Shift+Enter for newline)"
              : "# Python — runs in the shared kernel  (Shift+Enter to run)"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              const submit = mode === "code" ? (e.shiftKey || e.metaKey || e.ctrlKey) : !e.shiftKey;
              if (e.key === "Enter" && submit) { e.preventDefault(); send(); }
            }} />
          <button className="brand" onClick={send} disabled={busy}>{mode === "code" ? "Run" : "Send"}</button>
        </div>
      </div>
    </div>
  );
}
