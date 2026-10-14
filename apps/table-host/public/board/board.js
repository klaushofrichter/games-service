// Board UI: lobby, seats around the edge, QR join, game surface and the lobby overlay.
// Talks to the Table Host through the board control API (same API the tests and local AI agents use).
import { ROT, W, H, audio, copyText, esc, seatName, seatPositions, claimServiceWorkerPage, openTableSocket } from "/shared/board-kit.js";

const KEY = window.TABLE_KEY;
// A remote player's copy of the board (phase 1c): it runs inside the cloud's invite page, which carries
// requests and the live socket over a WebRTC channel. No table key, no join code, no simulations.
const REMOTE = !!window.REMOTE_BOARD;
const REMOTE_INV = new URLSearchParams(location.search).get("inv") ?? "";
if (REMOTE) claimServiceWorkerPage();
const surface = document.getElementById("surface");
const seatsEl = document.getElementById("seats");
const center = document.getElementById("center");
const lobbyBtn = document.getElementById("lobby-button");
const overlayRoot = document.getElementById("overlay-root");
const gameLayer = document.getElementById("game-layer");
const pauseLayer = document.getElementById("pause-layer");
const cornersEl = document.getElementById("corners");
const settingsBtn = document.getElementById("settings-button");
const resultBtn = document.getElementById("result-button");

let state = null;
let games = [];
let gameMsg = null; // last game.board message
let selectedPlayer = null;

// ---------- API ----------
async function api(method, path, body) {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: { ...(KEY ? { "x-table-key": KEY } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    toast(data.error ?? `Request failed (${res.status})`);
    throw new Error(data.error);
  }
  return data;
}
const act = (method, path, body) => api(method, path, body).catch(() => {});

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// Dialogs and overlays face the current front edge, like the rest of the board.
function faceFront(el) {
  if (state) el.style.transform = `rotate(${ROT[viewEdge()]}deg)`;
  return el;
}

function confirmDialog(title, text, okLabel = "Confirm") {
  return new Promise((resolve) => {
    const d = document.createElement("div");
    d.className = "dialog-backdrop";
    d.innerHTML = `<div class="dialog"><h2>${esc(title)}</h2><div class="muted">${esc(text)}</div>
      <div class="actions"><button data-x="no">Cancel</button><button class="primary" data-x="yes">${esc(okLabel)}</button></div></div>`;
    d.addEventListener("click", (e) => {
      const x = e.target.dataset?.x;
      if (x || e.target === d) {
        d.remove();
        resolve(x === "yes");
      }
    });
    faceFront(d.querySelector(".dialog"));
    overlayRoot.appendChild(d);
  });
}

/**
 * A small form for manifest-described fields (game settings, AI options). Resolves with the values,
 * or null when cancelled.
 */
function formDialog(title, intro, fields, values = {}, okLabel = "OK") {
  return new Promise((resolve) => {
    const d = document.createElement("div");
    d.className = "dialog-backdrop";
    const input = (f) => {
      const v = values[f.key] ?? f.default;
      if (f.type === "enum") return `<select name="${f.key}">${f.values.map((x) => `<option ${String(v) === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
      if (f.type === "bool") return `<input type="checkbox" name="${f.key}" ${v ? "checked" : ""}>`;
      if (f.type === "int" || f.type === "number") return `<input type="number" name="${f.key}" value="${esc(v)}" ${f.min !== undefined ? `min="${f.min}"` : ""} ${f.max !== undefined ? `max="${f.max}"` : ""}>`;
      return `<input type="text" name="${f.key}" value="${esc(v ?? "")}">`;
    };
    d.innerHTML = `<div class="dialog form"><h2>${esc(title)}</h2>${intro ? `<div class="muted">${esc(intro)}</div>` : ""}
      <div class="fields">${fields.map((f) => `<label><span>${esc(f.label ?? f.key)}</span>${input(f)}</label>`).join("") || `<div class="faint">Nothing to set for this game.</div>`}</div>
      <div class="actions"><button data-x="no">Cancel</button><button class="primary" data-x="yes">${esc(okLabel)}</button></div></div>`;
    d.addEventListener("click", (e) => {
      const x = e.target.closest("button")?.dataset.x;
      if (!x && e.target !== d) return;
      let out = null;
      if (x === "yes") {
        out = {};
        for (const f of fields) {
          const el = d.querySelector(`[name="${f.key}"]`);
          out[f.key] = f.type === "bool" ? el.checked : f.type === "int" || f.type === "number" ? Number(el.value) : el.value;
        }
      }
      d.remove();
      resolve(out);
    });
    faceFront(d.querySelector(".dialog"));
    overlayRoot.appendChild(d);
  });
}

async function chooseGame(id) {
  const g = games.find((x) => x.id === id);
  if (!g) return;
  const settings = await formDialog(g.name, g.description, g.settings ?? [], {}, "Choose this game");
  if (settings) act("POST", "/game/select", { gameId: id, settings });
}

async function configureAi(playerId) {
  const p = state.players.find((x) => x.id === playerId);
  if (!state.game) return toast("Pick a game first: AI options depend on the game");
  const g = games.find((x) => x.id === state.game.id);
  const opts = await formDialog(`${p.name} · ${g.name}`, "How this AI player plays.", g.aiOptions ?? [], p.aiOptions ?? {}, "Save");
  if (opts) act("POST", `/players/${playerId}/ai-options`, { options: opts });
}

// ---------- orientation ----------
// The table's board faces `frontEdge` (turned with the rotate buttons). A remote player's copy instead
// turns the whole surface so their own seat is at the bottom of their screen, and faces text to it.
// Their deck (same origin) records which player they are.
function myEdge() {
  if (!REMOTE || !state) return null;
  let id = null;
  try {
    id = localStorage.getItem(`gametable.remote.${REMOTE_INV}.player`);
  } catch {}
  const p = id && state.players.find((x) => x.id === id);
  return p && p.seat !== null ? state.seatEdges[p.seat] ?? null : null;
}
const viewEdge = () => myEdge() ?? state.frontEdge;
if (REMOTE) window.addEventListener("storage", (e) => e.key?.startsWith("gametable.remote.") && state && (render(), game?.inst && gameMsg && game.inst.update(gameMsg.view, [], gameInfo())));

// ---------- scaling ----------
function fit() {
  const e = myEdge();
  const sideways = e === "east" || e === "west";
  const s = sideways ? Math.min(window.innerWidth / H, window.innerHeight / W) : Math.min(window.innerWidth / W, window.innerHeight / H);
  surface.style.transform = `${e ? `rotate(${-ROT[e]}deg) ` : ""}scale(${s})`;
}
window.addEventListener("resize", fit);
// A board inside a frame (remote play) can start hidden at zero size; refit whenever the window changes.
if (window.ResizeObserver) new ResizeObserver(fit).observe(document.documentElement);
fit();

// ---------- seats ----------
function renderSeats() {
  const pos = seatPositions(state.seatEdges);
  const playing = state.phase === "active" || state.phase === "paused";
  const allowed = state.game?.edges;
  seatsEl.innerHTML = "";
  pos.forEach((p, seat) => {
    const pl = state.players.find((x) => x.seat === seat);
    const el = document.createElement("div");
    el.className = "seat";
    if (pl) el.classList.add("taken");
    if (pl?.kind === "ai") el.classList.add("ai");
    if (pl && !pl.connected) el.classList.add("away");
    if (pl?.ready) el.classList.add("ready");
    if (pl && pl.id === selectedPlayer) el.classList.add("selected");
    if (allowed && !allowed.includes(p.edge)) el.classList.add("unused");
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.style.transform = `translate(-50%, -50%) rotate(${p.rot}deg)`;
    const status = !pl
      ? "Open seat"
      : !pl.connected
        ? "Reconnecting…"
        : state.phase === "ready" // AI players are always ready, and show it like everyone else (D-089)
          ? `<span class="dot"></span>${pl.ready ? "Ready" : "Not ready"}`
          : pl.kind === "ai" ? `AI player${pl.aiOptions ? ` · ${esc(Object.values(pl.aiOptions).join(", "))}` : ""}` : pl.location === "remote" ? "Remote" : "";
    el.innerHTML = `<div class="num">${esc(seatName(state.seatEdges, seat))}</div>
      <div class="name">${pl ? esc(pl.name) : "—"}</div><div class="status">${status}</div>`;
    if (!playing && !REMOTE) el.addEventListener("click", () => onSeatTap(seat, pl)); // seating stays with the table
    seatsEl.appendChild(el);
  });
}

function onSeatTap(seat, pl) {
  if (selectedPlayer && (!pl || pl.id !== selectedPlayer)) {
    act("POST", "/seats/move", { playerId: selectedPlayer, seat });
    selectedPlayer = null;
    return;
  }
  selectedPlayer = pl && pl.id !== selectedPlayer ? pl.id : null;
  render();
}

// ---------- corner buttons: which edge the lobby faces ----------
// Unobtrusive buttons in the board's corners turn the lobby and its menus toward one edge (D-080). Not during play
// (a game's own lobby button lives in a corner), and not on a remote player's copy: turning stays with the table.
const EDGE_ORDER = ["north", "east", "south", "west"];
const CORNERS = [
  { edge: "north", pos: "tl", arrow: 0 },
  { edge: "east", pos: "tr", arrow: 90 },
  { edge: "south", pos: "br", arrow: 180 },
  { edge: "west", pos: "bl", arrow: 270 },
];
function renderCorners(hide) {
  cornersEl.hidden = REMOTE || hide;
  if (cornersEl.hidden) return;
  cornersEl.innerHTML = CORNERS.map(({ edge, pos, arrow }) =>
    `<button class="corner ${pos} ${state.frontEdge === edge ? "on" : ""}" data-face="${edge}" title="Face ${edge}" aria-label="Turn the lobby to face ${edge}">
      <svg viewBox="0 0 24 24" width="22" height="22" style="transform:rotate(${arrow}deg)"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`).join("");
}
cornersEl.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-face]");
  if (b && b.dataset.face !== state.frontEdge) act("POST", "/face", { edge: b.dataset.face });
});

// Browsers keep sound off until the page is touched: wake the audio on the first touch (D-092).
window.addEventListener("pointerdown", () => audio(), { capture: true });

let lastPhase = null;
let holdFinal = false;
resultBtn.addEventListener("click", () => {
  holdFinal = false;
  render();
});

// ---------- settings (D-088) ----------
// A gear beside the corner at the left end of the edge the board faces (as seen from that edge), turned to it.
// During a game it moves to the other end of that edge if the game's Lobby button sits in that corner.
// Not on a remote player's copy: settings stay with the table.
const FRONT_CORNERS = { south: ["bl", "br"], west: ["tl", "bl"], north: ["tr", "tl"], east: ["br", "tr"] };
const LOBBY_CORNER = { "top-left": "tl", "top-right": "tr", "bottom-left": "bl", "bottom-right": "br" };
function placeSettings(playing) {
  settingsBtn.hidden = REMOTE;
  if (REMOTE) return;
  const front = viewEdge();
  let [corner, other] = FRONT_CORNERS[front];
  if (playing && LOBBY_CORNER[state.game?.lobbyButton ?? "bottom-right"] === corner) corner = other;
  settingsBtn.className = `${corner} along-${front === "south" || front === "north" ? "x" : "y"}`;
  settingsBtn.querySelector("svg").style.transform = `rotate(${ROT[front]}deg)`;
}
settingsBtn.addEventListener("click", () => openSettings());

/**
 * The settings modal: the board's own settings (Fullscreen), then whatever the chosen game adds. A game adds
 * items by exporting settings({ info, setPrefs }) from its board.js; each item is
 *   { type: "toggle", label, value, onChange(next) }   { type: "choice", label, value, options: [{ value, label }], onChange }
 *   { type: "swatches", label, value, options: ["#rrggbb", …], onChange }   { type: "button", label, onChange() }
 * setPrefs(patch) stores display choices for this game on the table; board and decks get them as info.prefs.
 */
let settingsOverlay = null;
function openSettings() {
  if (settingsOverlay) return;
  const o = (settingsOverlay = document.createElement("div"));
  o.className = "overlay settings";
  let mod = null; // the chosen game's board module, for its settings()
  let modFor = null;
  let items = [];
  const setPrefs = (prefs) => act("POST", "/game/prefs", { prefs });
  const loadGame = () => {
    const g = state?.game;
    const key = g ? `${g.id}@${g.version}` : null;
    if (key === modFor) return;
    modFor = key;
    mod = null;
    if (g) import(`/games/${g.id}/board.js?v=${encodeURIComponent(g.version)}`).then((m) => modFor === key && ((mod = m), draw())).catch(() => {});
  };
  const control = (it, k) => {
    if (it.type === "toggle") return `<button data-item="${k}" class="${it.value ? "on" : ""}" role="switch" aria-checked="${!!it.value}">${it.value ? "On" : "Off"}</button>`;
    if (it.type === "button") return `<button data-item="${k}">${esc(it.action ?? it.label)}</button>`;
    if (it.type === "swatches")
      return `<span class="swatches">${it.options.map((c, i) => `<button class="swatch ${c === it.value ? "on" : ""}" style="--c:${esc(c)}" data-item="${k}" data-val="${i}" aria-label="${esc(it.label)}: colour ${i + 1}"></button>`).join("")}</span>`;
    return `<span class="seg">${it.options.map((op, i) => `<button class="${op.value === it.value ? "on" : ""}" data-item="${k}" data-val="${i}">${esc(op.label ?? op.value)}</button>`).join("")}</span>`;
  };
  const draw = () => {
    if (!state) return;
    loadGame();
    try {
      items = (state.game && mod?.settings?.({ info: gameInfo(), setPrefs })) || [];
    } catch (err) {
      console.error("game settings failed", err);
      items = [];
    }
    const fs = document.fullscreenEnabled;
    // The chosen game's own settings from its manifest (D-090): editable until it starts, then shown read-only.
    const fields = (state.game && games.find((x) => x.id === state.game.id)?.settings) || [];
    const editable = state.phase === "ready";
    const cur = state.game?.settings ?? {};
    const setting = (f) => {
      const v = cur[f.key] ?? f.default;
      if (!editable) return `<span class="value">${esc(f.type === "bool" ? (v ? "On" : "Off") : v)}</span>`;
      if (f.type === "int" || f.type === "number")
        return `<span class="stepper"><button data-setting="${esc(f.key)}" data-delta="-1" ${f.min !== undefined && v <= f.min ? "disabled" : ""} aria-label="Less">−</button>
          <span class="value">${esc(v)}</span><button data-setting="${esc(f.key)}" data-delta="1" ${f.max !== undefined && v >= f.max ? "disabled" : ""} aria-label="More">+</button></span>`;
      if (f.type === "bool") return `<button data-setting="${esc(f.key)}" data-toggle class="${v ? "on" : ""}" role="switch" aria-checked="${!!v}">${v ? "On" : "Off"}</button>`;
      if (f.type === "enum") return `<span class="seg">${f.values.map((x) => `<button class="${String(v) === x ? "on" : ""}" data-setting="${esc(f.key)}" data-value="${esc(x)}">${esc(x)}</button>`).join("")}</span>`;
      return `<span class="value">${esc(v)}</span>`;
    };
    const gameSettings = fields.length
      ? `<div class="group game-rules"><div class="eyebrow">${esc(state.game.name)} · game settings</div>
          ${fields.map((f) => `<div class="row"><span>${esc(f.label ?? f.key)}</span>${setting(f)}</div>`).join("")}
          ${editable ? "" : `<div class="faint" style="font-size:.7em;margin-top:6px">These can be changed before the game starts.</div>`}</div>`
      : "";
    o.innerHTML = `<div class="panel"><h2>Settings</h2>
      <div class="group"><div class="eyebrow">Display</div>
        <div class="row"><span>Sound effects</span><button data-sound class="${state.display?.sound !== false ? "on" : ""}" role="switch" aria-checked="${state.display?.sound !== false}">${state.display?.sound !== false ? "On" : "Off"}</button></div>
        <div class="row"><span>Fullscreen</span>${fs ? `<button data-fs class="${document.fullscreenElement ? "on" : ""}">${document.fullscreenElement ? "Leave fullscreen" : "Fullscreen"}</button>` : `<span class="faint">not available in this browser</span>`}</div></div>
      ${gameSettings}
      ${items.length ? `<div class="group game-settings"><div class="eyebrow">${esc(state.game.name)}</div>${items.map((it, k) => `<div class="row"><span>${esc(it.label)}</span>${control(it, k)}</div>`).join("")}</div>` : ""}
      <div class="actions" style="display:flex;justify-content:flex-end;margin-top:20px"><button class="primary" data-close-overlay>Done</button></div></div>`;
    faceFront(o.querySelector(".panel"));
  };
  const close = () => {
    unsub();
    document.removeEventListener("fullscreenchange", draw);
    o.remove();
    settingsOverlay = null;
  };
  draw();
  const unsub = onState(draw);
  document.addEventListener("fullscreenchange", draw);
  o.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (e.target === o || b?.dataset.closeOverlay !== undefined) return close();
    if (!b) return;
    if (b.dataset.fs !== undefined) {
      (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => toast("Fullscreen was refused by the browser"));
    }
    if (b.dataset.sound !== undefined) return void act("POST", "/display", { sound: state.display?.sound === false });
    if (b.dataset.setting) {
      const f = ((state.game && games.find((x) => x.id === state.game.id)?.settings) || []).find((x) => x.key === b.dataset.setting);
      if (!f) return;
      const v = state.game.settings?.[f.key] ?? f.default;
      let next = v;
      if (b.dataset.delta) {
        const step = f.step ?? (f.type === "int" ? 1 : 0.5);
        next = Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, Number(v) + Number(b.dataset.delta) * step));
      } else if (b.dataset.toggle !== undefined) next = !v;
      else if (b.dataset.value !== undefined) next = b.dataset.value;
      if (next !== v) act("POST", "/game/settings", { settings: { [f.key]: next } });
      return;
    }
    const it = items[Number(b.dataset.item)];
    if (!it || b.dataset.item === undefined) return;
    if (it.type === "toggle") it.onChange?.(!it.value);
    else if (it.type === "button") it.onChange?.();
    else it.onChange?.(it.type === "swatches" ? it.options[Number(b.dataset.val)] : it.options[Number(b.dataset.val)].value);
  });
  overlayRoot.appendChild(o);
}

// ---------- center panel ----------
function render() {
  if (!state) return;
  renderSeats();
  if (REMOTE) fit();
  const front = viewEdge();
  center.style.transform = `rotate(${ROT[front]}deg)`;
  center.classList.toggle("sideways", front === "east" || front === "west");

  const playing = state.phase === "active" || state.phase === "paused" || state.phase === "terminating";
  // A game that ends by itself keeps its last screen until someone taps Show result (D-091); one ended from the
  // lobby goes straight to the result. This is per screen: each board (and remote board) moves on by itself.
  if (state.phase === "finished" && (lastPhase === "active" || lastPhase === "paused") && game) holdFinal = true;
  if (state.phase !== "finished") holdFinal = false;
  lastPhase = state.phase;
  const showingGame = playing || holdFinal;
  lobbyBtn.hidden = !playing;
  lobbyBtn.className = state.game?.lobbyButton ?? "bottom-right";
  resultBtn.hidden = !holdFinal;
  resultBtn.className = `primary ${state.game?.lobbyButton ?? "bottom-right"}`;

  renderPause();
  renderCorners(showingGame && state.phase !== "paused");
  placeSettings(showingGame);
  seatsEl.hidden = showingGame;
  center.hidden = showingGame;
  gameLayer.hidden = !showingGame;
  if (showingGame) return void showGame();
  closeGame();
  if (state.phase === "finished") return renderFinished();
  if (state.phase === "ready") return renderReady();
  renderLobby();
}

function cloudNotice() {
  const c = state.cloud;
  if (c.status === "pending") return `<div class="cloud">Waiting for an admin to approve this table · pairing code <b>${esc(c.pairingCode)}</b></div>`;
  if (c.status === "offline") return `<div class="cloud">The table is offline · new games start when the connection returns</div>`;
  if (c.status === "revoked") return `<div class="cloud">This table was disconnected by an admin. It reconnects by itself once an admin presses Reconnect in the console.</div>`;
  return "";
}

// ---------- copying links (D-094) ----------
const COPY_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const DONE_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
/** A link with a copy button beside it. */
const linkLine = (url) =>
  `<div class="url-line"><span class="url">${esc(url)}</span><button type="button" class="copy" data-copy="${esc(url)}" title="Copy link" aria-label="Copy link">${COPY_ICON}</button></div>`;
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-copy]");
  if (!b) return;
  e.stopPropagation();
  if (!(await copyText(b.dataset.copy))) return toast("Copying is not available in this browser");
  b.innerHTML = DONE_ICON;
  b.classList.add("done");
  b.title = "Copied";
  setTimeout(() => {
    b.innerHTML = COPY_ICON;
    b.classList.remove("done");
    b.title = "Copy link";
  }, 1600);
}, true);

function joinPanel() {
  if (REMOTE) return "";
  const code = state.joinUrl.split("/").pop();
  return `<aside class="join">
    <div class="eyebrow">Scan to join</div>
    <img src="/qr.svg?u=${encodeURIComponent(state.joinUrl)}" alt="QR code to join this table">
    <div>${linkLine(state.joinUrl)}<div class="code" style="text-align:center;margin-top:6px">${esc(code)}</div></div>
    <div class="faint" style="font-size:.7em;text-align:center">Everyone at the table scans this same code</div>
    <button data-new-code style="font-size:.7em">New code</button>
  </aside>`;
}

/** Seat layout buttons: only the layouts that may be chosen now (the chosen game's, or any visible game's). */
function seatButtons() {
  const layouts = state.layouts?.length ? state.layouts : [2, 4, 6, 8];
  return `<span class="seg" title="Seats around the table">${layouts.map((n) => `<button data-layout="${n}" class="${state.layout === n ? "on" : ""}">${n}</button>`).join("")}</span>`;
}

function toolbar() {
  const sel = state.players.find((p) => p.id === selectedPlayer);
  // Left: the table's seat layout. Right: managing players (D-086).
  return `<div class="toolbar">
    ${seatButtons()}
    ${REMOTE ? "" : `<div class="right"><button data-add-ai>+ AI player</button><button data-invite>Invite…</button><button data-sim>Simulation…</button></div>`}
  </div>
  ${REMOTE || !sel ? "" : `<div class="toolbar selected"><div class="right"><span class="faint">${esc(sel.name)}</span>
    ${sel.kind === "ai" ? `<button data-config="${sel.id}">Configure</button>` : ""}
    <button class="danger" data-remove="${sel.id}">Remove</button></div></div>`}`;
}

function renderLobby() {
  const humans = state.players.filter((p) => p.kind === "human").length;
  center.innerHTML = `<section class="main">
      <div class="eyebrow">${esc(state.tableName)}</div>
      ${cloudNotice()}<h1>Pick a game</h1>
      <div class="sub">${humans ? `${humans} at the table${REMOTE ? "" : " · tap a seat, then another to move a player"}` : REMOTE ? "Waiting for players" : "Scan the code to take a seat"}${remoteNote()}</div>
      ${gameTiles()}
      ${toolbar()}
    </section>${joinPanel()}`;
}

// The lobby shows the games a page at a time (three tiles fit beside the join panel), with arrows and dots.
const PAGE_SIZE = 3;
let gamePage = 0;
function gameTiles() {
  const pages = Math.max(1, Math.ceil(games.length / PAGE_SIZE));
  gamePage = Math.min(gamePage, pages - 1);
  const tiles = games
    .slice(gamePage * PAGE_SIZE, (gamePage + 1) * PAGE_SIZE)
    .map((g) => `<button class="tile ${g.selectable ? "selectable" : ""}" data-game="${g.id}" ${g.selectable ? "" : "disabled"}>
          <span class="title">${esc(g.name)}</span><span class="desc">${esc(g.description ?? "")}</span>
          <span class="faint" style="font-size:.66em">${playersLabel(g.players)}${g.ai ? " · AI" : ""}${g.extra ? ` · <span style="color:var(--brass)">extra</span>` : ""}</span>
          ${g.selectable ? `<span class="hint">${esc(tileHint(g))}</span>` : `<span class="why">${esc(g.reasons[0])}</span>`}</button>`)
    .join("");
  const pager = pages < 2 ? "" : `<div class="pager">
      <button data-page="-1" ${gamePage === 0 ? "disabled" : ""} aria-label="Previous games">‹</button>
      ${Array.from({ length: pages }, (_, i) => `<button class="dot ${i === gamePage ? "on" : ""}" data-page-to="${i}" aria-label="Games page ${i + 1}"></button>`).join("")}
      <button data-page="1" ${gamePage === pages - 1 ? "disabled" : ""} aria-label="More games">›</button>
      <span class="faint">${games.length} games</span></div>`;
  return `<div class="games">${tiles}</div>${pager}`;
}

/** What a choosable game still needs, or that it can start right away. */
function tileHint(g) {
  const n = g.needs ?? [];
  return n.length ? n[0][0].toUpperCase() + n[0].slice(1) : "Ready to play";
}

function remoteNote() {
  const r = state.remote;
  if (REMOTE) return r && !r.boardControl ? ` · <span class="faint">view only — the table has switched off board control for remote players</span>` : "";
  return r?.players ? ` · ${r.players} remote` : "";
}

function playersLabel(p) {
  if (p.length === 1) return `${p[0]} players`;
  const contiguous = p.every((n, i) => i === 0 || n === p[i - 1] + 1);
  return contiguous ? `${p[0]}–${p.at(-1)} players` : `${p.join(", ")} players`;
}

function renderReady() {
  const humans = state.players.filter((p) => p.kind === "human" && p.seat !== null);
  const needs = state.game.needs ?? [];
  const all = needs.length === 0 && humans.length > 0 && humans.every((p) => p.ready && p.connected);
  const seated = state.players.filter((p) => p.seat !== null).length;
  const g = games.find((x) => x.id === state.game.id);
  const roomForAi = g?.ai && seated < Math.max(...state.game.players);
  center.innerHTML = `<section class="main waiting">
      <div><div class="eyebrow">Up next · ${playersLabel(state.game.players)} · ${seated} seated</div><h1>${esc(state.game.name)}</h1>
      <div class="sub">${needs.length ? `${esc(needs.map((n, i) => (i ? n : n[0].toUpperCase() + n.slice(1))).join(" · "))}. Scan the code to join${g?.ai ? " or add an AI player" : ""}.` : "Everyone taps <b>Ready</b> on their phone."}</div></div>
      <div class="ready-list">${state.players.filter((p) => p.seat !== null).map((p) => `<span class="chip ${p.ready ? "ok" : ""}"><span class="dot" style="background:${p.ready ? "var(--jade)" : ""}"></span>${esc(p.name)}</span>`).join("")}</div>
      ${REMOTE ? "" : `<div class="toolbar">${seatButtons()}${roomForAi ? `<div class="right"><button data-add-ai>+ AI player</button></div>` : ""}</div>`}
      <div class="toolbar"><button class="primary" data-start ${all ? "" : "disabled"}>Start game</button><button data-close>Change game</button>
      ${REMOTE ? "" : (() => { const sel = state.players.find((p) => p.id === selectedPlayer); return sel?.kind === "ai" ? `<button data-config="${sel.id}">Configure ${esc(sel.name)}</button>` : state.players.some((p) => p.kind === "ai") ? `<span class="faint" style="font-size:.7em">Tap an AI seat to configure it</span>` : ""; })()}
      </div>
    </section>${joinPanel()}`;
}

/** A game's statistics from its summary (D-091): the first column left-aligned, numbers centred. */
function summaryTable(t) {
  return `<table class="summary-table"><tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>
    ${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>`;
}

function renderFinished() {
  const s = state.summary;
  center.innerHTML = `<section class="main">
      <div class="summary"><div class="eyebrow">${esc(state.game?.name ?? "Game")} · finished</div>
      <div class="big">${esc(s?.text ?? "Game over")}</div>
      ${s?.table ? summaryTable(s.table) : ""}
      <div class="toolbar"><button class="primary" data-again>Play again</button><button data-close>Back to lobby</button></div></div>
    </section>${joinPanel()}`;
}

// ---------- pause screen ----------
function renderPause() {
  const p = state.phase === "paused" ? state.pause : null;
  pauseLayer.hidden = !p;
  if (!p) return;
  const online = state.cloud.status === "online" || state.cloud.status === "disabled";
  pauseLayer.innerHTML = `<div class="panel" style="transform:rotate(${ROT[viewEdge()]}deg)">
    ${online ? "" : `<div class="spinner"></div>`}
    <h2>${online ? "Connection is back" : "Game paused"}</h2>
    <p>${online ? "Continue where you left off." : "The table lost its connection to the Game Table service. The game continues by itself when the connection returns."}</p>
    <div class="row">
      ${online ? `<button class="primary" data-pause="resume">Continue</button>` : `<button disabled>Waiting…</button>`}
      ${p.canSave ? `<button data-pause="save">Save and exit</button>` : ""}
      <button class="danger" data-pause="end">End game</button></div></div>`;
}

pauseLayer.addEventListener("click", async (e) => {
  const a = e.target.closest("button[data-pause]")?.dataset.pause;
  if (a === "resume") act("POST", "/game/resume");
  if (a === "save" && (await confirmDialog("Save and exit?", "The game is saved on this table and ends for now. Resuming saved games comes in a later update.", "Save and exit"))) {
    const r = await api("POST", "/game/save").catch(() => null);
    if (r) toast(`Saved as ${r.saveId}`);
  }
  if (a === "end" && (await confirmDialog("End this game?", "The game stops for everyone and the result is recorded as ended.", "End game"))) act("POST", "/game/end");
});

// ---------- game surface: the game's own board.js ----------
// A game package may ship board.js exporting mount(root, ctx) -> { update(view, events, info), destroy() }.
let game = null; // { key, inst, loading }

function gameInfo() {
  return {
    players: state.players,
    seatEdges: state.seatEdges,
    seatPositions: seatPositions(state.seatEdges),
    frontEdge: viewEdge(),
    rotation: ROT[viewEdge()],
    settings: state.game?.settings ?? {},
    prefs: state.game?.prefs ?? {},
    sound: state.display?.sound !== false, // sound effects on (D-092)
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
    let mod;
    try {
      mod = await import(`/games/${state.game.id}/board.js?v=${encodeURIComponent(state.game.version)}`);
    } catch {
      mod = { mount: genericBoard };
    }
    if (game !== mine) return; // a newer game replaced this one while loading
    mine.inst = mod.mount(gameLayer, { gameId: state.game.id, assetUrl: (p) => `/games/${state.game.id}/assets/${p}` });
  }
  if (game.inst && gameMsg) game.inst.update(gameMsg.view, [], gameInfo());
}

function closeGame() {
  if (!game) return;
  try {
    game.inst?.destroy?.();
  } catch {}
  game = null;
  gameMsg = null;
  gameLayer.innerHTML = "";
}

/** Fallback for games without their own board UI: show the public view as JSON. */
function genericBoard(root) {
  const pre = document.createElement("pre");
  pre.className = "raw";
  pre.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:1200px";
  root.appendChild(pre);
  return { update: (view) => (pre.textContent = JSON.stringify(view, null, 2)) };
}

// ---------- events ----------
center.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const d = b.dataset;
  if (d.game) chooseGame(d.game);
  else if (d.page) ((gamePage = Math.max(0, gamePage + Number(d.page))), render());
  else if (d.pageTo) ((gamePage = Number(d.pageTo)), render());
  else if (d.config) configureAi(d.config);
  else if (d.layout) act("POST", "/layout", { seats: Number(d.layout) });
  else if (d.rotate) act("POST", "/rotate", { degrees: Number(d.rotate) });
  else if ("addAi" in d) act("POST", "/ai", {});
  else if (d.remove) {
    const p = state.players.find((x) => x.id === d.remove);
    if (await confirmDialog(`Remove ${p?.name}?`, p?.kind === "ai" ? "The AI player leaves its seat." : "Their phone is disconnected and must scan the QR code again to rejoin.", "Remove")) {
      selectedPlayer = null;
      act("DELETE", `/players/${d.remove}`);
    }
  } else if ("start" in d) act("POST", "/game/start");
  else if ("close" in d) act("POST", "/game/close");
  else if ("again" in d) act("POST", "/game/select", { gameId: state.game.id, settings: state.game.settings });
  else if ("sim" in d) openSimulation();
  else if ("invite" in d) openInvite();
  else if ("newCode" in d && (await confirmDialog("New join code?", "The current QR code stops working. Players already at the table stay in.", "New code"))) act("POST", "/join/new");
});

lobbyBtn.addEventListener("click", openLobbyOverlay);

function openLobbyOverlay() {
  const o = document.createElement("div");
  o.className = "overlay";
  const draw = () => {
    o.innerHTML = `<div class="panel"><h2>Lobby</h2>
      <div class="group"><div class="eyebrow">Players</div>${state.players
        .map((p) => `<div class="row"><span>${esc(p.name)} <span class="faint">· ${p.seat === null ? "no seat" : `${esc(seatName(state.seatEdges, p.seat))} seat`}${p.connected ? "" : " · reconnecting"}</span></span>
          ${REMOTE ? "" : `<button class="danger" data-remove="${p.id}">Remove</button>`}</div>`)
        .join("") || `<div class="faint">Nobody yet</div>`}</div>
      ${REMOTE ? "" : `<div class="group"><div class="eyebrow">View</div><div class="row"><span>Lobby and menus face</span>
        <span class="seg">${EDGE_ORDER.map((e) => `<button data-face="${e}" class="${state.frontEdge === e ? "on" : ""}">${e[0].toUpperCase() + e.slice(1)}</button>`).join("")}</span></div></div>`}
      <div class="group">${REMOTE ? "" : `<div class="row"><span>Remote players${state.remote?.players ? ` · ${state.remote.players} joined` : ""}</span><button data-invite>Invite…</button></div>`}
        <div class="row"><span>Terms of service</span><a href="/deck/terms.html" target="_blank" style="color:var(--brass)">Open</a></div></div>
      <div class="actions" style="display:flex;justify-content:space-between;margin-top:20px">
        <button class="danger" data-end>End game</button><button class="primary" data-close-overlay>Back to game</button></div></div>`;
    faceFront(o.querySelector(".panel"));
  };
  draw();
  const unsub = onState(draw);
  o.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (e.target === o || b?.dataset.closeOverlay !== undefined) return (unsub(), o.remove());
    if (!b) return;
    if (b.dataset.face) act("POST", "/face", { edge: b.dataset.face });
    if (b.dataset.invite !== undefined) openInvite();
    if (b.dataset.remove) {
      const p = state.players.find((x) => x.id === b.dataset.remove);
      if (await confirmDialog(`Remove ${p?.name}?`, "This may end games that cannot continue without them.", "Remove")) act("DELETE", `/players/${b.dataset.remove}`);
    }
    if (b.dataset.end !== undefined && (await confirmDialog("End this game?", "The game stops for everyone and the result is recorded as ended.", "End game"))) {
      await act("POST", "/game/end");
      unsub();
      o.remove();
    }
  });
  overlayRoot.appendChild(o);
}

function openSimulation() {
  const sims = games.filter((g) => g.simulation);
  if (!sims.length) return toast("No installed game supports AI-only simulation");
  const o = document.createElement("div");
  o.className = "overlay";
  o.innerHTML = `<div class="panel"><h2>AI simulation</h2>
    <p class="muted" style="font-size:.85em">Runs games with AI players only, without the board, and stores a replayable log for AI training.</p>
    <div class="group" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <label>Game<select name="game" style="font:inherit;padding:8px;border-radius:10px;background:var(--felt-deep);color:var(--ink)">${sims.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join("")}</select></label>
      <label>AI players<input name="players" type="number" min="1" max="8" value="4"></label>
      <label>Games<input name="games" type="number" min="1" max="1000" value="10"></label>
      <label>Seed<input name="seed" type="number" value="${Math.floor(Math.random() * 1e6)}"></label>
    </div><div class="out muted" style="font-size:.85em"></div>
    <div class="actions" style="display:flex;justify-content:flex-end;gap:12px"><button data-x="close">Close</button><button class="primary" data-x="run">Run…</button></div></div>`;
  faceFront(o.querySelector(".panel"));
  o.addEventListener("click", async (e) => {
    const x = e.target.closest("button")?.dataset.x;
    if (x === "close" || e.target === o) return o.remove();
    if (x !== "run") return;
    const val = (n) => o.querySelector(`[name=${n}]`).value;
    const body = { gameId: val("game"), players: Number(val("players")), games: Number(val("games")), seed: Number(val("seed")) };
    if (!(await confirmDialog("Start simulation?", `${body.games} game(s) of ${body.players} AI players. This may take a moment.`, "Start"))) return;
    const out = o.querySelector(".out");
    out.textContent = "Running…";
    try {
      const r = await api("POST", "/simulation", body);
      out.innerHTML = `Done: ${r.games.length} game(s). Log <code>${esc(r.logId)}</code> saved.`;
    } catch {
      out.textContent = "";
    }
  });
  overlayRoot.appendChild(o);
}

// ---------- remote invites (phase 1c) ----------
async function openInvite() {
  const o = document.createElement("div");
  o.className = "overlay";
  o.innerHTML = `<div class="panel"><h2>Invite a remote player</h2><div class="muted">Creating an invite…</div></div>`;
  faceFront(o.querySelector(".panel"));
  overlayRoot.appendChild(o);
  const close = () => (unsub?.(), o.remove());
  let unsub = null;
  o.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (e.target === o || b?.dataset.x === "close") return close();
    if (b?.dataset.x === "another") return (close(), openInvite());
  });
  o.addEventListener("change", (e) => {
    if (e.target.name === "control") act("POST", "/remote", { boardControl: e.target.checked });
  });
  let inv;
  try {
    inv = await api("POST", "/invites");
  } catch {
    return close();
  }
  let qr = "";
  try {
    const r = await fetch(`/api/v1/qr?text=${encodeURIComponent(inv.url)}`, { headers: { "x-table-key": KEY } });
    if (r.ok) qr = await r.text();
  } catch {}
  const until = new Date(inv.expiresAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const draw = () => {
    const r = state.remote ?? { boardControl: true, maxPlayers: 4, players: 0 };
    o.innerHTML = `<div class="panel invite"><h2>Invite a remote player</h2>
      <div class="muted">Send this link by email or chat. It works once, for one player, until ${esc(until)}.</div>
      <div class="invite-body"><div class="qr">${qr}</div>
        <div>${linkLine(inv.url)}<div class="code">${esc(inv.token)}</div>
        <div class="faint" style="margin-top:10px">${r.players} of ${r.maxPlayers} remote seats in use</div></div></div>
      <label class="invite-control"><input type="checkbox" name="control" ${r.boardControl ? "checked" : ""}>
        Remote players can use the board controls (pick games, start, end)</label>
      <div class="actions" style="display:flex;justify-content:flex-end;gap:12px;margin-top:16px">
        <button data-x="another">Another invite</button><button class="primary" data-x="close">Done</button></div></div>`;
    faceFront(o.querySelector(".panel"));
  };
  draw();
  unsub = onState(draw);
}

// ---------- live connection ----------
const stateListeners = new Set();
function onState(fn) {
  stateListeners.add(fn);
  return () => stateListeners.delete(fn);
}

async function refreshGames() {
  games = await api("GET", "/games").catch(() => games);
}

function connect() {
  const ws = openTableSocket(REMOTE);
  ws.onopen = () => ws.send(JSON.stringify({ v: 1, ch: "system", type: "hello", payload: REMOTE ? { role: "board" } : { role: "board", key: KEY } }));
  ws.onmessage = async (ev) => {
    const m = JSON.parse(ev.data);
    if (m.ch === "lobby" && m.type === "state") {
      state = m.payload;
      if (selectedPlayer && !state.players.some((p) => p.id === selectedPlayer)) selectedPlayer = null;
      // The games list serves only the lobby and its dialogs: skip it while a game runs.
      if (state.phase !== "active" && state.phase !== "paused" && state.phase !== "terminating") await refreshGames();
      render();
      stateListeners.forEach((f) => f());
    } else if (m.ch === "game" && m.type === "board") {
      gameMsg = { ...m.payload, receivedAt: Date.now() };
      if (game?.inst && state) game.inst.update(gameMsg.view, gameMsg.events ?? [], gameInfo());
      else if (state && (state.phase === "active" || state.phase === "paused")) showGame();
    }
  };
  ws.onclose = () => setTimeout(connect, 1000);
}
connect();
