// A small, safe Markdown renderer for game rules (D-099). Games are trusted code, but their rules text is shown as
// text: every character is escaped first, and only this subset becomes markup:
//   # ## ### headings · paragraphs · "-"/"*" and "1." lists (one level) · > a tip · --- · simple tables
//   **bold** · *italic* / _italic_ · `code` · [text](https://…) links · ![alt](assets/…) images
// Images must be the game's own files under assets/ (resolved against `base`, e.g. "/games/roulette/"); links must
// be https and open in a new tab. Anything else stays visible as plain text, so a mistake shows instead of vanishing.
// Pure string in, string out: no DOM needed, so the tests run it directly.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

/** An image path a game may use: assets/ plus plain path segments, no "..", no query. */
const SAFE_ASSET = /^assets\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.(?:svg|png|jpe?g|webp|gif)$/;
const SAFE_LINK = /^https:\/\/[^\s"'<>]+$/;

/** Inline markup on one already-escaped line. */
function inline(s, base) {
  // Code spans first, kept apart so their content isn't touched by the other rules.
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => {
    const raw = src.replace(/&amp;/g, "&");
    if (!SAFE_ASSET.test(raw) || raw.includes("..")) return m;
    return `<img src="${esc(base + raw)}" alt="${alt}" loading="lazy">`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, href) => {
    const raw = href.replace(/&amp;/g, "&");
    if (!SAFE_LINK.test(raw)) return m;
    return `<a href="${esc(raw)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?![\w*])/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/**
 * Render rules Markdown to HTML. `base` is the folder images resolve against ("/games/<id>/").
 * Returns { html, title }: the first # heading becomes the title (and is left out of the body).
 */
export function renderRules(md, base = "") {
  const lines = String(md ?? "").replace(/\r\n?/g, "\n").split("\n").map((l) => esc(l));
  const out = [];
  let title = "";
  let para = [];
  let list = null; // { tag, items }
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "), base)}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i, base)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  const flush = () => (flushPara(), flushList());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      flush();
      continue;
    }
    let m;
    if ((m = t.match(/^(#{1,3})\s+(.*)$/))) {
      flush();
      if (m[1].length === 1 && !title) title = m[2];
      else out.push(`<h${m[1].length + 1}>${inline(m[2], base)}</h${m[1].length + 1}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      flush();
      out.push("<hr>");
      continue;
    }
    if ((m = t.match(/^&gt;\s?(.*)$/))) {
      flush();
      const quote = [m[1]];
      while (i + 1 < lines.length && (m = lines[i + 1].trim().match(/^&gt;\s?(.*)$/))) quote.push(m[1]), i++;
      out.push(`<blockquote>${inline(quote.join(" "), base)}</blockquote>`);
      continue;
    }
    // A table: a header row, a |---| separator, then rows.
    if (t.startsWith("|") && i + 1 < lines.length && /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(lines[i + 1].trim())) {
      flush();
      const head = cells(t);
      const rows = [];
      i++;
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith("|")) rows.push(cells(lines[++i]));
      out.push(`<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${inline(c, base)}</th>`).join("")}</tr></thead><tbody>${rows
        .map((r) => `<tr>${head.map((_, k) => `<td>${inline(r[k] ?? "", base)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`);
      continue;
    }
    if ((m = t.match(/^[-*]\s+(.*)$/)) || (m = t.match(/^\d+[.)]\s+(.*)$/))) {
      const tag = /^\d/.test(t) ? "ol" : "ul";
      flushPara();
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push(m[1]);
      continue;
    }
    // A continuation line of a list item (indented), else a paragraph line.
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += " " + t;
      continue;
    }
    flushList();
    para.push(t);
  }
  flush();
  return { title, html: out.join("\n") };
}
