import { useEffect, useState } from "react";
import { api, put } from "./lib/api.js";
import StatusBar from "./components/StatusBar.jsx";
import Workbench from "./components/Workbench.jsx";
import Memory from "./components/Memory.jsx";

const PROJECT_ID = "chapters-1-2";
const TABS = [
  { id: "learn", label: "Learn · Ch 1–2" },
  { id: "strategies", label: "Strategies", soon: true },
  { id: "assets", label: "Asset management", soon: true },
  { id: "about", label: "About" },
];

function readTheme() {
  try { return localStorage.getItem("tg.theme") || "light"; } catch { return "light"; }
}

// Keep storage light: drop base64 figures / big HTML from the saved thread.
function stripThread(thread) {
  return thread.map((t) => ({
    id: t.id, role: t.role, text: t.text, code: t.code,
    meta: t.meta, execSummary: t.execSummary,
  }));
}

export default function App() {
  const [theme, setTheme] = useState(readTheme());
  const [tab, setTab] = useState("learn");
  const [models, setModels] = useState([]);
  const [notes, setNotes] = useState("");
  const [thread, setThread] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("tg.theme", theme); } catch {}
  }, [theme]);

  useEffect(() => {
    api("/api/v1/models").then((r) => setModels(r.data || []));
    api(`/api/v1/projects/${PROJECT_ID}`).then((r) => {
      const p = r.data || {};
      setNotes(p.notes || "");
      setThread(Array.isArray(p.chat) ? p.chat : []);
      setLoaded(true);
    });
  }, []);

  // Debounced autosave of the whole workspace after any change (post-load only).
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      put(`/api/v1/projects/${PROJECT_ID}`, { notes, chat: stripThread(thread), cells: [] })
        .then(() => setSavedAt(Date.now()));
    }, 700);
    return () => clearTimeout(t);
  }, [notes, thread, loaded]);

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

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={"tab" + (tab === t.id ? " active" : "")}
            onClick={() => setTab(t.id)}>
            {t.label}{t.soon && <span className="soon">soon</span>}
          </button>
        ))}
      </nav>

      <main>
        {tab === "learn" && (
          <div className="learn">
            <Workbench models={models} thread={thread} onThread={setThread} />
            <div className="col">
              <Memory notes={notes} onNotes={setNotes} savedAt={savedAt} />
            </div>
          </div>
        )}

        {tab === "strategies" && (
          <div className="panel"><div className="panel-body">
            <p className="placeholder">Your own trading strategies live here — each as a project with a
            backtest, metrics (Sharpe, drawdown), and the model chat that helped build it. Built on the
            <code> genai_trader</code> library, not tied to the book.</p>
          </div></div>
        )}
        {tab === "assets" && (
          <div className="panel"><div className="panel-body">
            <p className="placeholder">Asset-management views — portfolio construction, risk, and allocation.</p>
          </div></div>
        )}
        {tab === "about" && (
          <div className="panel"><div className="panel-body">
            <p className="placeholder">trade_genai is a research and trading lab. It started from the book
            <i> Generative AI for Trading and Asset Management</i> but is evolving into original strategy
            work. React + Vite frontend, FastAPI backend, multi-provider model chat.</p>
          </div></div>
        )}
      </main>
    </>
  );
}
