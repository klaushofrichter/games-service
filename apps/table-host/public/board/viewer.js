// The Game Viewer (D-120): finished games' logs on the board, move by move. A list of logs, then one game's moves a page
// at a time with filters, then one step in full, with a reference to copy for a developer or an LLM
// ("20261016044059-loopy-491f #54"). Read-only; served by GET /api/v1/history….
import { esc, copyText } from "/shared/board-kit.js";

const PAGE = 16;
const LIST_PAGE = 14;
const END = { finished: "finished", terminated: "ended from the lobby", seatLeft: "a player left", interrupted: "interrupted" };

/**
 * Open the viewer. `api(method, path)` is the board's API helper (it shows errors itself); `face(panel)` turns the
 * panel to the edge the board faces and returns whether it is sideways; `toast(text)` shows a short note.
 */
export function openViewer({ api, overlayRoot, face, toast, openStats }) {
  const o = document.createElement("div");
  o.className = "overlay viewer";
  o.innerHTML = `<div class="panel viewer-panel" role="dialog" aria-modal="true" aria-label="Game logs"></div>`;
  const panel = o.querySelector(".panel");
  overlayRoot.appendChild(o);
  const v = { view: "list", logs: null, listPage: 0, log: null, game: 1, filter: { seat: null, movesOnly: false, problems: false }, page: null, offset: 0, step: null, target: null };
  const relayout = () => panel.classList.toggle("sideways", !!face(panel));
  relayout();

  const tz = () => v.log?.meta?.timeZone;
  const fmtTime = (at, start, sim) => {
    if (sim || at < 1e12) return `+${((at - start) / 1000).toFixed(1)} s`;
    try {
      return new Intl.DateTimeFormat("en-GB", { timeZone: tz(), hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(at);
    } catch {
      return new Date(at).toLocaleTimeString();
    }
  };
  const fmtDate = (iso, zone) => {
    try {
      return new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
    } catch {
      return iso;
    }
  };
  const dur = (ms) => (ms == null ? "" : ms >= 3_600_000 ? `${Math.floor(ms / 3_600_000)} h ${Math.round((ms % 3_600_000) / 60_000)} min` : ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`);
  const ended = (e) => (e.kind === "simulation" ? `${e.games} AI game${e.games === 1 ? "" : "s"}` : END[e.endReason] ?? e.endReason ?? "");

  // ---------- views ----------

  function head(title, back) {
    return `<header class="vhead">${back ? `<button class="ghost" data-back>‹ ${esc(back)}</button>` : ""}<h2>${esc(title)}</h2><button class="ghost close" data-close aria-label="Close">✕</button></header>`;
  }

  function drawList() {
    if (!v.logs) return void (panel.innerHTML = `${head("Game logs")}<div class="empty faint">Loading…</div>`);
    const start = v.listPage * LIST_PAGE;
    const rows = v.logs.slice(start, start + LIST_PAGE);
    const pages = Math.max(1, Math.ceil(v.logs.length / LIST_PAGE));
    panel.innerHTML = `${head("Game logs")}
      <p class="muted intro">Finished games on this table, newest first. Tap one to see its moves.</p>
      ${v.logs.length ? `<table class="vtable logs"><thead><tr><th>Started</th><th>Game</th><th>Players</th><th>Ended</th><th class="num">Moves</th><th class="num">Length</th></tr></thead><tbody>
        ${rows.map((e) => `<tr data-log="${esc(e.id)}"><td>${esc(fmtDate(e.startedAt))}</td><td>${esc(e.gameName)}<div class="logid">${esc(e.id)}</div></td>
          <td class="players">${esc(e.players.map((p) => p.name).join(", "))}</td><td>${esc(ended(e))}${e.counts?.errors ? ` <span class="flag err">errors</span>` : ""}</td>
          <td class="num">${e.counts?.intents ?? ""}</td><td class="num">${esc(dur(e.durationMs))}</td></tr>`).join("")}
        </tbody></table>
        <div class="pager-row"><button data-lpage="-1" ${v.listPage === 0 ? "disabled" : ""}>‹ Newer</button><span class="faint">${start + 1}–${start + rows.length} of ${v.logs.length}</span><button data-lpage="1" ${v.listPage >= pages - 1 ? "disabled" : ""}>Older ›</button></div>`
      : `<div class="empty faint">No finished games yet. Logs appear here when a game ends.</div>`}`;
  }

  /** A move's automatic follow-ups ("↳ Coin: heads · …"), in the moves table and on the step page. */
  function subSteps(steps) {
    return (steps ?? []).map((s) => `<div class="sub">↳ ${s.player ? `<b>${esc(s.player)}</b> ` : ""}${esc(s.text)}${s.auto ? ` <span class="flag auto">automatic</span>` : ""}</div>`).join("");
  }

  function cell(val) {
    return val === null || val === undefined || val === "" ? `<span class="faint">·</span>` : esc(String(val));
  }

  function moveRow(r, cols, start, sim) {
    const cls = [r.kind, ...r.flags].join(" ");
    const steps = subSteps(r.steps);
    const flags = [
      r.flags.includes("rejected") ? `<span class="flag rej">refused</span>` : "",
      r.flags.includes("error") ? `<span class="flag err">error</span>` : "",
      r.flags.includes("fallback") ? `<span class="flag fb">quick move</span>` : "",
    ].join("");
    if (r.kind === "gap") return `<tr class="${cls}"><td></td><td>${esc(fmtTime(r.at, start, sim))}</td><td colspan="${cols.length + 2}">${esc(r.text)}</td></tr>`;
    return `<tr class="${cls}${v.target !== null && r.n === v.target ? " target" : ""}" data-line="${r.line}" tabindex="0"><td class="num n">${r.n ?? ""}</td><td class="time">${esc(fmtTime(r.at, start, sim))}</td>
      <td class="who">${r.player ? esc(r.player) : r.kind === "move" ? "?" : `<span class="faint">${r.kind === "timer" ? "timer" : r.kind === "start" || r.kind === "end" ? "" : "table"}</span>`}${r.by === "board" ? ` <span class="faint by">board</span>` : ""}</td>
      ${cols.map((c) => `<td class="col">${cell(r.columns?.[c.key])}</td>`).join("")}
      <td class="what">${esc(r.text)}${flags}${steps}</td></tr>`;
  }

  function drawMoves() {
    const l = v.log;
    const p = v.page;
    const g = l.gameList[v.game - 1];
    const sim = l.kind === "simulation";
    const cols = p?.columns ?? l.columns ?? [];
    const start = p?.rows?.find((r) => r.kind === "start")?.at ?? Date.parse(l.startedAt);
    const players = l.players;
    const f = v.filter;
    panel.innerHTML = `${head(`${l.gameName} · ${fmtDate(l.startedAt, l.meta?.timeZone)}`, "All logs")}
      <div class="vsub"><span>${esc(players.map((x) => x.name).join(", "))}</span><span class="faint">·</span>
        <span>${esc(g?.result ?? (g?.endReason ? END[g.endReason] ?? g.endReason : ""))}</span>
        ${l.games > 1 ? `<span class="seg game-pick"><button data-game="-1" ${v.game <= 1 ? "disabled" : ""}>‹</button><span>Game ${v.game} of ${l.games}</span><button data-game="1" ${v.game >= l.games ? "disabled" : ""}>›</button></span>` : ""}
        <span class="ref faint">${esc(l.id)}</span></div>
      ${g?.note ? `<div class="note faint">${esc(g.note)}</div>` : ""}
      <div class="filters">
        <span class="seg seats"><button data-seat="" class="${f.seat === null ? "on" : ""}">Everyone</button>${players.map((x) => `<button data-seat="${x.seat}" class="${f.seat === x.seat ? "on" : ""}">${esc(x.name)}</button>`).join("")}</span>
        <button data-toggle="movesOnly" class="${f.movesOnly ? "on" : ""}">Moves only</button>
        <button data-toggle="problems" class="${f.problems ? "on" : ""}">Problems</button>
        ${openStats && g?.endReason === "finished" ? `<button data-stats>Statistics</button>` : ""}
        <form class="goto"><label>Move #<input name="move" type="number" min="1" max="${g?.moves ?? 1}" inputmode="numeric"></label><button>Go</button></form>
      </div>
      ${!p ? `<div class="empty faint">Loading…</div>` : p.total === 0 ? `<div class="empty faint">Nothing matches these filters.</div>` : `<div class="scroll"><table class="vtable moves"><thead><tr><th class="num">#</th><th>Time</th><th>Player</th>${cols.map((c) => `<th class="col">${esc(c.label)}</th>`).join("")}<th>What happened</th></tr></thead>
        <tbody>${p.rows.map((r) => moveRow(r, cols, start, sim)).join("")}</tbody></table></div>`}
      ${p && p.total ? `<div class="pager-row"><button data-page="-1" ${p.offset === 0 ? "disabled" : ""}>‹ Earlier</button>
        <span class="faint">rows ${p.offset + 1}–${p.offset + p.rows.length} of ${p.total}${g ? ` · ${g.moves} moves` : ""}</span>
        <button data-page="1" ${p.offset + p.limit >= p.total ? "disabled" : ""}>Later ›</button></div>` : ""}`;
  }

  function jsonBlock(label, value, open = false) {
    if (value === undefined) return "";
    return `<details ${open ? "open" : ""}><summary>${esc(label)}</summary><pre class="raw">${esc(JSON.stringify(value, null, 1))}</pre></details>`;
  }

  function drawStep() {
    const s = v.step;
    const r = s.row;
    const sim = v.log.kind === "simulation";
    const start = Date.parse(v.log.startedAt);
    const rec = s.record ?? {};
    const facts = [
      ["Move", r.n !== null ? `#${r.n}` : "—"],
      ["Line", `${r.line} of game-${String(v.game).padStart(3, "0")}.jsonl`],
      ["Time", fmtTime(r.at, start, sim)],
      ["Player", r.player ?? "—"],
      r.by ? ["Sent from", r.by === "ai" ? "AI" : r.by === "board" ? "the board" : "phone"] : null,
      r.intent ? ["Intent", `${r.intent.name} ${r.intent.payload === undefined ? "" : JSON.stringify(r.intent.payload)}`] : null,
      r.kind === "move" ? ["Accepted", r.accepted ? "yes" : `no — ${r.reason ?? r.error ?? ""}`] : null,
      r.ai ? ["AI", `${r.ai.ms} ms${r.ai.worker ? ", worker" : ""}${r.ai.fallback ? ", quick move (Play now or failure)" : ""}${r.ai.error ? `, ${r.ai.error}` : ""}`] : null,
      r.events ? ["Events", String(r.events)] : null,
      ...Object.entries(s.row.columns ?? {}).filter(([, x]) => x !== null && x !== "").map(([k, x]) => [(v.page?.columns ?? []).find((c) => c.key === k)?.label ?? k, String(x)]),
    ].filter(Boolean);
    panel.innerHTML = `${head(r.n !== null ? `Move ${r.n}` : `Line ${r.line}`, "Moves")}
      <div class="step">
        <div class="what big">${r.player ? `<b>${esc(r.player)}</b> ` : ""}${esc(r.text)}</div>
        ${subSteps(r.steps)}
        <div class="refrow"><code>${esc(s.reference)}</code><button data-copyref>Copy reference</button></div>
        <dl class="facts">${facts.map(([k, x]) => `<dt>${esc(k)}</dt><dd>${esc(x)}</dd>`).join("")}</dl>
        ${r.details ? jsonBlock("Details from the game", r.details, true) : ""}
        ${rec.error ? jsonBlock("Error", rec.error, true) : ""}
        ${jsonBlock("Events", rec.events)}
        ${s.state ? jsonBlock("State after", s.state.after) + jsonBlock("State before", s.state.before) : `<div class="faint note">${esc(s.stateNote ?? "")}</div>`}
        ${jsonBlock("Log record", rec)}
      </div>
      <div class="pager-row"><button data-stepmove="${s.prevMove ?? ""}" ${s.prevMove == null ? "disabled" : ""}>‹ Move ${s.prevMove ?? ""}</button>
        <span class="faint">${esc(v.log.id)}</span>
        <button data-stepmove="${s.nextMove ?? ""}" ${s.nextMove == null ? "disabled" : ""}>Move ${s.nextMove ?? ""} ›</button></div>`;
  }

  const draw = () => (v.view === "list" ? drawList() : v.view === "moves" ? drawMoves() : drawStep());

  // ---------- loading ----------

  async function loadList() {
    v.logs = await api("GET", "/history").catch(() => []);
    v.view = "list";
    draw();
  }

  async function openLog(id) {
    v.log = await api("GET", `/history/${encodeURIComponent(id)}`).catch(() => null);
    if (!v.log) return;
    v.game = 1;
    v.filter = { seat: null, movesOnly: false, problems: false };
    v.offset = 0;
    v.view = "moves";
    await loadPage();
  }

  async function loadPage(move) {
    const f = v.filter;
    const q = new URLSearchParams({ limit: String(PAGE), offset: String(v.offset) });
    if (f.seat !== null) q.set("seat", String(f.seat));
    if (f.movesOnly) q.set("movesOnly", "1");
    if (f.problems) q.set("problems", "1");
    if (move !== undefined) q.set("move", String(move));
    v.page = null;
    draw();
    v.page = await api("GET", `/history/${encodeURIComponent(v.log.id)}/${v.game}/moves?${q}`).catch(() => null);
    if (v.page) v.offset = v.page.offset;
    draw();
  }

  async function openStep(ref) {
    const path = ref.move !== undefined ? `moves/${ref.move}` : `lines/${ref.line}`;
    const s = await api("GET", `/history/${encodeURIComponent(v.log.id)}/${v.game}/${path}`).catch(() => null);
    if (!s) return;
    v.step = s;
    v.view = "step";
    draw();
    panel.scrollTop = 0;
  }

  // ---------- input ----------

  const close = () => {
    window.removeEventListener("resize", relayout);
    o.remove();
  };
  window.addEventListener("resize", relayout);

  o.addEventListener("submit", (e) => {
    e.preventDefault();
    const n = Number(new FormData(e.target).get("move"));
    if (!Number.isInteger(n) || n < 1) return;
    // Go to move n: the page with it, without filters that could hide it.
    v.filter = { seat: null, movesOnly: v.filter.movesOnly, problems: false };
    v.target = n;
    loadPage(n).then(() => panel.querySelector("tr.target")?.scrollIntoView({ block: "center" }));
  });

  o.addEventListener("click", async (e) => {
    if (e.target === o) return close();
    const b = e.target.closest("button");
    const tr = e.target.closest("tr[data-log], tr[data-line]");
    if (b?.dataset.close !== undefined) return close();
    if (b?.dataset.stats !== undefined) {
      // The finished game's statistics window (D-140), over the viewer.
      const st = await api("GET", `/history/${encodeURIComponent(v.log.id)}/${v.game}/statistics`).catch(() => null);
      if (st) openStats(st, v.log.gameName);
      return;
    }
    if (b?.dataset.back !== undefined) {
      if (v.view === "step") {
        v.view = "moves";
        v.target = v.step?.row?.n ?? null;
        return draw();
      }
      return loadList();
    }
    if (b?.dataset.lpage) {
      v.listPage = Math.max(0, v.listPage + Number(b.dataset.lpage));
      return draw();
    }
    if (b?.dataset.page) {
      v.target = null;
      v.offset = Math.max(0, v.offset + Number(b.dataset.page) * PAGE);
      return loadPage();
    }
    if (b?.dataset.game) {
      v.target = null;
      v.game = Math.min(v.log.games, Math.max(1, v.game + Number(b.dataset.game)));
      v.offset = 0;
      return loadPage();
    }
    if (b?.dataset.seat !== undefined) {
      v.target = null;
      v.filter.seat = b.dataset.seat === "" ? null : Number(b.dataset.seat);
      v.offset = 0;
      return loadPage();
    }
    if (b?.dataset.toggle) {
      v.target = null;
      v.filter[b.dataset.toggle] = !v.filter[b.dataset.toggle];
      v.offset = 0;
      return loadPage();
    }
    if (b?.dataset.copyref !== undefined) {
      const ok = await copyText(v.step.reference);
      return toast(ok ? `Copied: ${v.step.reference}` : v.step.reference);
    }
    if (b?.dataset.stepmove) return openStep({ move: Number(b.dataset.stepmove) });
    if (tr?.dataset.log) return openLog(tr.dataset.log);
    if (tr?.dataset.line) return openStep({ line: Number(tr.dataset.line) });
  });

  o.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return close();
    const tr = e.target.closest?.("tr[data-line]");
    if (tr && e.key === "Enter") openStep({ line: Number(tr.dataset.line) });
  });

  draw();
  loadList();
  return { close };
}
