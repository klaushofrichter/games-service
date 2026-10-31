// Deck UI: join with a name, lobby with Ready, and the game's own private deck view.
// A game package may ship deck.js exporting mount(root, ctx) -> { update(view, events, info), destroy() }.
import { esc, claimServiceWorkerPage, inkOn, openTableSocket, playerColor, seatName, seatTitle } from "/shared/board-kit.js";
import { renderRules } from "/shared/markdown.js";

const app = document.getElementById("app");
const params = new URLSearchParams(location.search);
const joinToken = params.get("t");
// Remote players (phase 1c) load this page inside the cloud's invite page, which carries the socket
// over a WebRTC channel to the table; their name comes from that page, and no join code is needed.
const REMOTE = params.get("remote") === "1";
const remoteName = params.get("name") ?? "";
if (REMOTE) claimServiceWorkerPage();
// Played from the board (D-175, a developer setting): this page sits beside the board on the table PC and joins with
// the table key the board's page holds, instead of a join code; its session is kept apart from a phone's.
const BOARD = params.get("board") === "1" && !REMOTE;
const boardKey = () => { try { return window.parent !== window ? window.parent.TABLE_KEY : undefined; } catch { return undefined; } };
const SESSION_KEY = REMOTE ? `gametable.remote.${params.get("inv") ?? ""}` : BOARD ? `gametable.board-deck.${location.host}` : `gametable.session.${location.host}`;

let ws = null;
let me = null; // playerId
let state = null;
let gameMsg = null; // last game.view message { seat, view, events, timers, now, receivedAt }
let banner = "";
let removed = false;
let removedReason = ""; // "left" (from this phone, D-158), "evicted", "replaced"
let myName = ""; // this deck's name in the last state, to take the seat back with when removed (D-222)
// Beside the board (D-175), "Take your seat back" reloads with the name to join under, without the name form (D-222).
const AGAIN_KEY = "gametable.board-deck.again";
let againName = "";
if (BOARD) {
  try {
    againName = sessionStorage.getItem(AGAIN_KEY) ?? "";
    sessionStorage.removeItem(AGAIN_KEY);
  } catch {}
}
let leftGame = false; // removed during a game
let replaced = false; // this player's deck opened in another window (D-133)
let seq = 0;
let retry = 0;
/** Why the name typed on the join form was refused (D-148): taken at this table, or not allowed. */
let joinError = "";
/** No free seat at the table (D-129): the reason, shown instead of the name form until a seat is free. */
let noSeat = null;
let suggested = ""; // "Player N" from the table (D-244)
let seatTimer = null;

/** Ask the table whether a seat is free for this join code; look again every few seconds while there is none. */
async function checkSeat() {
  try {
    const r = await fetch(`/j/${encodeURIComponent(joinToken)}/seat`, { cache: "no-store" });
    // An old code (the table restarted, or a new code was made): said at once, before the name is typed (D-241).
    if (r.status === 403 && !me) {
      banner = (await r.json().catch(() => ({}))).error ?? "This join code no longer works; scan the code the board shows now.";
      return render();
    }
    if (!r.ok) return;
    const b = await r.json();
    // A name to start with (D-244): "Player N", in the field while nothing is typed there; it can be changed.
    if (b.name) {
      suggested = b.name;
      const field = body.querySelector("#join input[name=name]");
      if (field && !field.value) field.value = suggested;
    }
    const was = noSeat;
    noSeat = b.free ? null : b.message;
    if (noSeat) watchSeat();
    if (was !== noSeat && !me) render();
  } catch {
    // offline for a moment: keep what we know
  }
}
function watchSeat() {
  if (seatTimer || !joinToken || REMOTE) return;
  seatTimer = setInterval(() => (me || !noSeat ? (clearInterval(seatTimer), (seatTimer = null)) : checkSeat()), 4000);
}
const pending = new Map(); // seq -> resolve

const storage = {
  get: () => { try { return localStorage.getItem(SESSION_KEY); } catch { return null; } },
  set: (v) => { try { localStorage.setItem(SESSION_KEY, v); } catch {} },
  clear: () => { try { localStorage.removeItem(SESSION_KEY); } catch {} },
};

function send(ch, type, payload) {
  const s = ++seq;
  if (ws?.readyState === 1) ws.send(JSON.stringify({ v: 1, ch, type, seq: s, payload }));
  else return Promise.resolve({ ok: false, reason: "not connected" });
  return new Promise((resolve) => {
    pending.set(s, resolve);
    setTimeout(() => pending.delete(s) && resolve({ ok: false, reason: "no answer from the table" }), 5000);
  });
}

// A short message (a refused move, D-191) floats over the top of the screen for three seconds instead of pushing the
// page down: the game's status stays where it is.
const toastEl = document.createElement("div");
toastEl.className = "deck-toast"; // not .toast: that is the board's, at the bottom (shared theme)
toastEl.setAttribute("role", "status");
toastEl.setAttribute("aria-live", "polite");
document.body.appendChild(toastEl);
function toast(msg) {
  banner = msg;
  toastEl.textContent = msg;
  toastEl.classList.add("on");
  setTimeout(() => {
    if (banner === msg) {
      banner = "";
      toastEl.classList.remove("on");
    }
  }, 3000);
}

function connect(hello) {
  ws = openTableSocket(REMOTE);
  ws.onopen = () => send("system", "hello", hello);
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.ch === "system") {
      const resolve = m.seq !== undefined && pending.get(m.seq);
      if (resolve) {
        pending.delete(m.seq);
        resolve(m.type === "ack" || m.type === "welcome" ? { ok: true } : { ok: false, reason: m.payload?.reason ?? m.payload?.message });
      }
      if (m.type === "welcome") {
        me = m.payload.playerId;
        if (REMOTE) try { localStorage.setItem(`gametable.remote.${params.get("inv") ?? ""}.player`, me); } catch {} // the remote board turns to this seat
        if (m.payload.sessionToken) storage.set(m.payload.sessionToken);
        retry = 0;
        banner = "";
        if (joinToken) history.replaceState(null, "", "/deck/"); // keep the join code out of the address bar and history
      } else if (m.type === "replaced") {
        replaced = true;
      } else if (m.type === "removed") {
        removed = true;
        removedReason = m.payload?.reason ?? "";
        leftGame = !!(state && (state.phase === "active" || state.phase === "paused"));
        storage.clear();
      } else if (m.type === "error" || m.type === "reject") {
        const msg = m.payload.message ?? m.payload.reason;
        if (m.payload.status === 403) {
          storage.clear();
          me = null;
          // The deck beside the board (D-175) takes a seat with the table key, not a QR code: a session saved from an
          // earlier run that the table no longer knows just goes, and the name form shows without a warning (D-218).
          banner = BOARD && hello.sessionToken ? "" : msg;
        } else if (!me && (m.payload.code === "name-taken" || m.payload.code === "name-invalid")) {
          joinError = msg; // the form stays, with the reason under the name (D-148)
          const el = body.querySelector("#join-error");
          if (el) el.textContent = msg;
        } else if (m.payload.code === "no-seat") {
          // Taken by someone else just now (D-129): say why, and look again. A remote player's invite page shows it.
          if (REMOTE) banner = msg;
          else {
            noSeat = msg;
            watchSeat();
          }
        } else if (!resolve) toast(msg);
      }
    } else if (m.ch === "lobby" && m.type === "state") {
      state = m.payload;
      if (!removed && self()) myName = self().name;
      if (state.phase !== "active" && state.phase !== "paused") gameMsg = null;
    } else if (m.ch === "game" && m.type === "view") {
      gameMsg = { ...m.payload, receivedAt: Date.now() };
      // When it becomes this player's turn the game's tab comes to the front (D-123).
      const myTurn = !!m.payload.view?.myTurn;
      if (myTurn && !wasMyTurn) tab = "game";
      wasMyTurn = myTurn;
      if (navigator.vibrate && m.payload.view?.myTurn && !m.payload.events?.length) navigator.vibrate(60);
    }
    render();
  };
  ws.onclose = (ev) => {
    for (const r of pending.values()) r({ ok: false, reason: "connection lost" });
    pending.clear();
    if (removed || ev.code === 4003) return render();
    if (replaced || ev.code === 4009) return ((replaced = true), render());
    const token = storage.get();
    if (!token) return render();
    banner = "Reconnecting…";
    render();
    setTimeout(() => connect({ sessionToken: token }), Math.min(5000, 500 * 2 ** retry++));
  };
}

// ---------- layout: a header that re-renders freely, and a body the game module owns ----------

app.innerHTML = `<div id="top"></div><div id="table" class="table-tab" role="tabpanel" aria-labelledby="tab-table"></div><div id="body" role="tabpanel"></div>`;
const top = app.querySelector("#top");
const tablePanel = app.querySelector("#table");
// The header and the table tab are written only when their markup changes: every game message renders, and most leave
// them as they were.
const written = new WeakMap();
const put = (el, markup) => {
  if (written.get(el) === markup) return;
  written.set(el, markup);
  el.innerHTML = markup;
};
const body = app.querySelector("#body");

// During a game (D-123) the header is a slim tab bar: the player's own tab (colour, name, seat) opens what the header
// used to show plus everyone at the table, Rules and the terms; the game's tab holds the game's deck, which stays mounted
// while the other tab is open. Outside a game the deck has the full header as before.
let tab = "game";
let wasMyTurn = false;

function self() {
  return state?.players.find((p) => p.id === me);
}

function renderTop() {
  if (!me || !state || removed) return;
  const p = self();
  const inGame = !!(gameMsg && (state.phase === "active" || state.phase === "paused"));
  document.body.classList.toggle("in-game", inGame);
  const pause = state.phase === "paused" ? state.pause : null;
  const paused = !pause
    ? ""
    : pause.reason === "ai"
      ? `<div class="banner">Waiting for ${esc(pause.ai?.name ?? "an AI player")}, who is still thinking. The board can make it move now.</div>`
      : pause.reason === "player"
      ? `<div class="banner">Waiting for ${esc((pause.players ?? []).map((w) => w.name).join(" and ") || "a player")} to come back. ${esc((pause.players ?? [])[0]?.text ?? "")}</div>`
      : `<div class="banner">Game paused: the table lost its connection. It continues by itself when the connection is back.</div>`;
  const banners = paused;
  if (inGame) {
    const color = p?.seat == null ? null : colorOf(p.seat);
    put(top, `${banners}<div class="tabs" role="tablist" aria-label="Deck">
      <button type="button" role="tab" id="tab-table" data-tab="table" aria-selected="${tab === "table"}" aria-controls="table">
        ${color ? `<span class="pdot" style="background:${color}" aria-hidden="true"></span>` : ""}<span class="tab-name">${esc(p?.name ?? "")}</span>${p?.seat == null ? "" : `<span class="tab-seat">${esc(seatBadge(state.seatEdges, p.seat))}</span>`}</button>
      <button type="button" role="tab" id="tab-game" data-tab="game" aria-selected="${tab === "game"}" aria-controls="body">${esc(state.game?.name ?? "Game")}</button></div>`);
    body.setAttribute("aria-labelledby", "tab-game");
    put(tablePanel, tab === "table" ? `${whoHtml(p, true)}<div class="card list"><div class="eyebrow" style="margin-bottom:6px">At the table</div>${playersHtml()}</div>
      ${p?.seat != null ? leaveHtml(true) : ""}
      <div class="center"><a href="/deck/terms.html" data-terms class="faint">Terms of service</a></div>` : "");
  } else {
    tab = "game";
    put(tablePanel, "");
    put(top, `${banners}${whoHtml(p, false)}
    ${p?.seat != null ? "" : `<div class="card muted">No seat yet. You'll get one when a seat opens.</div>`}`);
  }
  tablePanel.hidden = !(inGame && tab === "table");
  body.style.display = inGame && tab === "table" ? "none" : "";
}

/**
 * The player's name, the Rules button and the seat badge: the header outside a game, the top of the own tab in one.
 * *Change name* (outside a game) has a row of its own under the name (D-156), so a 12-character name keeps its room
 * on a narrow deck, such as a remote player's deck window.
 */
function whoHtml(p, inGame) {
  const rules = state.game?.howToPlay ? `<button type="button" class="rules-btn" data-rules aria-haspopup="dialog">Rules</button>` : "";
  const rename = inGame || p?.kind !== "human" ? "" : `<button type="button" class="rules-btn" data-rename aria-haspopup="dialog">Change name</button>`;
  // Before a game is chosen, leaving sits beside Change name (D-245); with a game chosen the Ready screen has it.
  const leaveBtn = rename && !state.game && p?.seat != null ? `<button type="button" class="rules-btn" data-leave="table">Leave</button>` : "";
  // Outside a game both buttons go under the name; in a game Rules stays beside it (no Change name there).
  const below = rename ? `<div class="who-actions">${rename}${leaveBtn}${rules}</div>` : "";
  return `<div class="who"><div><div class="eyebrow">${esc(state.tableName)}${inGame ? ` · ${esc(state.game?.name)}` : ""}</div><h1>${esc(p?.name ?? "")}</h1></div>
      <div class="who-side">${below ? "" : rules}${p?.seat == null ? "" : seatBadgeHtml(p)}</div></div>${below}`;
}

function setTab(t) {
  if (tab === t) return;
  tab = t;
  renderTop();
  if (t === "game") window.scrollTo(0, 0);
}

// ---------- game rules (D-099): the chosen game's how-to-play.md in a modal, with this table's settings on top ----------

const rulesCache = new Map(); // url -> markdown
let rulesOpen = null; // the open modal element

for (const el of [top, tablePanel]) {
  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-rules]")) void openRules();
    if (e.target.closest("[data-rename]")) openRename(e.target.closest("[data-rename]"));
    const lv = e.target.closest("[data-leave]");
    if (lv) void leave(lv.dataset.leave === "game");
    const t = e.target.closest("[data-tab]");
    if (t) setTab(t.dataset.tab);
    const terms = e.target.closest("a[data-terms]");
    if (terms) {
      e.preventDefault();
      void openTerms(terms);
    }
  });
}

/**
 * A sheet over the phone (D-099, D-108): a title, ✕ top right, a scrolling body and a Close button. Closed by ✕, Close,
 * the backdrop or Escape. Returns the body element, or null if a sheet is already open.
 */
function openSheet(eyebrow, title, label, back) {
  if (rulesOpen) return null;
  const modal = document.createElement("div");
  modal.className = "rules-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", label);
  modal.innerHTML = `<div class="rules-sheet"><div class="rules-head"><div><div class="eyebrow">${esc(eyebrow)}</div><h2>${esc(title)}</h2></div>
      <button type="button" class="rules-close" data-close aria-label="Close">✕</button></div>
    <div class="rules-body"><p class="muted">Loading…</p></div>
    <button type="button" class="big" data-close>Close</button></div>`;
  document.body.appendChild(modal);
  document.body.classList.add("modal-open");
  rulesOpen = modal;
  const close = () => {
    modal.remove();
    document.body.classList.remove("modal-open");
    document.removeEventListener("keydown", onKey);
    rulesOpen = null;
    back?.focus();
  };
  const onKey = (e) => e.key === "Escape" && close();
  document.addEventListener("keydown", onKey);
  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.closest("[data-close]")) close();
  });
  modal.querySelector(".rules-close").focus();
  return modal;
}

/** Change name (D-148): this player's own, between games; refused with the reason if it is taken at the table. */
function openRename(back) {
  const me_ = self();
  const modal = openSheet(state.tableName, "Change name", "Change name", back);
  if (!modal || !me_) return;
  modal.classList.add("top"); // the field in the top third, clear of a phone's keyboard (D-245)
  const bodyEl = modal.querySelector(".rules-body");
  bodyEl.innerHTML = `<form id="rename" style="display:flex;flex-direction:column;gap:12px">
    <input type="text" name="name" maxlength="12" autocomplete="nickname" value="${esc(me_.name)}">
    <div class="join-error" role="alert"></div>
    <button class="primary big" type="submit">Save</button>
    <div class="faint" style="font-size:.8em">Up to 12 characters; each name once at a table.</div></form>`;
  const input = bodyEl.querySelector("input");
  input.focus();
  input.select();
  bodyEl.querySelector("#rename").addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = await send("lobby", "rename", { name: input.value });
    if (r.ok) modal.querySelector("[data-close]").click();
    else bodyEl.querySelector(".join-error").textContent = r.reason;
  });
}

async function fetchText(url) {
  let md = rulesCache.get(url);
  if (md === undefined) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    md = await r.text();
    rulesCache.set(url, md);
  }
  return md;
}

async function openRules() {
  const g = state?.game;
  if (!g?.howToPlay) return;
  const modal = openSheet("How to play", g.name, `How to play ${g.name}`, app.querySelector("[data-rules]"));
  if (!modal) return;
  const shown = (g.settingsShown ?? []).filter((s) => s.value !== undefined);
  const settings = shown.length
    ? `<div class="rules-settings"><div class="eyebrow">At this table</div><table>${shown
        .map((s) => `<tr><td>${esc(s.label)}</td><td>${esc(typeof s.value === "boolean" ? (s.value ? "On" : "Off") : s.value)}</td></tr>`)
        .join("")}</table></div>`
    : "";
  try {
    const md = await fetchText(g.howToPlay);
    const base = g.howToPlay.replace(/[^/]*$/, ""); // "/games/<id>/": images come from the game's own assets/
    const { title, html } = renderRules(md, base);
    if (title) modal.querySelector(".rules-head h2").innerHTML = title;
    modal.querySelector(".rules-body").innerHTML = settings + `<div class="md">${html}</div>`;
  } catch {
    modal.querySelector(".rules-body").innerHTML = settings + `<p class="muted">The rules could not be loaded. Try again in a moment.</p>`;
  }
}

// The terms of service in the same kind of sheet (D-108), not a page of their own: no "Back" that might go nowhere.
// The deck back in this window (D-133): reconnect with the saved session, which moves the deck away from the other one.
body.addEventListener("click", (e) => {
  if (!e.target.closest("[data-action=deck-here]")) return;
  const token = storage.get();
  replaced = false;
  if (!token) return render();
  retry = 0;
  connect({ sessionToken: token });
});
document.querySelector("footer a[data-terms]")?.addEventListener("click", (e) => {
  e.preventDefault();
  void openTerms(e.currentTarget);
});
async function openTerms(back) {
  const modal = openSheet("Game Table", "Terms of service", "Terms of service", back);
  if (!modal) return;
  try {
    const { html } = renderRules(await fetchText("/shared/terms.md"), "/shared/");
    modal.querySelector(".rules-body").innerHTML = `<div class="md">${html}</div>`;
  } catch {
    modal.querySelector(".rules-body").innerHTML = `<p class="muted">The terms could not be loaded. Try again in a moment.</p>`;
  }
}

/**
 * The seat badge in the player's colour (D-101), the same colour as the frame of their plate on the board (a game's
 * own colour from the board's settings (D-106), else the seat's), with near-black or white letters, whichever contrasts more.
 */
function seatBadgeHtml(p) {
  const color = colorOf(p.seat);
  const title = esc(seatTitle(state.seatEdges, p.seat));
  return `<div class="badge" style="background:${color};color:${inkOn(color)}" title="${title}, your colour" aria-label="${title}">${esc(seatBadge(state.seatEdges, p.seat))}</div>`;
}

/** A seated player's colour (D-106), as the board shows it. */
const colorOf = (seat) => playerColor({ players: state.players }, seat);

/** The seat as compass initials for the badge beside the name (D-093): "NE", "S". */
const seatBadge = (edges, seat) => seatName(edges, seat).replace(/(north|south|east|west)/g, (w) => w[0]).toUpperCase();

function render() {
  if (replaced) {
    closeGame();
    put(top, "");
    body.innerHTML = `<div class="card center"><h1>Your deck is open in another window</h1><p class="muted">Each player has one deck at a time, so a move is never made twice.</p><button class="primary" type="button" data-action="deck-here">Use this window</button></div>`;
    return;
  }
  if (removed) {
    closeGame();
    put(top, "");
    // Left from the own tab during a game (D-158): out of the game's layout, so the message shows.
    tablePanel.hidden = true;
    put(tablePanel, "");
    body.style.display = "";
    document.body.classList.remove("in-game");
    // Why: left from this phone (D-158), the seat exchanged for someone else (D-159), or removed on the board.
    const [title, text] =
      removedReason === "board"
        ? ["You play from the board now", "Your place at the table continues on the board (a developer setting). Scan the QR code again once it is switched off."]
        : removedReason === "replaced"
        ? ["Your seat went to someone else", REMOTE ? "Another player took over your seat. You keep watching the board; the table can give you a seat again." : `Another player took over your seat in this game. Scan the QR code on the board to join again; if an AI player took it, join ${myName ? `as ${esc(myName)}` : "with the same name"} to get it back.`]
        : removedReason === "left" && leftGame
          ? ["You left the game", REMOTE ? "Ask the table for a new invite to play again." : "Scan the QR code on the board to join the next game."]
          : [removedReason === "evicted" ? "You were removed from the table" : "You left the table", REMOTE ? "Ask the table for a new invite to join again." : "Scan the QR code on the board to join again. During a game, the board shows it under Settings › Show join code."];
    // Beside the board (D-175) there is no QR code to scan: a button takes a seat again.
    // With the name this deck had, the seat an AI player took over comes back with it (D-222).
    body.innerHTML = `<div class="card center"><h1>${title}</h1><p class="muted">${BOARD ? (myName ? `You can take your seat back as ${esc(myName)} from here.` : "You can take a seat again from here.") : text}</p>${BOARD ? `<button class="primary big" type="button" data-board-again>${myName ? "Take your seat back" : "Take a seat again"}</button>` : ""}</div>`;
    body.querySelector("[data-board-again]")?.addEventListener("click", () => {
      try {
        if (myName) sessionStorage.setItem(AGAIN_KEY, myName);
      } catch {}
      location.reload();
    });
    return;
  }
  if (!me) return renderJoin();
  if (!state) return void (body.innerHTML = `<p class="muted center">Connecting…</p>`);
  renderTop();
  const playing = state.phase === "active" || state.phase === "paused";
  if (playing && gameMsg) return void showGame();
  closeGame();
  if (playing) {
    body.innerHTML = `<div class="card muted">A game of ${esc(state.game?.name ?? "")} is running. You can play from the next game.</div>`;
    return;
  }
  body.innerHTML = renderLobby(self());
  body.querySelector("#ready")?.addEventListener("click", () => send("lobby", "ready", { ready: !self()?.ready }));
  body.querySelector("[data-leave]")?.addEventListener("click", () => void leave(false));
}

function renderJoin() {
  put(top, banner ? `<div class="banner">${esc(banner)}</div>` : "");
  const saved = storage.get();
  if (BOARD && againName && !ws) {
    connect({ boardKey: boardKey(), name: againName });
    joinError = "";
    againName = "";
    body.innerHTML = `<p class="muted center">Taking your seat back…</p>`;
    return;
  }
  if (saved && !ws) {
    connect({ sessionToken: saved });
    body.innerHTML = `<p class="muted center">Reconnecting…</p>`;
    return;
  }
  if (REMOTE) {
    if (!ws || ws.readyState > 1) {
      if (!banner) connect({ name: remoteName });
      body.innerHTML = banner ? `<div class="card center"><h1>Could not join</h1><p class="muted">${esc(banner)}</p></div>` : `<p class="muted center">Taking a seat…</p>`;
    }
    return;
  }
  if (!joinToken && !BOARD) {
    body.innerHTML = `<div class="card center"><h1>Join the table</h1><p class="muted">Scan the QR code on the board, or type the address shown below it. During a game, the board shows it under Settings › Show join code.</p></div>`;
    return;
  }
  if (noSeat) {
    // No free seat (D-129): instead of the name form, why not and what would help; the page looks again by itself.
    if (body.querySelector("#no-seat")?.dataset.msg === noSeat) return;
    body.innerHTML = `<div id="no-seat" class="card center"><div class="eyebrow">Game Table</div><h1>No free seat</h1>
      <p class="muted">${esc(noSeat)}</p><p class="faint" style="font-size:.85em">This page checks again by itself.</p></div>`;
    body.querySelector("#no-seat").dataset.msg = noSeat;
    return;
  }
  if (body.querySelector("#join")) return;
  body.innerHTML = `<div><div class="eyebrow">Game Table</div><h1>What should we call you?</h1></div>
    <form id="join" class="card" style="display:flex;flex-direction:column;gap:14px">
      <input type="text" name="name" maxlength="12" autocomplete="nickname" placeholder="Your name" value="${esc(suggested)}" autofocus>
      <div id="join-error" class="join-error" role="alert">${esc(joinError)}</div>
      <button class="primary big" type="submit">Take a seat</button>
      <div class="faint" style="font-size:.8em">No account needed. Up to 12 characters; each name once at a table.</div>
    </form>`;
  if (BOARD && !suggested) fetchSuggested();
  body.querySelector("#join").addEventListener("submit", (e) => {
    e.preventDefault();
    banner = "";
    joinError = "";
    body.querySelector("#join-error").textContent = "";
    const name = new FormData(e.target).get("name");
    connect(BOARD ? { boardKey: boardKey(), name } : { joinToken, name });
  });
}

/** "Leave the game" (D-158): on the Ready screen (leaves the table) and on the own tab during a game. */
function leaveHtml(inGame) {
  return `<div class="leave-row"><button type="button" class="big leave-btn" data-leave="${inGame ? "game" : "table"}">Leave the game</button></div>`;
}

/** A yes/no question in a sheet (D-158); resolves true for the confirming button. */
function confirmSheet(title, text, yes) {
  return new Promise((resolve) => {
    const modal = openSheet(state.tableName, title, title);
    if (!modal) return resolve(false);
    modal.querySelector(".rules-body").innerHTML = `<p>${esc(text)}</p>`;
    const closeBtn = modal.querySelector(".rules-sheet > button[data-close]");
    closeBtn.textContent = "Stay";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "big leave-confirm";
    ok.textContent = yes;
    closeBtn.before(ok);
    let answer = false;
    ok.addEventListener("click", () => {
      answer = true;
      closeBtn.click();
    });
    new MutationObserver((_, obs) => {
      if (!modal.isConnected) (obs.disconnect(), resolve(answer));
    }).observe(document.body, { childList: true });
  });
}

async function leave(inGame) {
  // A remote player keeps watching the board after leaving (D-168, D-170); the table can let them play again.
  const text = REMOTE
    ? inGame
      ? "You leave this game and keep watching the board. Your seat waits there; the table can hand it to someone else, or back to you."
      : "You leave the table and keep watching the board. The table can let you play again; close the window to leave altogether."
    : inGame
      ? "You leave this game. Your seat waits on the board: scan the QR code again with your name to come back to it, or the table hands it to someone else."
      : "You leave the table. To play again, scan the QR code on the board.";
  if (await confirmSheet("Leave the game?", text, "Leave the game")) send("lobby", "leave", {});
}

/** Everyone at the table with their colour and seat (D-104). */
function playersHtml() {
  return state.players
    // Each name with a dot in that player's colour (D-104), the colour of their plate on the board; no seat, no colour.
    .map((x) => `<div class="row"><span class="${x.id === me ? "me" : ""}"><span class="pdot${x.seat == null ? " none" : ""}"${x.seat == null ? "" : ` style="background:${colorOf(x.seat)}"`} aria-hidden="true"></span>${esc(x.name)}</span>
      <span class="muted">${x.seat == null ? "no seat" : `${esc(seatName(state.seatEdges, x.seat))} seat`}${state.phase === "ready" ? (x.ready ? " · ready" : " · not ready") : ""}${x.connected ? "" : " · away"}</span></div>`)
    .join("");
}

function renderLobby(p) {
  let action = `<div class="card muted">Choose a game on the board.</div>`;
  if (state.phase === "ready" && state.game) {
    action = p?.seat == null
      ? `<div class="card muted">${esc(state.game.name)} is about to start. You're not seated for this one.</div>`
      : `<div class="card"><div class="eyebrow">Up next</div><div class="display" style="font-size:1.5em;margin:4px 0 14px">${esc(state.game.name)}</div>
         <div class="ready-status ${p.ready ? "ok" : ""}"><span class="dot"></span>${p.ready ? "You are ready" : "You are not ready yet"}</div>
         <button class="${p.ready ? "" : "primary"} big" id="ready">${p.ready ? "Switch to not ready" : "Switch to ready"}</button></div>`;
  } else if (state.phase === "finished" && state.summary) {
    const t = state.summary.table;
    action = `<div class="card"><div class="eyebrow">Result</div><div class="display" style="font-size:1.3em;margin-top:6px">${esc(state.summary.text)}</div>
      ${t ? `<div class="summary-scroll"><table class="summary-table"><tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table></div>` : ""}</div>`;
  }
  const leaveRow = state.phase === "ready" && state.game && p?.seat != null ? leaveHtml(false) : "";
  return `${action}<div class="card list"><div class="eyebrow" style="margin-bottom:6px">At the table</div>${playersHtml()}</div>${leaveRow}`;
}

// ---------- the game's own deck UI ----------
let game = null; // { key, inst }

/**
 * How this player sees the game's board (D-151): `viewEdge`, the table edge they look from (their seat's at the table;
 * on a remote player's own board, the edge at the bottom of their screen, D-059/D-101), and `boardEdge`, the edge the
 * game faces on that board (the table's facing, or the remote board's own). With them a game can turn a map on the
 * phone the way the player sees the board: a direction on the phone is the same direction on the table.
 */
function boardView() {
  const seat = self()?.seat ?? null;
  const own = seat === null ? null : (state.seatEdges?.[seat] ?? null);
  if (REMOTE) {
    let landscape = false;
    try {
      landscape = localStorage.getItem(`gametable.remote.${params.get("inv") ?? ""}.landscape`) === "1";
    } catch {}
    const edge = own && (own === "east" || own === "west") && landscape ? "south" : (own ?? state.frontEdge ?? "south");
    return { viewEdge: edge, boardEdge: edge };
  }
  return { viewEdge: own ?? "south", boardEdge: state.gameFacing ?? "south" };
}

function info() {
  return {
    seat: gameMsg?.seat,
    me: self(),
    seatEdges: state.seatEdges ?? [],
    ...boardView(),
    players: state.players,
    seatColors: state.seatColors ?? {}, // seats whose player left keep their colour (D-125)
    settings: state.game?.settings ?? {},
    prefs: state.game?.prefs ?? {},
    timers: gameMsg?.timers ?? {},
    now: gameMsg?.now ?? Date.now(),
    receivedAt: gameMsg?.receivedAt ?? Date.now(),
    over: gameMsg?.over ?? false,
    // The board has shown these moves already (D-143, D-157): a game that stages moves on the phone can skip that.
    shownOnBoard: !!gameMsg?.afterBoard,
    // AI players thinking for more than a moment (D-112): { playerId, seat, since, deadline } in host time.
    aiThinking: state.aiThinking ?? [],
  };
}

async function showGame() {
  const key = `${state.game.id}@${state.game.version}`;
  if (!game || game.key !== key) {
    closeGame();
    game = { key, inst: null };
    const mine = game;
    body.innerHTML = "";
    let mod;
    try {
      mod = await import(`/games/${state.game.id}/deck.js?v=${encodeURIComponent(state.game.version)}`);
    } catch {
      mod = { mount: genericDeck };
    }
    if (game !== mine) return;
    mine.inst = mod.mount(body, {
      gameId: state.game.id,
      seat: gameMsg.seat,
      // A rejected intent shows its reason here, so games need not toast it themselves.
      send: (name, payload) =>
        send("game", "intent", { name, payload }).then((r) => {
          if (!r.ok) toast(r.reason);
          return r;
        }),
      // A live gesture for the boards (the sling, D-189): fire and forget, no answer, not logged.
      gesture: (data) => {
        if (ws?.readyState === 1) ws.send(JSON.stringify({ v: 1, ch: "game", type: "gesture", payload: data }));
      },
      toast,
      vibrate: (ms = 40) => navigator.vibrate?.(ms),
      assetUrl: (p) => `/games/${state.game.id}/assets/${p}`,
    });
  }
  // A message's events go to the game once; a redraw for anything else (the lobby, the tabs) passes none, as on the
  // board, so nothing animates twice.
  if (!game.inst) return;
  const events = gameMsg.delivered ? [] : (gameMsg.events ?? []);
  gameMsg.delivered = true;
  game.inst.update(gameMsg.view, events, info());
}

// A remote player switching their board between turned and full width (D-101) changes how they see it: tell the game.
addEventListener("storage", (e) => {
  if (REMOTE && e.key?.endsWith(".landscape") && gameMsg) game?.inst?.update(gameMsg.view, [], info());
});

function closeGame() {
  if (!game) return;
  try {
    game.inst?.destroy?.();
  } catch {}
  game = null;
  body.innerHTML = "";
}

/** Fallback for games without their own deck UI. */
function genericDeck(root) {
  const pre = document.createElement("pre");
  const card = document.createElement("div");
  card.className = "card";
  card.appendChild(pre);
  root.appendChild(card);
  return { update: (view) => (pre.textContent = JSON.stringify(view, null, 2)) };
}

render();
// Joining by QR code (D-129): is there a seat? Asked before the name form, so nobody types a name for nothing.
if (joinToken && !REMOTE && !storage.get()) void checkSeat();
/** The deck beside the board (D-175) starts with a name too (D-245): "Player N", as a phone that scans the code. */
function fetchSuggested() {
  fetch("/suggested-name", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((b) => {
      if (!b?.name) return;
      suggested = b.name;
      const field = body.querySelector("#join input[name=name]");
      if (field && !field.value) field.value = suggested;
    })
    .catch(() => {});
}
