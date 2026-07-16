"use strict";

const PROJECT_ID = "chapters-1-2";
const api = (p, opts) => fetch(p, opts).then(r => r.json());
const $ = id => document.getElementById(id);

let MODELS = [];        // [{id,label,ready,has_free_tier,models:[...]}]
let conversation = [];  // chat history for the active project

/* ---------- theme ---------- */
function initTheme() {
  let t = "light";
  try { t = localStorage.getItem("tg.theme") || "light"; } catch {}
  document.documentElement.dataset.theme = t;
}
$("theme-btn").onclick = () => {
  const cur = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = cur;
  try { localStorage.setItem("tg.theme", cur); } catch {}
};

/* ---------- tabs ---------- */
document.querySelectorAll(".tab").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    ["learn", "strategies", "assets", "about"].forEach(name => {
      $("tab-" + name).style.display = name === btn.dataset.tab ? "" : "none";
    });
  };
});

/* ---------- status + model registry ---------- */
async function loadStatus() {
  const res = await api("/api/v1/status");
  const d = res.data || {};
  const massive = d.massive || {};
  const ready = (d.providers || []).filter(p => p.ready).map(p => p.label);
  const parts = [];
  parts.push(`<span class="pill">massive ${massive.configured ? massive.key : "—"}</span>`);
  parts.push(`<span class="pill">${ready.length ? "chat: " + ready.join(", ") : "chat: add a key"}</span>`);
  $("status").innerHTML = parts.join("");
}

async function loadModels() {
  const res = await api("/api/v1/models");
  MODELS = res.data || [];
  const provSel = $("provider");
  provSel.innerHTML = "";
  // default: first ready provider, else first free-tier provider
  const preferred = MODELS.find(p => p.ready) || MODELS.find(p => p.has_free_tier) || MODELS[0];
  MODELS.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label + (p.ready ? "" : "  (add key)");
    provSel.appendChild(opt);
  });
  provSel.value = preferred.id;
  provSel.onchange = populateModels;
  populateModels();
}

function populateModels() {
  const p = MODELS.find(x => x.id === $("provider").value);
  const modSel = $("model");
  modSel.innerHTML = "";
  (p.models || []).forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    modSel.appendChild(opt);
  });
  modSel.onchange = showModelMeta;
  showModelMeta();
}

function showModelMeta() {
  const p = MODELS.find(x => x.id === $("provider").value);
  const m = (p.models || []).find(x => x.id === $("model").value);
  if (!m) { $("model-meta").textContent = ""; return; }
  const badge = `<span class="badge ${m.tier}">${m.tier}</span>`;
  const ready = p.ready ? "" : ` · <span style="color:var(--color-warning)">needs ${p.env_var}</span>`;
  $("model-meta").innerHTML = `${badge} ${m.cost_hint} · ${m.context.toLocaleString()} ctx${ready}<br><span style="color:var(--color-text-muted)">${m.note}</span>`;
}

/* ---------- chat ---------- */
async function sendChat() {
  const text = $("chat-text").value.trim();
  if (!text) return;
  const provider = $("provider").value, model = $("model").value;
  $("chat-text").value = "";
  addMsg("user", text);
  conversation.push({ role: "user", content: text });

  const pending = addMsg("assistant", "…");
  const res = await api("/api/v1/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, model, messages: conversation, max_tokens: 1024 }),
  });
  if (!res.success) {
    pending.querySelector(".body").textContent = res.message;
    pending.querySelector(".meta").textContent = "error";
    return;
  }
  const d = res.data;
  pending.querySelector(".body").textContent = d.text;
  const u = d.usage || {};
  const toks = u.total_tokens || u.totalTokenCount ||
    ((u.input_tokens || 0) + (u.output_tokens || 0)) || "—";
  pending.querySelector(".meta").textContent =
    `${d.model} · ~${toks} tokens · ~$${(d.est_cost_usd || 0).toFixed(4)}`;
  conversation.push({ role: "assistant", content: d.text });
  persistMemory();
}

function addMsg(role, text) {
  const el = document.createElement("div");
  el.className = "msg " + role;
  el.innerHTML = `<span class="body"></span><span class="meta"></span>`;
  el.querySelector(".body").textContent = text;
  $("chat-log").appendChild(el);
  $("chat-log").scrollTop = $("chat-log").scrollHeight;
  return el;
}
$("chat-text").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

/* ---------- notebook cells ---------- */
function addCell(code = "", after = null) {
  const cell = document.createElement("div");
  cell.className = "cell";
  cell.innerHTML = `
    <div class="cell-head">
      <span class="lbl">py</span><span class="spacer"></span>
      <button class="ghost" onclick="runCell(this)">▶ Run</button>
      <button class="ghost" onclick="this.closest('.cell-wrap').remove()">✕</button>
    </div>
    <textarea spellcheck="false" placeholder="# paste code here"></textarea>
    <div class="out"></div>`;
  const wrap = document.createElement("div");
  wrap.className = "cell-wrap";
  wrap.appendChild(cell);
  const adder = document.createElement("div");
  adder.className = "add-cell";
  adder.innerHTML = `<button class="ghost">+ cell</button>`;
  adder.querySelector("button").onclick = () => insertAfter(wrap);
  wrap.appendChild(adder);

  if (after) after.after(wrap); else $("cells").appendChild(wrap);
  const ta = cell.querySelector("textarea");
  ta.value = code;
  ta.addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault(); runCell(ta);
    }
  });
  ta.focus();
  return wrap;
}
function insertAfter(wrap) { addCell("", wrap); }

async function runCell(node) {
  const cell = node.closest(".cell");
  const code = cell.querySelector("textarea").value;
  const out = cell.querySelector(".out");
  out.className = "out show";
  out.innerHTML = `<pre style="color:var(--color-accent)">running…</pre>`;
  const res = await api("/api/v1/kernel/run", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  renderOut(out, res.data || {});
}

function renderOut(out, d) {
  let html = "";
  if (d.stdout && d.stdout.trim()) html += `<pre>${esc(d.stdout)}</pre>`;
  if (d.result_html) html += d.result_html;
  if (d.result_text) html += `<pre>${esc(d.result_text)}</pre>`;
  (d.figures || []).forEach(f => { html += `<img src="data:image/png;base64,${f}"/>`; });
  if (d.error) html += `<div class="err"><pre>${esc(d.error)}</pre></div>`;
  out.innerHTML = html || `<pre style="color:var(--color-text-muted)">(no output)</pre>`;
}

async function resetKernel() {
  await api("/api/v1/kernel/reset", { method: "POST" });
  document.querySelectorAll(".out").forEach(o => { o.className = "out"; o.innerHTML = ""; });
}

function loadCh1() {
  addCell(
`# Chapter 1 — last 100 trading days of SPY, split + dividend adjusted
from genai_trader.lessons.ch01_spy_returns import run
res = run("SPY", 100)

print("Raw (tail):")
print(res["raw"].tail().to_string(index=False))
print("\\nAnnualized Sharpe:", round(res["sharpe"], 2))
res["returns"].tail(10)   # [date, daily_return]`);
}

/* ---------- memory ---------- */
async function loadMemory() {
  const res = await api(`/api/v1/projects/${PROJECT_ID}`);
  const p = res.data || {};
  $("notes").value = p.notes || "";
  conversation = p.chat || [];
  $("chat-log").innerHTML = "";
  conversation.forEach(m => {
    const el = addMsg(m.role, m.content);
    if (m.role === "assistant") el.querySelector(".meta").textContent = "saved";
  });
}
function currentMemory() {
  return { notes: $("notes").value, cells: [], chat: conversation };
}
async function persistMemory() {
  await api(`/api/v1/projects/${PROJECT_ID}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(currentMemory()),
  });
}
async function saveMemory() {
  await persistMemory();
  const h = $("mem-hint");
  h.textContent = "Saved.";
  setTimeout(() => (h.textContent = "Chat history and notes persist across restarts."), 1500);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- boot ---------- */
initTheme();
loadStatus();
loadModels();
loadMemory();
addCell();
