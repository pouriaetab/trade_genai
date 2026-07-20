import { useEffect, useState } from "react";
import { api, post, put } from "../../lib/api.js";

const empty = { name: "", rest_url: "", api_key: "" };

export default function DataProviders() {
  const [providers, setProviders] = useState([]);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = () => api("/api/v1/settings/data-providers").then((r) => setProviders(r.data?.providers || []));
  useEffect(() => { load(); }, []);

  async function addProvider(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await post("/api/v1/settings/data-providers", form);
    setBusy(false);
    if (!r.success) { setError(r.message); return; }
    setForm(empty);
    load();
  }

  async function toggleEnabled(p) {
    await put(`/api/v1/settings/data-providers/${p.id}/enabled`, { enabled: !p.enabled });
    load();
  }
  async function makeActive(p) {
    await put(`/api/v1/settings/data-providers/${p.id}/active`, {});
    load();
  }
  async function removeProvider(p) {
    const verb = p.removable ? "permanently delete" : "disable";
    if (!confirm(`${verb === "disable" ? "Disable" : "Delete"} "${p.name}"?`)) return;
    await api(`/api/v1/settings/data-providers/${p.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="settings-section">
      <p className="lead">
        Market-data providers. <code>MASSIVE_API_KEY</code> in <code>.env.local</code> is
        auto-detected as the built-in "Massive" provider — the technical path. Non-technical?
        Add a provider right here instead; its key stays server-side and only ever shows masked.
        Any Polygon-compatible REST API works out of the box (same aggs/dividends endpoint shape);
        a different response shape needs a small adapter in <code>genai_trader/data/massive.py</code>.
      </p>

      <table className="rd-table settings-table">
        <thead><tr><th>Name</th><th>Source</th><th>Key</th><th>Active</th><th>Enabled</th><th></th></tr></thead>
        <tbody>
          {providers.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td><span className={"src-tag " + p.source}>{p.source}</span></td>
              <td>{p.configured ? p.masked_key : <span className="err-text">not set</span>}</td>
              <td>
                <button className={"ghost" + (p.active ? " on" : "")} disabled={!p.enabled || !p.configured}
                  onClick={() => makeActive(p)}>{p.active ? "★ active" : "make active"}</button>
              </td>
              <td>
                <button className="ghost" onClick={() => toggleEnabled(p)}>{p.enabled ? "on" : "off"}</button>
              </td>
              <td>
                <button className="ghost" onClick={() => removeProvider(p)}>
                  {p.removable ? "delete" : "disable"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form className="ef-row settings-form" onSubmit={addProvider}>
        <label className="ef-field ef-field-wide">
          <span>Provider name</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Polygon.io" required />
        </label>
        <label className="ef-field ef-field-wide">
          <span>REST base URL</span>
          <input value={form.rest_url} onChange={(e) => setForm({ ...form, rest_url: e.target.value })}
            placeholder="https://api.polygon.io" required />
        </label>
        <label className="ef-field ef-field-wide">
          <span>API key</span>
          <input type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })}
            placeholder="key stays server-side" required />
        </label>
        <button className="brand" type="submit" disabled={busy}>{busy ? "Adding…" : "Add provider"}</button>
      </form>
      {error && <div className="err ef-error"><pre>{error}</pre></div>}
    </div>
  );
}
