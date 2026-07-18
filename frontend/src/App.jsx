import { useEffect, useMemo, useState } from "react";
import { api, put } from "./lib/api.js";
import StatusBar from "./components/StatusBar.jsx";
import SessionTabs from "./components/SessionTabs.jsx";
import Workbench from "./components/Workbench.jsx";
import Memory from "./components/Memory.jsx";

const uid = () => (globalThis.crypto?.randomUUID?.() || `s${Date.now()}${Math.random()}`);
const newSession = (name) => ({ id: uid(), name, cells: [], notes: "" });

function readTheme() {
  try { return localStorage.getItem("tg.theme") || "light"; } catch { return "light"; }
}

// Keep storage light: drop base64 figures / big HTML from saved cells.
function stripSessions(sessions) {
  return sessions.map((s) => ({
    id: s.id, name: s.name, notes: s.notes,
    cells: (s.cells || []).map((c) => ({
      id: c.id, kind: c.kind, input: c.input, answer: c.answer,
      code: c.code, meta: c.meta, execSummary: c.execSummary,
    })),
  }));
}

export default function App() {
  const [theme, setTheme] = useState(readTheme());
  const [models, setModels] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("tg.theme", theme); } catch {}
  }, [theme]);

  // Restore the workspace (all tabs) once.
  useEffect(() => {
    api("/api/v1/models").then((r) => setModels(r.data || []));
    api("/api/v1/workspace").then((r) => {
      const w = r.data || {};
      let ss = Array.isArray(w.sessions) ? w.sessions : [];
      if (!ss.length) ss = [newSession("Chapter 1")];
      setSessions(ss);
      setActiveId(ss.find((s) => s.id === w.activeId) ? w.activeId : ss[0].id);
      setLoaded(true);
    });
  }, []);

  // Debounced autosave of the whole workspace after any change.
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      put("/api/v1/workspace", { sessions: stripSessions(sessions), activeId })
        .then(() => setSavedAt(Date.now()));
    }, 700);
    return () => clearTimeout(t);
  }, [sessions, activeId, loaded]);

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) || sessions[0] || null,
    [sessions, activeId]
  );

  const patchActive = (p) =>
    setSessions((ss) => ss.map((s) => (s.id === active.id ? { ...s, ...p } : s)));

  function addSession() {
    const s = newSession(`Chapter ${sessions.length + 1}`);
    setSessions((cur) => [...cur, s]);
    setActiveId(s.id);
  }
  function renameSession(id, name) {
    setSessions((ss) => ss.map((s) => (s.id === id ? { ...s, name } : s)));
  }
  function deleteSession(id) {
    setSessions((ss) => {
      const rest = ss.filter((s) => s.id !== id);
      const next = rest.length ? rest : [newSession("Chapter 1")];
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  }

  return (
    <>
      <header className="app-header">
        <div className="brand-dot" />
        <div>
          <h1>trade_genai</h1>
          <div className="sub">Generative AI for Trading &amp; Asset Management — hands-on lab</div>
        </div>
        <div className="spacer" />
        <StatusBar />
        <button className="ghost" title="Toggle theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>◐</button>
      </header>

      {active && (
        <>
          <SessionTabs
            sessions={sessions} activeId={active.id}
            onSwitch={setActiveId} onAdd={addSession}
            onRename={renameSession} onDelete={deleteSession}
          />
          <main>
            <div className="learn">
              <Workbench
                key={active.id}
                models={models}
                cells={active.cells || []}
                onCells={(cells) => patchActive({ cells })}
              />
              <div className="col">
                <Memory notes={active.notes || ""} onNotes={(notes) => patchActive({ notes })}
                  savedAt={savedAt} />
              </div>
            </div>
          </main>
        </>
      )}
    </>
  );
}
