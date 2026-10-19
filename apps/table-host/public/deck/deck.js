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
const SESSION_KEY = REMOTE ? `gametable.remote.${params.get("inv") ?? ""}` : `gametable.session.${location.host}`;

let ws = null;
let me = null; // playerId
let state = null;
let gameMsg = null; // last game.view message { seat, view, events, timers, now, receivedAt }
let banner = "";
let removed = false;
let replaced = false; // this player's deck opened in another window (D-133)
let seq = 0;
let retry = 0;
/** Why the name typed on the join form was refused (D-148): taken at this table, or not allowed. */
let joinError = "";
/** No free seat at the table (D-129): the reason, shown instead of the name form until a seat is free. */
let noSeat = null;
let seatTimer = null;

/** Ask the table whether a seat is free for this join code; look again every few seconds while there is none. */
async function checkSeat() {
  try {
    const r = await fetch(`/j/${encodeURIComponent(joinToken)}/seat`, { cache: "no-store" });
    if (!r.ok) return; // an old code: the hello says so
    const b = await r.json();
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

function toast(msg) {
  banner = msg;
  renderTop();
  setTimeout(() => {
    if (banner === msg) {
      banner = "";
      renderTop();
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
        storage.clear();
      } else if (m.type === "error" || m.type === "reject") {
        const msg = m.payload.message ?? m.payload.reason;
        if (m.payload.status === 403) {
          storage.clear();
          me = null;
          banner = msg;
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
  const banners = `${paused}${banner ? `<div class="banner">${esc(banner)}</div>` : ""}`;
  if (inGame) {
    const color = p?.seat == null ? null : colorOf(p.seat);
    top.innerHTML = `${banners}<div class="tabs" role="tablist" aria-label="Deck">
      <button type="button" role="tab" id="tab-table" data-tab="table" aria-selected="${tab === "table"}" aria-controls="table">
        ${color ? `<span class="pdot" style="background:${color}" aria-hidden="true"></span>` : ""}<span class="tab-name">${esc(p?.name ?? "")}</span>${p?.seat == null ? "" : `<span class="tab-seat">${esc(seatBadge(state.seatEdges, p.seat))}</span>`}</button>
      <button type="button" role="tab" id="tab-game" data-tab="game" aria-selected="${tab === "game"}" aria-controls="body">${esc(state.game?.name ?? "Game")}</button></div>`;
    body.setAttribute("aria-labelledby", "tab-game");
    tablePanel.innerHTML = tab === "table" ? `${whoHtml(p, true)}<div class="card list"><div class="eyebrow" style="margin-bottom:6px">At the table</div>${playersHtml()}</div>
      <div class="center"><a href="/deck/terms.html" data-terms class="faint">Terms of service</a></div>` : "";
  } else {
    tab = "game";
    tablePanel.innerHTML = "";
    top.innerHTML = `${banners}${whoHtml(p, false)}
    ${p?.seat != null ? "" : `<div class="card muted">No seat yet. You'll get one when a seat opens.</div>`}`;
  }
  tablePanel.hidden = !(inGame && tab === "table");
  body.style.display = inGame && tab === "table" ? "none" : "";
}

/** The player's name, the Rules button and the seat badge: the header outside a game, the top of the own tab in one. */
function whoHtml(p, inGame) {
  return `<div class="who"><div><div class="eyebrow">${esc(state.tableName)}${inGame ? ` · ${esc(state.game?.name)}` : ""}</div><h1>${esc(p?.name ?? "")}</h1></div>
      <div class="who-side">${inGame || p?.kind !== "human" ? "" : `<button type="button" class="rules-btn" data-rename aria-haspopup="dialog">Change name</button>`}
      ${state.game?.howToPlay ? `<button type="button" class="rules-btn" data-rules aria-haspopup="dialog">Rules</button>` : ""}
      ${p?.seat == null ? "" : seatBadgeHtml(p)}</div></div>`;
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
const colorOf = (seat) => playerColor({ players: state.players, seatColors: state.seatColors ?? {} }, seat);

/** The seat as compass initials for the badge beside the name (D-093): "NE", "S". */
const seatBadge = (edges, seat) => seatName(edges, seat).replace(/(north|south|east|west)/g, (w) => w[0]).toUpperCase();

function render() {
  if (replaced) {
    closeGame();
    top.innerHTML = "";
    body.innerHTML = `<div class="card center"><h1>Your deck is open in another window</h1><p class="muted">Each player has one deck at a time, so a move is never made twice.</p><button class="primary" type="button" data-action="deck-here">Use this window</button></div>`;
    return;
  }
  if (removed) {
    closeGame();
    top.innerHTML = "";
    body.innerHTML = `<div class="card center"><h1>You left the table</h1><p class="muted">${REMOTE ? "Ask the table for a new invite to join again." : "Scan the QR code on the board to join again. During a game, the board shows it under Settings › Show join code."}</p></div>`;
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
}

function renderJoin() {
  top.innerHTML = banner ? `<div class="banner">${esc(banner)}</div>` : "";
  const saved = storage.get();
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
  if (!joinToken) {
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
      <input type="text" name="name" maxlength="12" autocomplete="nickname" placeholder="Your name" autofocus>
      <div id="join-error" class="join-error" role="alert">${esc(joinError)}</div>
      <button class="primary big" type="submit">Take a seat</button>
      <div class="faint" style="font-size:.8em">No account needed. Up to 12 characters; each name once at a table.</div>
    </form>`;
  body.querySelector("#join").addEventListener("submit", (e) => {
    e.preventDefault();
    banner = "";
    joinError = "";
    body.querySelector("#join-error").textContent = "";
    connect({ joinToken, name: new FormData(e.target).get("name") });
  });
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
  return `${action}<div class="card list"><div class="eyebrow" style="margin-bottom:6px">At the table</div>${playersHtml()}</div>`;
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
      toast,
      vibrate: (ms = 40) => navigator.vibrate?.(ms),
      assetUrl: (p) => `/games/${state.game.id}/assets/${p}`,
    });
  }
  game.inst?.update(gameMsg.view, gameMsg.events ?? [], info());
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
