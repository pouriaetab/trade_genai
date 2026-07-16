import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

export default function StatusBar() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    api("/api/v1/status").then((r) => setStatus(r.data || null));
  }, []);

  if (!status) return <div className="status"><span className="pill">connecting…</span></div>;
  const massive = status.massive || {};
  const ready = (status.providers || []).filter((p) => p.ready).map((p) => p.label);
  return (
    <div className="status">
      <span className="pill">massive {massive.configured ? massive.key : "—"}</span>
      <span className="pill">
        {ready.length ? "chat: " + ready.join(", ") : "chat: add a key"}
      </span>
    </div>
  );
}
