import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

export default function StatusBar({ activeModel }) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    api("/api/v1/status").then((r) => setStatus(r.data || null));
  }, []);

  if (!status) return <div className="status"><span className="pill">connecting…</span></div>;
  const dataProviders = status.data_providers || [];
  const activeData = dataProviders.find((p) => p.active) || dataProviders[0];
  const ready = (status.providers || []).filter((p) => p.ready).map((p) => p.label);

  return (
    <div className="status">
      <span className="pill" title="The market-data provider currently active — masked API key, just a sanity check that the right one loaded. Manage providers in Settings.">
        data: {activeData ? `${activeData.name} ${activeData.configured ? activeData.masked_key : "(no key)"}` : "none configured"}
      </span>
      <span className="pill" title="LLM providers with a working API key">
        {ready.length ? "chat: " + ready.join(", ") : "chat: add a key"}
      </span>
      {activeModel && (
        <span className="pill" title="The model currently selected in the Workbench picker">
          using: {activeModel.providerLabel} · {activeModel.modelLabel}
          {!activeModel.ready && " (needs key)"}
        </span>
      )}
    </div>
  );
}
