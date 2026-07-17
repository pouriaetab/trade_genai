import { post } from "../lib/api.js";

const CH1 = `# Chapter 1 — last 100 trading days of SPY, split + dividend adjusted
from genai_trader.lessons.ch01_spy_returns import run
res = run("SPY", 100)

print("Raw (tail):")
print(res["raw"].tail().to_string(index=False))
print("\\nAnnualized Sharpe:", round(res["sharpe"], 2))
res["returns"].tail(10)   # [date, daily_return]`;

const uid = () =>
  (globalThis.crypto?.randomUUID?.() || `c${Date.now()}${Math.random()}`);
const newCell = (code = "") => ({ id: uid(), code, out: null });

// Controlled by App so cells persist across sessions.
export default function Notebook({ cells, onChange }) {
  const patch = (id, p) => onChange(cells.map((c) => (c.id === id ? { ...c, ...p } : c)));

  function insertAfter(id, code = "") {
    const i = cells.findIndex((c) => c.id === id);
    const copy = [...cells];
    copy.splice(i + 1, 0, newCell(code));
    onChange(copy);
  }
  function remove(id) {
    if (cells.length > 1) onChange(cells.filter((c) => c.id !== id));
  }
  async function runCell(id, code) {
    patch(id, { out: { running: true } });
    const r = await post("/api/v1/kernel/run", { code });
    patch(id, { out: r.data || {} });
  }
  async function reset() {
    await post("/api/v1/kernel/reset", {});
    onChange(cells.map((c) => ({ ...c, out: null })));
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Notebook — run book code, see results</h2>
        <div className="spacer" />
        <button className="ghost" onClick={() => onChange([...cells, newCell(CH1)])}>
          Load Ch 1 · SPY returns
        </button>
        <button className="ghost" onClick={reset}>Reset</button>
      </div>
      <div className="panel-body">
        <p className="lead">Paste a code chunk and press <kbd>Shift</kbd>+<kbd>Enter</kbd>.
          State persists between cells; <code>pd</code>, <code>np</code>, <code>plt</code> and the
          <code> genai_trader</code> helpers are preloaded. Add a cell anywhere with <b>+</b>.
          Your cells are saved automatically.</p>
        {cells.map((c) => (
          <div key={c.id}>
            <div className="cell">
              <div className="cell-head">
                <span className="lbl">py</span><div className="spacer" />
                <button className="ghost" onClick={() => runCell(c.id, c.code)}>▶ Run</button>
                <button className="ghost" onClick={() => remove(c.id)}>✕</button>
              </div>
              <textarea
                spellCheck={false}
                value={c.code}
                placeholder="# paste code here"
                onChange={(e) => patch(c.id, { code: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.shiftKey || e.metaKey || e.ctrlKey)) {
                    e.preventDefault(); runCell(c.id, c.code);
                  }
                }}
              />
              {c.out && <CellOutput out={c.out} />}
            </div>
            <div className="add-cell">
              <button className="ghost" onClick={() => insertAfter(c.id)}>+ cell</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CellOutput({ out }) {
  if (out.running) return <div className="out"><pre style={{ color: "var(--color-accent)" }}>running…</pre></div>;
  const nothing = !out.stdout && !out.result_html && !out.result_text && !(out.figures || []).length && !out.error;
  return (
    <div className="out">
      {out.stdout && out.stdout.trim() && <pre>{out.stdout}</pre>}
      {out.result_html && <div dangerouslySetInnerHTML={{ __html: out.result_html }} />}
      {out.result_text && <pre>{out.result_text}</pre>}
      {(out.figures || []).map((f, i) => <img key={i} src={`data:image/png;base64,${f}`} alt="figure" />)}
      {out.error && <div className="err"><pre>{out.error}</pre></div>}
      {nothing && <pre style={{ color: "var(--color-text-muted)" }}>(no output)</pre>}
    </div>
  );
}
