import { useState } from "react";
import { post } from "../lib/api.js";

const CH1 = `# Chapter 1 — last 100 trading days of SPY, split + dividend adjusted
from genai_trader.lessons.ch01_spy_returns import run
res = run("SPY", 100)

print("Raw (tail):")
print(res["raw"].tail().to_string(index=False))
print("\\nAnnualized Sharpe:", round(res["sharpe"], 2))
res["returns"].tail(10)   # [date, daily_return]`;

let nextId = 1;
const newCell = (code = "") => ({ id: nextId++, code, out: null, running: false });

export default function Notebook() {
  const [cells, setCells] = useState([newCell()]);

  function update(id, patch) {
    setCells((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function insertAfter(id, code = "") {
    setCells((cs) => {
      const i = cs.findIndex((c) => c.id === id);
      const copy = [...cs];
      copy.splice(i + 1, 0, newCell(code));
      return copy;
    });
  }
  function remove(id) {
    setCells((cs) => (cs.length > 1 ? cs.filter((c) => c.id !== id) : cs));
  }
  async function runCell(id, code) {
    update(id, { running: true, out: { running: true } });
    const r = await post("/api/v1/kernel/run", { code });
    update(id, { running: false, out: r.data || {} });
  }
  async function reset() {
    await post("/api/v1/kernel/reset", {});
    setCells((cs) => cs.map((c) => ({ ...c, out: null })));
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Notebook — run book code, see results</h2>
        <div className="spacer" />
        <button className="ghost" onClick={() => setCells((cs) => [...cs, newCell(CH1)])}>
          Load Ch 1 · SPY returns
        </button>
        <button className="ghost" onClick={reset}>Reset</button>
      </div>
      <div className="panel-body">
        <p className="lead">Paste a code chunk and press <kbd>Shift</kbd>+<kbd>Enter</kbd>.
          State persists between cells; <code>pd</code>, <code>np</code>, <code>plt</code> and the
          <code> genai_trader</code> helpers are preloaded. Add a cell anywhere with <b>+</b>.</p>
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
                onChange={(e) => update(c.id, { code: e.target.value })}
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
      {(out.figures || []).map((f, i) => (
        <img key={i} src={`data:image/png;base64,${f}`} alt="figure" />
      ))}
      {out.error && <div className="err"><pre>{out.error}</pre></div>}
      {nothing && <pre style={{ color: "var(--color-text-muted)" }}>(no output)</pre>}
    </div>
  );
}
