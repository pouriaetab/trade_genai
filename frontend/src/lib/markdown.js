// Tiny, dependency-free Markdown -> HTML for rendering LLM chat replies.
//
// LLMs reliably write **bold**, `code`, # headers, bullet/numbered lists, and
// --- rules — but the chat bubble was rendering that literally (asterisks
// and hashes showing up as-is instead of real formatting). This is
// deliberately not a full CommonMark implementation, just enough of the
// constructs models actually produce to make replies readable.
//
// Raw HTML is escaped first, so the only tags that can ever appear in the
// output are the ones this function introduces itself (p/br/strong/em/code/
// ul/ol/li/h4-h6/hr) — safe to render with dangerouslySetInnerHTML even
// though the input is unsanitized model output.

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(text) {
  let t = escapeHtml(text);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
  t = t.replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!_)/g, "$1<em>$2</em>");
  return t;
}

const BULLET_RE = /^\s*[-*]\s+/;
const NUMBERED_RE = /^\s*\d+[.)]\s+/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const RULE_RE = /^(-{3,}|\*{3,})\s*$/;
const BLANK_RE = /^\s*$/;

export function renderMarkdown(text) {
  if (!text) return "";
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (BLANK_RE.test(line)) { i++; continue; }
    if (RULE_RE.test(line)) { out.push("<hr />"); i++; continue; }

    const h = line.match(HEADING_RE);
    if (h) {
      const level = Math.min(h[1].length + 3, 6); // #, ##, ### -> h4, h5, h6 (fits a chat bubble)
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++; continue;
    }

    if (BULLET_RE.test(line)) {
      const items = [];
      while (i < lines.length && BULLET_RE.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(BULLET_RE, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (NUMBERED_RE.test(line)) {
      const items = [];
      while (i < lines.length && NUMBERED_RE.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(NUMBERED_RE, ""))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    const para = [];
    while (
      i < lines.length && !BLANK_RE.test(lines[i]) && !HEADING_RE.test(lines[i]) &&
      !BULLET_RE.test(lines[i]) && !NUMBERED_RE.test(lines[i]) && !RULE_RE.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${para.map(inline).join("<br />")}</p>`);
  }
  return out.join("\n");
}
