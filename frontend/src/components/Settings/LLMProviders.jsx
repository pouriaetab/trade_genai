import { useEffect, useState } from "react";
import { api, post, put } from "../../lib/api.js";

const emptyProvider = { label: "", base_url: "", api_key: "", has_free_tier: false };
const emptyModel = { id: "", label: "", tier: "paid", input_price: 0, output_price: 0, context: 128000 };

function ModelRow({ providerId, model, onChanged }) {
  const removed = model.source === "removed"; // not used yet, reserved
  async function remove() {
    if (!confirm(`Remove model "${model.label}" from this provider's list?`)) return;
    await api(`/api/v1/settings/llm-providers/${providerId}/models/${encodeURIComponent(model.id)}`, { method: "DELETE" });
    onChanged();
  }
  return (
    <tr>
      <td>{model.label}</td>
      <td><span className={"src-tag " + model.source}>{model.source}</span></td>
      <td>{model.tier}</td>
      <td>{model.cost_hint}</td>
      <td><button className="ghost" onClick={remove}>remove</button></td>
    </tr>
  );
}

function ProviderCard({ provider, onChanged }) {
  const [showAddModel, setShowAddModel] = useState(false);
  const [modelForm, setModelForm] = useState(emptyModel);
  const [keyForm, setKeyForm] = useState("");
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  async function removeProvider() {
    if (!confirm(`Remove provider "${provider.label}"? Its models go with it.`)) return;
    await api(`/api/v1/settings/llm-providers/${provider.id}`, { method: "DELETE" });
    onChanged();
  }
  async function restoreProvider() {
    await post(`/api/v1/settings/llm-providers/${provider.id}/restore`, {});
    onChanged();
  }
  async function addModel(e) {
    e.preventDefault();
    setBusy(true);
    const r = await post(`/api/v1/settings/llm-providers/${provider.id}/models`, modelForm);
    setBusy(false);
    if (r.success) { setModelForm(emptyModel); setShowAddModel(false); onChanged(); }
    else setNote(r.message);
  }
  async function saveKey(e) {
    e.preventDefault();
    setBusy(true);
    const r = await put(`/api/v1/settings/llm-providers/${provider.id}/key`, { api_key: keyForm });
    setBusy(false);
    if (r.success) { setKeyForm(""); setShowKeyForm(false); onChanged(); }
    else setNote(r.message);
  }
  async function refresh() {
    setBusy(true); setNote(null);
    const r = await post(`/api/v1/settings/llm-providers/${provider.id}/refresh`, {});
    setBusy(false);
    setNote(r.message);
    if (r.success) onChanged();
  }

  return (
    <div className="rd-card open llm-provider-card">
      <div className="rd-card-head llm-provider-head">
        <span className={"src-tag " + provider.source}>{provider.source}</span>
        <span className="rd-card-title">{provider.label}</span>
        <span className={"pill" + (provider.ready ? "" : " needs-key")}>
          {provider.ready ? "ready" : "needs a key"}
        </span>
        <div className="spacer" />
        <button className="ghost" onClick={() => setShowKeyForm((v) => !v)}>set key</button>
        <button className="ghost" disabled={busy} onClick={refresh}>refresh models</button>
        {provider.source === "default"
          ? <button className="ghost" onClick={removeProvider}>remove</button>
          : <button className="ghost" onClick={removeProvider}>delete</button>}
      </div>
      <div className="rd-card-body">
        {showKeyForm && (
          <form className="ef-row" onSubmit={saveKey}>
            <label className="ef-field ef-field-wide">
              <span>API key for {provider.label}</span>
              <input type="password" value={keyForm} onChange={(e) => setKeyForm(e.target.value)}
                placeholder="stored server-side, shown masked afterward" required />
            </label>
            <button className="brand" type="submit" disabled={busy}>Save key</button>
          </form>
        )}
        {note && <p className="hint">{note}</p>}

        <table className="rd-table settings-table">
          <thead><tr><th>Model</th><th>Source</th><th>Tier</th><th>Cost</th><th></th></tr></thead>
          <tbody>
            {(provider.models || []).map((m) => (
              <ModelRow key={m.id} providerId={provider.id} model={m} onChanged={onChanged} />
            ))}
          </tbody>
        </table>

        {!showAddModel ? (
          <button className="ghost" onClick={() => setShowAddModel(true)}>+ add a model</button>
        ) : (
          <form className="ef-row" onSubmit={addModel}>
            <label className="ef-field"><span>Model id (exact API name)</span>
              <input value={modelForm.id} onChange={(e) => setModelForm({ ...modelForm, id: e.target.value })} required /></label>
            <label className="ef-field"><span>Label</span>
              <input value={modelForm.label} onChange={(e) => setModelForm({ ...modelForm, label: e.target.value })} /></label>
            <label className="ef-field"><span>Tier</span>
              <select value={modelForm.tier} onChange={(e) => setModelForm({ ...modelForm, tier: e.target.value })}>
                <option value="free">free</option><option value="paid">paid</option>
              </select></label>
            <button className="brand" type="submit" disabled={busy}>Add</button>
            <button className="ghost" type="button" onClick={() => setShowAddModel(false)}>cancel</button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function LLMProviders() {
  const [providers, setProviders] = useState([]);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [providerForm, setProviderForm] = useState(emptyProvider);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = () => api("/api/v1/settings/llm-providers").then((r) => setProviders(r.data || []));
  useEffect(() => { load(); }, []);

  async function addProvider(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await post("/api/v1/settings/llm-providers", providerForm);
    setBusy(false);
    if (!r.success) { setError(r.message); return; }
    setProviderForm(emptyProvider); setShowAddProvider(false);
    load();
  }

  return (
    <div className="settings-section">
      <p className="lead">
        The picker starts with recent models from Gemini, Groq, OpenRouter, Anthropic, OpenAI, and
        xAI — curated defaults, editable here. Remove any default provider or model you don't want,
        add a custom model id to an existing provider, or add a whole new OpenAI-compatible provider
        (most APIs — Together, Fireworks, DeepSeek, etc. — speak this format). "Refresh models"
        calls that provider's own model list and merges in anything new. Everything sticks across
        restarts.
      </p>

      <div className="rd-list">
        {providers.map((p) => <ProviderCard key={p.id} provider={p} onChanged={load} />)}
      </div>

      {!showAddProvider ? (
        <button className="ghost" style={{ marginTop: 12 }} onClick={() => setShowAddProvider(true)}>
          + add a custom provider
        </button>
      ) : (
        <form className="ef-row settings-form" onSubmit={addProvider}>
          <label className="ef-field ef-field-wide"><span>Provider label</span>
            <input value={providerForm.label} onChange={(e) => setProviderForm({ ...providerForm, label: e.target.value })}
              placeholder="e.g. Together AI" required /></label>
          <label className="ef-field ef-field-wide"><span>Base URL (OpenAI-compatible)</span>
            <input value={providerForm.base_url} onChange={(e) => setProviderForm({ ...providerForm, base_url: e.target.value })}
              placeholder="https://api.together.xyz/v1" required /></label>
          <label className="ef-field ef-field-wide"><span>API key</span>
            <input type="password" value={providerForm.api_key} onChange={(e) => setProviderForm({ ...providerForm, api_key: e.target.value })}
              placeholder="stored server-side" /></label>
          <button className="brand" type="submit" disabled={busy}>{busy ? "Adding…" : "Add provider"}</button>
          <button className="ghost" type="button" onClick={() => setShowAddProvider(false)}>cancel</button>
        </form>
      )}
      {error && <div className="err ef-error"><pre>{error}</pre></div>}
    </div>
  );
}
