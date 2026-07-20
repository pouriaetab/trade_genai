import { useEffect, useMemo, useState } from "react";
import { api, put } from "./lib/api.js";
import StatusBar from "./components/StatusBar.jsx";
import SessionTabs from "./components/SessionTabs.jsx";
import Workbench from "./components/Workbench.jsx";
import Memory from "./components/Memory.jsx";
import RD from "./components/RD/index.jsx";
import Settings from "./components/Settings/index.jsx";

const uid = () => (globalThis.crypto?.randomUUID?.() || `s${Date.now()}${Math.random()}`);
const newSession = (name) => ({ id: uid(), name, cells: [], notes: "", archived: false });

// The two top-level pages. Ids are fixed (used for routing/state), but the
// labels are just a starting point — double-click either tab to rename it to
// whatever fits your project; the name is saved in this browser only.
const PAGE_IDS = ["lab", "rd", "settings"];
const DEFAULT_PAGE_LABELS = { lab: "Notebook / Lab", rd: "R&D", settings: "Settings" };

function readTheme() {
  try { return localStorage.getItem("tg.theme") || "light"; } catch { return "light"; }
}
function readPage() {
  try { return localStorage.getItem("tg.page") || "lab"; } catch { return "lab"; }
}
function readPageLabels() {
  try {
    const saved = JSON.parse(localStorage.getItem("tg.pageLabels") || "null");
    if (saved && typeof saved === "object") return { ...DEFAULT_PAGE_LABELS, ...saved };
  } catch {}
  return { ...DEFAULT_PAGE_LABELS };
}

// Keep storage light: drop base64 figures / big HTML from saved cells.
function stripSessions(sessions) {
  return sessions.map((s) => ({
    id: s.id, name: s.name, notes: s.notes, archived: !!s.archived,
    cells: (s.cells || []).map((c) => ({
      id: c.id, kind: c.kind, input: c.input, answer: c.answer,
      code: c.code, meta: c.meta, execSummary: c.execSummary, pinned: !!c.pinned,
    })),
  }));
}

export default function App() {
  const [theme, setTheme] = useState(readTheme());
  const [page, setPage] = useState(readPage());
  const [pageLabels, setPageLabels] = useState(readPageLabels());
  const [editingPage, setEditingPage] = useState(null);
  const [models, setModels] = useState([]);
  const [activeModel, setActiveModel] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("tg.theme", theme); } catch {}
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem("tg.page", page); } catch {}
  }, [page]);

  useEffect(() => {
    try { localStorage.setItem("tg.pageLabels", JSON.stringify(pageLabels)); } catch {}
  }, [pageLabels]);

  // Restore the workspace (all tabs) once. Only treat a *successful* response
  // with a genuinely empty workspace as "start fresh" — a failed or unreachable
  // backend must never fall through to creating (and then autosaving) a blank
  // session over the top of real saved data. `loaded` (which arms autosave)
  // is only set on confirmed success.
  useEffect(() => {
    api("/api/v1/models").then((r) => setModels(r.data || [])).catch(() => setModels([]));
    api("/api/v1/workspace")
      .then((r) => {
        if (!r || r.success !== true) { setLoadError(true); return; }
        const w = r.data || {};
        let ss = Array.isArray(w.sessions) ? w.sessions : [];
        if (!ss.length) ss = [newSession("Notebook 1")];
        setSessions(ss);
        const firstVisible = ss.find((s) => !s.archived) || ss[0];
        setActiveId(ss.find((s) => s.id === w.activeId && !s.archived) ? w.activeId : firstVisible.id);
        setLoaded(true);
      })
      .catch(() => setLoadError(true));
  }, []);

  // Debounced autosave of the whole workspace after any change. Gated on
  // `loaded`, which is only ever set after a confirmed successful load —
  // see above — so a backend hiccup can't silently overwrite saved sessions.
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      put("/api/v1/workspace", { sessions: stripSessions(sessions), activeId })
        .then(() => setSavedAt(Date.now()));
    }, 700);
    return () => clearTimeout(t);
  }, [sessions, activeId, loaded]);

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) || sessions.find((s) => !s.archived) || sessions[0] || null,
    [sessions, activeId]
  );

  const patchActive = (p) =>
    setSessions((ss) => ss.map((s) => (s.id === active.id ? { ...s, ...p } : s)));

  function addSession() {
    const s = newSession(`Notebook ${sessions.length + 1}`);
    setSessions((cur) => [...cur, s]);
    setActiveId(s.id);
  }
  function renameSession(id, name) {
    setSessions((ss) => ss.map((s) => (s.id === id ? { ...s, name } : s)));
  }
  function deleteSession(id) {
    setSessions((ss) => {
      const rest = ss.filter((s) => s.id !== id);
      const next = rest.length ? rest : [newSession("Notebook 1")];
      if (id === activeId) {
        const nextVisible = next.find((s) => !s.archived) || next[0];
        setActiveId(nextVisible.id);
      }
      return next;
    });
  }
  function archiveSession(id) {
    setSessions((ss) => {
      const next = ss.map((s) => (s.id === id ? { ...s, archived: true } : s));
      if (id === activeId) {
        const nextVisible = next.find((s) => !s.archived);
        setActiveId(nextVisible ? nextVisible.id : id);
      }
      return next;
    });
  }
  function restoreSession(id) {
    setSessions((ss) => ss.map((s) => (s.id === id ? { ...s, archived: false } : s)));
    setActiveId(id);
  }
  function renamePage(id, label) {
    setPageLabels((cur) => ({ ...cur, [id]: label }));
  }

  return (
    <>
      <header className="app-header">
        <div className="brand-dot" />
        <div>
          <h1>trade_genai</h1>
          <div className="sub">A local, plug-and-play workbench for AI-assisted quant research</div>
        </div>
        <div className="spacer" />
        <StatusBar activeModel={activeModel} />
        <button className="ghost" title="Toggle theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>◐</button>
      </header>

      <div className="tabs">
        {PAGE_IDS.map((id) => (
          editingPage === id ? (
            <input
              key={id}
              className="tab-input"
              autoFocus
              defaultValue={pageLabels[id]}
              onBlur={(e) => { renamePage(id, e.target.value.trim() || pageLabels[id]); setEditingPage(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.target.blur();
                if (e.key === "Escape") setEditingPage(null);
              }}
            />
          ) : (
            <button key={id} className={"tab" + (page === id ? " active" : "")}
              onClick={() => setPage(id)} onDoubleClick={() => setEditingPage(id)}
              title="Double-click to rename this tab">
              {pageLabels[id]}
            </button>
          )
        ))}
      </div>

      {loadError && !loaded && (
        <main>
          <div className="panel" style={{ borderColor: "var(--color-error)" }}>
            <div className="panel-body">
              <p className="placeholder">
                Couldn't load your saved tabs from the backend — nothing has been
                changed or lost, this is just a failed connection. Make sure the
                backend is running (<code>./run.sh</code>, or check <code>:8003</code>),
                then <button className="ghost" onClick={() => window.location.reload()}>reload</button>.
              </p>
            </div>
          </div>
        </main>
      )}

      {page === "lab" && active && (
        <>
          <SessionTabs
            sessions={sessions} activeId={active.id}
            onSwitch={setActiveId} onAdd={addSession}
            onRename={renameSession} onDelete={deleteSession}
            onArchive={archiveSession} onRestore={restoreSession}
          />
          <main>
            <div className="learn">
              <Workbench
                key={active.id}
                models={models}
                cells={active.cells || []}
                onCells={(cells) => patchActive({ cells })}
                onModelChange={setActiveModel}
              />
              <div className="col">
                <Memory notes={active.notes || ""} onNotes={(notes) => patchActive({ notes })}
                  savedAt={savedAt} />
              </div>
            </div>
          </main>
        </>
      )}

      {page === "rd" && (
        <main>
          <RD />
        </main>
      )}

      {page === "settings" && (
        <main>
          <Settings />
        </main>
      )}
    </>
  );
}
