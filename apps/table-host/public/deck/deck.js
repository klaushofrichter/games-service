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
let seq = 0;
let retry = 0;
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
      } else if (m.type === "removed") {
        removed = true;
        storage.clear();
      } else if (m.type === "error" || m.type === "reject") {
        const msg = m.payload.message ?? m.payload.reason;
        if (m.payload.status === 403) {
          storage.clear();
          me = null;
          banner = msg;
        } else if (!resolve) toast(msg);
      }
    } else if (m.ch === "lobby" && m.type === "state") {
      state = m.payload;
      if (state.phase !== "active" && state.phase !== "paused") gameMsg = null;
    } else if (m.ch === "game" && m.type === "view") {
      gameMsg = { ...m.payload, receivedAt: Date.now() };
      if (navigator.vibrate && m.payload.view?.myTurn && !m.payload.events?.length) navigator.vibrate(60);
    }
    render();
  };
  ws.onclose = (ev) => {
    for (const r of pending.values()) r({ ok: false, reason: "connection lost" });
    pending.clear();
    if (removed || ev.code === 4003) return render();
    const token = storage.get();
    if (!token) return render();
    banner = "Reconnecting…";
    render();
    setTimeout(() => connect({ sessionToken: token }), Math.min(5000, 500 * 2 ** retry++));
  };
}

// ---------- layout: a header that re-renders freely, and a body the game module owns ----------

app.innerHTML = `<div id="top"></div><div id="body"></div>`;
const top = app.querySelector("#top");
const body = app.querySelector("#body");
body.style.cssText = "display:flex;flex-direction:column;gap:18px";
top.style.cssText = "display:flex;flex-direction:column;gap:18px";

function self() {
  return state?.players.find((p) => p.id === me);
}

function renderTop() {
  if (!me || !state || removed) return;
  const p = self();
  const inGame = gameMsg && (state.phase === "active" || state.phase === "paused");
  const paused = state.phase === "paused" ? `<div class="banner">Game paused: the table lost its connection. It continues by itself when the connection is back.</div>` : "";
  top.innerHTML = `${paused}${banner ? `<div class="banner">${esc(banner)}</div>` : ""}
    <div class="who"><div><div class="eyebrow">${esc(state.tableName)}${inGame ? ` · ${esc(state.game?.name)}` : ""}</div><h1>${esc(p?.name ?? "")}</h1></div>
      <div class="who-side">${state.game?.howToPlay ? `<button type="button" class="rules-btn" data-rules aria-haspopup="dialog">Rules</button>` : ""}
      ${p?.seat == null ? "" : seatBadgeHtml(p)}</div></div>
    ${inGame || p?.seat != null ? "" : `<div class="card muted">No seat yet. You'll get one when a seat opens.</div>`}`;
}

// ---------- game rules (D-099): the chosen game's how-to-play.md in a modal, with this table's settings on top ----------

const rulesCache = new Map(); // url -> markdown
let rulesOpen = null; // the open modal element

top.addEventListener("click", (e) => {
  if (e.target.closest("[data-rules]")) void openRules();
});

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
  const modal = openSheet("How to play", g.name, `How to play ${g.name}`, top.querySelector("[data-rules]"));
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
  const color = playerColor({ players: state.players, prefs: state.game?.prefs ?? {} }, p.seat);
  const title = esc(seatTitle(state.seatEdges, p.seat));
  return `<div class="badge" style="background:${color};color:${inkOn(color)}" title="${title}, your colour" aria-label="${title}">${esc(seatBadge(state.seatEdges, p.seat))}</div>`;
}

/** The seat as compass initials for the badge beside the name (D-093): "NE", "S". */
const seatBadge = (edges, seat) => seatName(edges, seat).replace(/(north|south|east|west)/g, (w) => w[0]).toUpperCase();

function render() {
  if (removed) {
    closeGame();
    top.innerHTML = "";
    body.innerHTML = `<div class="card center"><h1>You left the table</h1><p class="muted">${REMOTE ? "Ask the table for a new invite to join again." : "Scan the QR code on the board to join again."}</p></div>`;
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
    body.innerHTML = `<div class="card center"><h1>Join the table</h1><p class="muted">Scan the QR code on the board, or type the address shown below it.</p></div>`;
    return;
  }
  if (body.querySelector("#join")) return;
  body.innerHTML = `<div><div class="eyebrow">Game Table</div><h1>What should we call you?</h1></div>
    <form id="join" class="card" style="display:flex;flex-direction:column;gap:14px">
      <input type="text" name="name" maxlength="24" autocomplete="nickname" placeholder="Your name" autofocus>
      <button class="primary big" type="submit">Take a seat</button>
      <div class="faint" style="font-size:.8em">No account needed. Any name works.</div>
    </form>`;
  body.querySelector("#join").addEventListener("submit", (e) => {
    e.preventDefault();
    banner = "";
    connect({ joinToken, name: new FormData(e.target).get("name") });
  });
}

function renderLobby(p) {
  const players = state.players
    // Each name with a dot in that player's colour (D-104), the colour of their plate on the board; no seat, no colour.
    .map((x) => `<div class="row"><span class="${x.id === me ? "me" : ""}"><span class="pdot${x.seat == null ? " none" : ""}"${x.seat == null ? "" : ` style="background:${playerColor({ players: state.players, prefs: state.game?.prefs ?? {} }, x.seat)}"`} aria-hidden="true"></span>${esc(x.name)}</span>
      <span class="muted">${x.seat == null ? "no seat" : `${esc(seatName(state.seatEdges, x.seat))} seat`}${state.phase === "ready" ? (x.ready ? " · ready" : " · not ready") : ""}${x.connected ? "" : " · away"}</span></div>`)
    .join("");
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
      ${t ? `<table class="summary-table"><tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>` : ""}</div>`;
  }
  return `${action}<div class="card list"><div class="eyebrow" style="margin-bottom:6px">At the table</div>${players}</div>`;
}

// ---------- the game's own deck UI ----------
let game = null; // { key, inst }

function info() {
  return {
    seat: gameMsg?.seat,
    me: self(),
    players: state.players,
    settings: state.game?.settings ?? {},
    prefs: state.game?.prefs ?? {},
    timers: gameMsg?.timers ?? {},
    now: gameMsg?.now ?? Date.now(),
    receivedAt: gameMsg?.receivedAt ?? Date.now(),
    over: gameMsg?.over ?? false,
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
