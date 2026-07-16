import { useEffect, useMemo, useRef, useState } from "react";
import { post } from "../lib/api.js";

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
  const nothing = !exec.stdout && !exec.result_html && !exec.result_text && !(exec.figures || []).length && !exec.error;
  return (
    <div className="out" style={{ marginTop: 8, borderRadius: 8, border: "1px solid var(--color-border)" }}>
      {exec.stdout && exec.stdout.trim() && <pre>{exec.stdout}</pre>}
      {exec.result_html && <div dangerouslySetInnerHTML={{ __html: exec.result_html }} />}
      {exec.result_text && <pre>{exec.result_text}</pre>}
      {(exec.figures || []).map((f, i) => <img key={i} src={`data:image/png;base64,${f}`} alt="chart" />)}
      {exec.error && <div className="err"><pre>{exec.error}</pre></div>}
      {nothing && <pre style={{ color: "var(--color-text-muted)" }}>(no output)</pre>}
    </div>
  );
}

export default function ModelChat({ models, conversation, onConversation }) {
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [mode, setMode] = useState("prompt"); // "prompt" | "code"
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef(null);

  // Robustly keep provider + model valid whenever the registry loads/changes.
  useEffect(() => {
    if (!models.length) return;
    if (!models.find((p) => p.id === providerId)) {
      const pref = models.find((p) => p.ready) || models.find((p) => p.has_free_tier) || models[0];
      setProviderId(pref.id);
      return;
    }
    const prov = models.find((p) => p.id === providerId);
    if (prov && !prov.models.find((m) => m.id === modelId)) {
      setModelId(prov.models[0]?.id || "");
    }
  }, [models, providerId, modelId]);

  const provider = useMemo(() => models.find((p) => p.id === providerId) || null, [models, providerId]);
  const model = useMemo(
    () => (provider ? provider.models.find((m) => m.id === modelId) : null),
    [provider, modelId]
  );

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [conversation, busy]);

  function buildModelMessages(conv) {
    return conv
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        let content = m.content || "";
        if (m.execSummary) content += "\n\n[kernel result]\n" + m.execSummary;
        return { role: m.role, content: content || "(ran code)" };
      });
  }

  async function send() {
    const input = text.trim();
    if (!input || busy) return;
    setText("");

    if (mode === "code") {
      const conv2 = [...conversation, { role: "user", content: input, isCode: true }];
      onConversation(conv2);
      setBusy(true);
      const r = await post("/api/v1/kernel/run", { code: input });
      setBusy(false);
      const exec = r.data || {};
      onConversation([...conv2, {
        role: "assistant", content: "", execution: exec, execSummary: summarizeExec(exec), meta: "kernel",
      }]);
      return;
    }

    if (!provider || !model) return;
    const conv2 = [...conversation, { role: "user", content: input }];
    onConversation(conv2);
    setBusy(true);
    const r = await post("/api/v1/agent", {
      provider: provider.id, model: model.id,
      messages: buildModelMessages(conv2), max_tokens: 1024,
    });
    setBusy(false);
    if (!r.success) {
      onConversation([...conv2, { role: "assistant", content: r.message, meta: "error" }]);
      return;
    }
    const d = r.data;
    onConversation([...conv2, {
      role: "assistant",
      content: d.text,
      execution: d.execution,
      execSummary: summarizeExec(d.execution),
      meta: `${d.model} · ~$${(d.est_cost_usd || 0).toFixed(4)}`,
    }]);
  }

  if (!models.length) {
    return (
      <div className="panel"><div className="panel-head"><h2>Ask a model</h2></div>
        <div className="panel-body">
          <p className="placeholder">No models loaded — is the backend running on <code>:8003</code>?
          Start it with <code>./run.sh</code>, then reload.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Ask a model</h2>
        <div className="spacer" />
        <div className="mode-toggle">
          <button className={mode === "prompt" ? "on" : "ghost"} onClick={() => setMode("prompt")}>Prompt</button>
          <button className={mode === "code" ? "on" : "ghost"} onClick={() => setMode("code")}>Code</button>
        </div>
      </div>
      <div className="panel-body">
        <div className="picker">
          <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            {models.map((p) => (
              <option key={p.id} value={p.id}>{p.label}{p.ready ? "" : "  (add key)"}</option>
            ))}
          </select>
          <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
            {(provider?.models || []).map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>

        {model && (
          <p className="model-meta">
            <span className={"badge " + model.tier}>{model.tier}</span>{" "}
            {model.cost_hint} · {model.context.toLocaleString()} ctx
            {provider && !provider.ready && (
              <> · <span style={{ color: "var(--color-warning)" }}>needs {provider.env_var}</span></>
            )}
            <br /><span style={{ color: "var(--color-text-muted)" }}>{model.note}</span>
          </p>
        )}

        <div className="chat-log" ref={logRef}>
          {conversation.map((m, i) => (
            <div key={i} className={"msg " + m.role}>
              {m.isCode ? <pre style={{ margin: 0 }}>{m.content}</pre> : m.content && <span>{m.content}</span>}
              {m.execution ? <ExecOutput exec={m.execution} />
                : m.execSummary ? <pre style={{ marginTop: 6 }}>{m.execSummary}</pre> : null}
              {m.role === "assistant" && <span className="meta">{m.meta || "saved"}</span>}
            </div>
          ))}
          {busy && <div className="msg assistant"><span>…</span></div>}
        </div>

        <div className="chat-input">
          <textarea
            value={text}
            style={mode === "code" ? { fontFamily: "var(--font-mono)", fontSize: "12.5px" } : undefined}
            placeholder={mode === "prompt"
              ? "e.g. Get the 100 most recent daily closes for AAPL and show them"
              : "# Python — runs in the shared kernel"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              const submit = mode === "code" ? (e.shiftKey || e.metaKey || e.ctrlKey) : !e.shiftKey;
              if (e.key === "Enter" && submit) { e.preventDefault(); send(); }
            }}
          />
          <button className="brand" onClick={send} disabled={busy}>
            {mode === "code" ? "Run" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
