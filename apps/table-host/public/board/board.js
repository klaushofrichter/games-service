// Board UI: lobby, seats around the edge, QR join, game surface and the lobby overlay.
// Talks to the Table Host through the board control API (same API the tests and local AI agents use).
import { renderRules } from "/shared/markdown.js";
import { ROT, W, H, SEAT_COLORS, audio, copyText, esc, seatName, seatPositions, claimServiceWorkerPage, openTableSocket } from "/shared/board-kit.js";
import { openViewer } from "/board/viewer.js";
import { hasStatistics, openStatistics } from "/board/stats.js";

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
const awayLayer = document.getElementById("away-layer");
const cornersEl = document.getElementById("corners");
const settingsBtn = document.getElementById("settings-button");
const flipBtn = document.getElementById("flip-button");
const toolsBtn = document.getElementById("tools-button");
/** The board inside "Play from the board" (D-175, board/play.html), beside one player's deck. */
const IN_PLAY = new URLSearchParams(location.search).get("in") === "play" && window.parent !== window;
/**
 * The document Fullscreen applies to (D-184): inside "Play from the board" the whole page (board and deck), not just
 * the board's frame, which would cover the deck. The page is served by the table itself, so it is the same origin.
 */
const fsDoc = (() => {
  try {
    return IN_PLAY && window.parent.document ? window.parent.document : document;
  } catch {
    return document;
  }
})();
const watchBtn = document.getElementById("watchers-button");
const viewBtn = document.getElementById("view-button");
const resultBtn = document.getElementById("result-button");
const statsBtn = document.getElementById("stats-button");

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

// Dialogs and overlays face the current front edge, like the rest of the board. The overlay root lies outside the
// turned surface, so on a remote board it is upright for its player already: there they face no edge (D-157).
const overlayEdge = () => (REMOTE ? "south" : viewEdge());
function faceFront(el) {
  if (state) el.style.transform = `rotate(${ROT[overlayEdge()]}deg)`;
  return el;
}

/**
 * Fill an overlay that redraws on every lobby state. In a game of AI players that is several times a second: rebuilding
 * an unchanged panel reset its scroll position (Done scrolled out of reach) and could lose a tap that started on a
 * button that was replaced before the finger lifted. So it is rebuilt only when its content changes, and keeps its
 * scroll position when it is.
 */
function setPanel(o, html) {
  if (o.dataset.html !== html) {
    const top = o.querySelector(".panel")?.scrollTop ?? 0;
    o.innerHTML = html;
    o.dataset.html = html;
    const panel = o.querySelector(".panel");
    if (panel) panel.scrollTop = top;
  }
  const panel = o.querySelector(".panel");
  if (panel) faceFront(panel);
}

// Escape closes the topmost dialog or overlay, as a tap beside it does (each one decides what that means: a
// confirmation is cancelled, the settings close; their changes are already applied). Their own Escape handlers, where
// they have one, are not needed as well.
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Escape") return;
    const top = overlayRoot.lastElementChild;
    if (!top) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    top.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  },
  true,
);

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
 * A message that must be acknowledged (D-146): only its OK button closes it, not a tap beside it. Escape, which the board
 * sends as a click on the backdrop (not a tap by a person), closes it too.
 */
function noticeDialog(title, text, okLabel = "OK") {
  return new Promise((resolve) => {
    const d = document.createElement("div");
    d.className = "dialog-backdrop notice";
    d.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true"><h2>${esc(title)}</h2><div class="muted">${esc(text)}</div>
      <div class="actions"><button class="primary" data-x="ok">${esc(okLabel)}</button></div></div>`;
    d.addEventListener("click", (e) => {
      if (e.target.dataset?.x === "ok" || (e.target === d && !e.isTrusted)) {
        d.remove();
        resolve();
      }
    });
    faceFront(d.querySelector(".dialog"));
    overlayRoot.appendChild(d);
    d.querySelector("[data-x=ok]").focus();
  });
}

/**
 * Why a number typed into a form field is not allowed, in the field's own words, or null when it is (D-146). The table
 * checks again, but its refusal would come only after the form has closed.
 */
function numberProblem(f, raw) {
  const name = f.label ?? f.key;
  const lo = f.min !== undefined;
  const hi = f.max !== undefined;
  const range = lo && hi ? `from ${f.min} to ${f.max}` : lo ? `${f.min} or more` : hi ? `${f.max} or less` : "";
  const n = Number(raw);
  if (String(raw).trim() === "" || !Number.isFinite(n)) return `${name} needs a number${range ? `, ${range}` : ""}.`;
  if (f.type === "int" && !Number.isInteger(n)) return `${name} needs a whole number${range ? `, ${range}` : ""}.`;
  if ((lo && n < f.min) || (hi && n > f.max)) return `${name} can be ${range}. ${n} is too ${lo && n < f.min ? "low" : "high"}.`;
  return null;
}

/**
 * A small form for manifest-described fields (game settings, AI options). Resolves with the values,
 * or null when cancelled. With `removeLabel`, a red button on the left resolves with "remove" (D-103).
 */
/** Plain text with its https:// links as links (opening a new tab), for a game's notes. */
const linkified = (text) => esc(text).replace(/https:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);

/** A form for settings or options; `note`: a game's text under the fields (an AI engine's licence, D-224). */
function formDialog(title, intro, fields, values = {}, okLabel = "OK", removeLabel = null, note = "") {
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
      <div class="fields">${fields.map((f) => `<label><span>${esc(f.label ?? f.key)}</span>${input(f)}</label>`).join("") || `<div class="faint">${state?.game ? "Nothing to set for this game." : "Pick a game to choose how it plays."}</div>`}</div>
      ${note ? `<div class="faint form-note">${linkified(note)}</div>` : ""}
      <div class="actions">${removeLabel ? `<button class="danger" data-x="remove" style="margin-right:auto">${esc(removeLabel)}</button>` : ""}<button data-x="no">Cancel</button><button class="primary" data-x="yes">${esc(okLabel)}</button></div></div>`;
    d.addEventListener("click", (e) => {
      const x = e.target.closest("button")?.dataset.x;
      if (!x && e.target !== d) return;
      let out = x === "remove" ? "remove" : null;
      if (x === "yes") {
        // A number out of range says so in a message to acknowledge, and the form stays open on that field (D-146).
        for (const f of fields) {
          if (f.type !== "int" && f.type !== "number") continue;
          const el = d.querySelector(`[name="${f.key}"]`);
          const problem = numberProblem(f, el.value);
          if (problem) {
            noticeDialog("Check this setting", problem).then(() => {
              el.focus();
              el.select?.();
            });
            return;
          }
        }
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

/**
 * The last player at the table can't be removed while a game is chosen or running (D-118), unless the developer
 * setting allows games without one: say so instead of asking. The table refuses it too.
 */
function cannotRemove(p) {
  if (!p || state.developer?.protectedPlayer !== p.id) return false;
  toast(`${p.name} is the last player at the table, and a game needs one. The developer setting under Advanced (hammer and wrench) allows games without.`);
  return true;
}

/** The AI player's window: how it plays in the chosen game, and Remove (D-103), which works with or without a game. */
async function configureAi(playerId) {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return;
  const g = state.game ? games.find((x) => x.id === state.game.id) : null;
  const title = g ? `${p.name} · ${g.name}` : p.name;
  const opts = await formDialog(title, g ? "How this AI player plays." : "", g?.aiOptions ?? [], p.aiOptions ?? {}, g ? "Save" : "Done", "Remove", g?.aiNotice);
  if (opts === "remove") {
    if (await confirmDialog(`Remove ${p.name}?`, "The AI player leaves its seat.", "Remove")) {
      if (selectedPlayer === playerId) selectedPlayer = null;
      act("DELETE", `/players/${playerId}`);
    }
  } else if (opts && g) act("POST", `/players/${playerId}/ai-options`, { options: opts });
  // However the window was left, the AI player is no longer selected (D-230).
  if (selectedPlayer === playerId) {
    selectedPlayer = null;
    render();
  }
}

/** How an AI player in the running game plays, from its next move on (D-159, D-226). */
async function editAiOptions(playerId) {
  const p = state.players.find((x) => x.id === playerId);
  const g = games.find((q) => q.id === state.game?.id);
  if (!p || !g) return;
  const opts = await formDialog(`${p.name} · ${g.name}`, "How this AI player plays from its next move on.", g.aiOptions ?? [], p.aiOptions ?? {}, "Save", null, g.aiNotice);
  if (opts) act("POST", `/players/${p.id}/ai-options`, { options: opts });
}

// ---------- orientation ----------
// The table's board faces `frontEdge` (turned with the corner buttons, D-080). A remote player's copy instead
// turns the whole surface so their own seat is at the bottom of their screen, and faces text to it.
// Their deck (same origin) records which player they are.
/** The seat of this remote board's own player, or null (no player yet, no seat, or the table's own board). */
function remoteSeat() {
  if (!REMOTE || !state) return null;
  let id = null;
  try {
    id = localStorage.getItem(`gametable.remote.${REMOTE_INV}.player`);
  } catch {}
  const p = id && state.players.find((x) => x.id === id);
  return p && p.seat !== null ? p.seat : null;
}
function myEdge() {
  const seat = remoteSeat();
  return seat === null ? null : state.seatEdges[seat] ?? null;
}
/**
 * A remote player on an east or west seat sees the board turned a quarter so their seat is at the bottom, which leaves a
 * landscape screen mostly empty. They may choose the full width instead (D-101): the board upright, their seat on a
 * side. Their own choice, remembered on their device. North and south seats have no such choice (no upside-down view).
 */
const LANDSCAPE_KEY = `gametable.remote.${REMOTE_INV}.landscape`;
let landscape = (() => {
  try {
    return localStorage.getItem(LANDSCAPE_KEY) === "1";
  } catch {
    return false;
  }
})();
const sideSeat = (e) => e === "east" || e === "west";
/** The edge a remote player's view is turned to: their seat's, or upright (south) when they chose the full width. */
function remoteEdge() {
  const e = myEdge();
  return e && sideSeat(e) && landscape ? "south" : e;
}
const viewEdge = () => remoteEdge() ?? state.frontEdge;

/**
 * Games use the board's full width (D-101): on the table's own board a game faces north or south only, whichever the
 * lobby faced last; the turn button flips between the two. Turning the lobby's menus east or west during a game
 * leaves the game as it was. Remote boards keep facing their player (or upright, as they chose).
 */
let lastFacing = "south";
function gameEdge() {
  if (REMOTE) return viewEdge();
  if (state.gameFacing) return state.gameFacing; // the table keeps it (D-151)
  if (state.frontEdge === "north" || state.frontEdge === "south") lastFacing = state.frontEdge;
  return lastFacing;
}

function renderViewButton() {
  const show = REMOTE && sideSeat(myEdge());
  viewBtn.hidden = !show;
  if (!show) return;
  viewBtn.textContent = landscape ? "⤾ Put my seat at the bottom" : "⤢ Use the full width";
  viewBtn.title = landscape ? "Turn the board so your seat is at the bottom" : "Show the board upright across the whole screen; your seat stays on the side";
}
viewBtn.addEventListener("click", () => {
  landscape = !landscape;
  try {
    localStorage.setItem(LANDSCAPE_KEY, landscape ? "1" : "0");
  } catch {}
  fit();
  render();
});
if (REMOTE) window.addEventListener("storage", (e) => e.key?.startsWith("gametable.remote.") && state && (render(), game?.inst && gameMsg && game.inst.update(gameMsg.view, [], gameInfo())));

// ---------- scaling ----------
function fit() {
  const e = remoteEdge();
  const sideways = sideSeat(e);
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
  const playing = inRunningGame();
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
    if (pl?.color) el.style.setProperty("--pc", pl.color); // the player's colour: card border and name dot (D-106)
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
      <div class="name${pl && [...pl.name].length > 12 ? " long" : ""}">${pl ? `<span class="pdot" aria-hidden="true"></span>${esc(pl.name)}` : "—"}</div><div class="status">${status}</div>`;
    if (!playing && !REMOTE) el.addEventListener("click", () => onSeatTap(seat, pl)); // seating stays with the table
    seatsEl.appendChild(el);
  });
}

// A tap anywhere but a seat, the selected player's buttons or a window deselects the selected player (D-230).
document.addEventListener("click", (e) => {
  if (!selectedPlayer || e.target.closest?.(".seat, .toolbar.selected, [data-config], [data-remove], .overlay, .dialog-backdrop")) return;
  selectedPlayer = null;
  render();
});

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
/** A game played from all four edges (manifest `facing: "any"`, D-227): the corner arrows stay during the game. */
const anyFacing = () => state.game?.facing === "any";
function renderCorners(hide) {
  cornersEl.hidden = REMOTE || hide;
  if (cornersEl.hidden) return;
  const what = lobbyPhase() ? "lobby" : "game";
  cornersEl.innerHTML = CORNERS.map(({ edge, pos, arrow }) =>
    `<button class="corner ${pos} ${state.frontEdge === edge ? "on" : ""}" data-face="${edge}" title="Face ${edge}" aria-label="Turn the ${what} to face ${edge}">
      <svg viewBox="0 0 24 24" width="22" height="22" style="transform:rotate(${arrow}deg)"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`).join("");
}
cornersEl.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-face]");
  if (b && b.dataset.face !== state.frontEdge) act("POST", "/face", { edge: b.dataset.face });
});

// Browsers keep sound off until the page is touched: wake the audio on the first touch (D-092). A finger's pointerdown
// does not count as one (Chrome and Safari take its pointerup, a click or a key), so all of these do; until the sound
// runs, a board with sound on says so (D-195). The table PC's kiosk browser allows it from the start.
const soundHint = document.getElementById("sound-hint");
let soundShown = false;
function showSoundHint() {
  const c = soundShown && state?.display?.sound !== false ? audio() : null;
  soundHint.hidden = !c || c.state === "running";
}
function wakeAudio() {
  const c = audio();
  if (c && !c.onstatechange) c.onstatechange = showSoundHint;
  c?.resume().then(showSoundHint, () => {});
}
for (const t of ["pointerdown", "pointerup", "touchend", "click", "keydown"]) window.addEventListener(t, wakeAudio, { capture: true });
wakeAudio();
// Not at once: a browser that allows sound resumes the audio a moment after the page loads.
setTimeout(() => {
  soundShown = true;
  showSoundHint();
}, 1500);

let lastPhase = null;
let holdFinal = false;
// Show result waits until the game's board has shown the end (D-134): a board still replaying moves (a slow or
// background window) keeps playing them first. The game's board says when through its optional whenIdle().
let finalSettled = true;
let finalToken = 0;
function settleFinal() {
  const token = ++finalToken;
  finalSettled = false;
  const inst = game?.inst;
  let idle;
  try {
    idle = inst && typeof inst.whenIdle === "function" ? Promise.resolve(inst.whenIdle()) : Promise.resolve();
  } catch {
    idle = Promise.resolve();
  }
  // No time limit (D-141): with AI players paced on this board it is never far behind, and a fixed limit showed the
  // button over a game still being replayed.
  idle.catch(() => {}).then(() => {
    if (token !== finalToken) return;
    finalSettled = true;
    if (state) render();
  });
}
/**
 * The statistics window (D-140): it faces the board's front edge; at the table it can be turned to any edge. Opened
 * from a game's last screen it is the way on (D-216): its Done leads to the results in the lobby, as Show result did.
 */
function showStatistics(fromEnd = false) {
  if (!state?.summary || overlayRoot.querySelector(".overlay.statistics")) return;
  const onClose = fromEnd ? () => ((holdFinal = false), render()) : undefined;
  openStatistics({ summary: state.summary, gameName: state.game?.name, overlayRoot, edge: overlayEdge(), turnable: !REMOTE, onClose });
}
statsBtn.addEventListener("click", () => showStatistics(true));
resultBtn.addEventListener("click", () => {
  holdFinal = false;
  render();
});

// ---------- settings (D-088) ----------
// A gear beside the corner at the left end of the edge the board faces (as seen from that edge), turned to it.
// During a game it stays put (D-127): where it is when the game faces south, also when the game is turned to face north,
// so it never lands on the game's own displays; it moves to the other end of that edge if the game's Lobby button sits
// in that corner.
// Not on a remote player's copy: settings stay with the table.
const FRONT_CORNERS = { south: ["bl", "br"], west: ["tl", "bl"], north: ["tr", "tl"], east: ["br", "tr"] };
const LOBBY_CORNER = { "top-left": "tl", "top-right": "tr", "bottom-left": "bl", "bottom-right": "br" };
function placeSettings(playing) {
  settingsBtn.hidden = REMOTE;
  // D-127: fixed during a game, whichever way the game faces. A remote board faces its player throughout (D-157).
  const front = playing && !REMOTE ? "south" : viewEdge();
  let [corner, other] = FRONT_CORNERS[front];
  // The corner the game's Lobby button actually takes on this board (turned on a remote north board, D-157).
  if (playing && LOBBY_CORNER[cornerClass(state.game?.lobbyButton ?? "bottom-right").split(" ")[0]] === corner) corner = other;
  if (!REMOTE) {
    settingsBtn.className = `${corner} along-${front === "south" || front === "north" ? "x" : "y"}`;
    settingsBtn.querySelector("svg").style.transform = `rotate(${ROT[front]}deg)`;
    placeFlip(playing, front, corner);
  }
  placeTools(playing, front, corner);
}

/**
 * Advanced (D-128): hammer and wrench, the next button along the edge from the gear, toward the middle (past the
 * turn-around button when that sits there). On a remote board, only with board control, and in the gear's place,
 * since a remote board has no gear: there it offers the game logs only.
 */
function placeTools(playing, front, gearCorner) {
  toolsBtn.hidden = REMOTE && !state.remote?.boardControl;
  if (toolsBtn.hidden) return placeAlong(watchBtn, REMOTE ? 102 : 172, front, gearCorner, placeWatchers());
  // The developer setting (D-118) marks it while it is on, so nobody forgets it.
  toolsBtn.classList.toggle("dev", !!(state.developer?.allowNoLocalPlayer || state.developer?.boardDeck) && !REMOTE);
  const flipInside = playing && !REMOTE && !anyFacing() && gearCorner !== FRONT_CORNERS[front][0]; // the turn button at 172 px
  const along = REMOTE ? 102 : flipInside ? 242 : 172;
  placeAlong(toolsBtn, along, front, gearCorner, true);
  placeAlong(watchBtn, along + 70, front, gearCorner, placeWatchers());
}

/** Put a round corner button `along` px from the gear's corner, along the edge the board faces, turned to it. */
function placeAlong(btn, along, front, gearCorner, shown) {
  if (!shown) return;
  const alongX = front === "south" || front === "north";
  const st = btn.style;
  st.left = st.right = st.top = st.bottom = "";
  if (alongX) {
    st[gearCorner[1] === "l" ? "left" : "right"] = `${along}px`;
    st[gearCorner[0] === "t" ? "top" : "bottom"] = "32px";
  } else {
    st[gearCorner[0] === "t" ? "top" : "bottom"] = `${along}px`;
    st[gearCorner[1] === "l" ? "left" : "right"] = "32px";
  }
  btn.firstElementChild.style.transform = `rotate(${ROT[front]}deg)`;
}

// ---------- remote watchers (D-168) ----------
const EYE = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>`;
/** The eye beside the tools, with how many watch, only while someone does; it opens the list (D-168). */
function placeWatchers() {
  const n = state.watchers?.length ?? 0;
  watchBtn.hidden = !n;
  if (!n) return false;
  const html = `<span class="inner">${EYE}<span class="n">${n}</span></span>`;
  if (watchBtn.dataset.html !== html) (watchBtn.innerHTML = html), (watchBtn.dataset.html = html);
  watchBtn.setAttribute("aria-label", `${n} watching`);
  return true;
}
/** Who may manage watchers here: the table's board, or a remote player's board with board control. */
const canManageWatchers = () => !REMOTE || (!!state.remote?.boardControl && !state.remote?.watching);
const lobbyPhase = () => !["active", "paused", "terminating"].includes(state.phase);
/** A watcher's row: the name, and Remove (and in the lobby "Let play") where this board may. */
function watcherRows() {
  return (state.watchers ?? [])
    .map((w) => `<div class="row"><span class="pname"><span class="eye-dot">${EYE}</span>${esc(w.name)}</span><span class="row-actions">${
      canManageWatchers()
        ? `${lobbyPhase() && !state.noSeat ? `<button data-watcher-play="${esc(w.id)}">Let play</button>` : ""}<button class="danger" data-watcher-remove="${esc(w.id)}">Remove</button>`
        : ""
    }</span></div>`)
    .join("");
}
const WATCHER_NOTE = "Watchers see the board, never a phone's private view. They leave by closing their window; a removed watcher can't come back with that invite.";
async function watcherAction(b) {
  const w = (state.watchers ?? []).find((x) => x.id === (b.dataset.watcherRemove ?? b.dataset.watcherPlay));
  if (!w) return false;
  if (b.dataset.watcherRemove) {
    if (await confirmDialog(`Remove ${w.name}?`, `${w.name} stops watching, and can't come back with this invite.`, "Remove")) act("DELETE", `/watchers/${w.id}`);
  } else act("POST", `/watchers/${w.id}/play`);
  return true;
}
/** The settings' Fullscreen row, also in a watcher's window (D-221): the whole page where it applies (D-184). */
function fullscreenRow() {
  return `<div class="row"><span>Fullscreen</span>${fsDoc.fullscreenEnabled ? `<button data-fs class="${fsDoc.fullscreenElement ? "on" : ""}">${fsDoc.fullscreenElement ? "Leave fullscreen" : "Fullscreen"}</button>` : `<span class="faint">not available in this browser</span>`}</div>`;
}
function toggleFullscreen() {
  (fsDoc.fullscreenElement ? fsDoc.exitFullscreen() : fsDoc.documentElement.requestFullscreen()).catch(() => toast("Fullscreen was refused by the browser"));
}
/** The watcher this board belongs to (D-221): a remote board whose browser watches; null elsewhere. */
const watcherSelf = () => (REMOTE && state.remote?.watching ? (state.watchers ?? []).find((w) => w.id === state.remote.watcherId) ?? null : null);
/**
 * The eye's window: who watches, and Remove / Let play where this board may. A watcher's own board, which has no
 * settings, also gets their name to change and Fullscreen here (D-221), and is told how they could play: the table's
 * board does that.
 */
function openWatchers() {
  const o = document.createElement("div");
  o.className = "overlay watchers";
  const draw = () => {
    if (!(state.watchers ?? []).length) return close();
    const me = watcherSelf();
    const note = me
      ? "You see the board, never a player's private view. To play, ask the table: its board can let you take a free seat before a game, or exchange a player for you during one. To stop watching, close this window."
      : `${WATCHER_NOTE}${lobbyPhase() ? "" : " During a game, a watcher can take a seat through Settings › Players: tap a player's name."}`;
    setPanel(o, `<div class="panel watchers-panel"><h2>Watching</h2>
      ${me ? `<div class="group"><div class="row"><span>Your name: <b>${esc(me.name)}</b></span><button data-watcher-name>Change name</button></div>${fullscreenRow()}</div>` : ""}
      <div class="group player-colors">${watcherRows()}</div>
      <p class="faint" style="font-size:.75em">${note}</p>
      <div class="actions settings-actions"><button class="primary" data-close-overlay>Done</button></div></div>`);
  };
  const close = () => (unsub(), fsDoc.removeEventListener("fullscreenchange", draw), o.remove());
  const unsub = onState(draw);
  fsDoc.addEventListener("fullscreenchange", draw);
  o.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (e.target === o || b?.dataset.closeOverlay !== undefined) return close();
    if (b?.dataset.fs !== undefined) return toggleFullscreen();
    if (b?.dataset.watcherName !== undefined) {
      const me = watcherSelf();
      return openNamePad(me?.name === "Guest" ? "" : (me?.name ?? ""), (n) => n && act("POST", "/watching/name", { name: n }), "Your name");
    }
    if (b) await watcherAction(b);
  });
  draw();
  overlayRoot.appendChild(o);
}
watchBtn.addEventListener("click", () => openWatchers());

/**
 * The turn button sits to the left of the gear (D-101), as seen from the south edge, and like the gear it does not move
 * or turn when the game is turned (D-127): in the corner itself when the gear is at the left end (the corner buttons are
 * hidden during a game), else one step toward the middle.
 */
function placeFlip(playing, front, gearCorner) {
  flipBtn.hidden = REMOTE || !playing || anyFacing(); // a game played from all sides has the corner arrows (D-227)
  if (flipBtn.hidden) return;
  const leftEnd = gearCorner === FRONT_CORNERS[front][0];
  const along = leftEnd ? 32 : 172; // the gear is 102 px from its corner; the button is 58 px wide, with a 12 px gap
  const st = flipBtn.style;
  st.left = st.right = st.top = st.bottom = "";
  st[gearCorner[1] === "l" ? "left" : "right"] = `${along}px`;
  st[gearCorner[0] === "t" ? "top" : "bottom"] = "32px";
  const label = `Turn the game to face ${gameEdge() === "south" ? "north" : "south"}`;
  flipBtn.title = label;
  flipBtn.setAttribute("aria-label", label);
}
flipBtn.addEventListener("click", () => act("POST", "/face", { edge: gameEdge() === "south" ? "north" : "south" }));
settingsBtn.addEventListener("click", () => openSettings());
toolsBtn.addEventListener("click", () => openAdvanced());

/**
 * The settings modal: the board's own settings (Fullscreen), then whatever the chosen game adds. A game adds
 * items by exporting settings({ info, setPrefs }) from its board.js; each item is
 *   { type: "toggle", label, value, onChange(next) }   { type: "choice", label, value, options: [{ value, label }], onChange }
 *   { type: "swatches", label, value, options: ["#rrggbb", …], onChange }   { type: "button", label, onChange() }
 * setPrefs(patch) stores display choices for this game on the table; board and decks get them as info.prefs.
 */
let settingsOverlay = null;
/**
 * A choice with up to this many options shows as a row of buttons; more become a pulldown (D-129b), since a row of
 * eight time controls ran out of the window.
 */
const SEG_MAX = 3;
const pulldown = (attr, options, label) =>
  `<select class="pulldown" ${attr} aria-label="${esc(label)}">${options.map((op) => `<option value="${esc(op.value)}" ${op.on ? "selected" : ""}>${esc(op.label)}</option>`).join("")}</select>`;
/** The chosen game's settings fields from its manifest (D-090), or none. */
const gameFields = () => (state.game && games.find((x) => x.id === state.game.id)?.settings) || [];
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
    if (it.options.length > SEG_MAX) return pulldown(`data-item-select="${k}"`, it.options.map((op, i) => ({ value: String(i), label: op.label ?? op.value, on: op.value === it.value })), it.label);
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
    // The chosen game's own settings from its manifest (D-090): editable until it starts, then shown read-only.
    const fields = gameFields();
    const editable = state.phase === "ready";
    const cur = state.game?.settings ?? {};
    const setting = (f) => {
      const v = cur[f.key] ?? f.default;
      if (!editable) return `<span class="value">${esc(f.type === "bool" ? (v ? "On" : "Off") : v)}</span>`;
      if (f.type === "int" || f.type === "number")
        return `<span class="stepper"><button data-setting="${esc(f.key)}" data-delta="-1" ${f.min !== undefined && v <= f.min ? "disabled" : ""} aria-label="Less">−</button>
          <span class="value">${esc(v)}</span><button data-setting="${esc(f.key)}" data-delta="1" ${f.max !== undefined && v >= f.max ? "disabled" : ""} aria-label="More">+</button></span>`;
      if (f.type === "bool") return `<button data-setting="${esc(f.key)}" data-toggle class="${v ? "on" : ""}" role="switch" aria-checked="${!!v}">${v ? "On" : "Off"}</button>`;
      if (f.type === "enum")
        return f.values.length > SEG_MAX
          ? pulldown(`data-setting-select="${esc(f.key)}"`, f.values.map((x) => ({ value: x, label: x, on: String(v) === x })), f.label ?? f.key)
          : `<span class="seg">${f.values.map((x) => `<button class="${String(v) === x ? "on" : ""}" data-setting="${esc(f.key)}" data-value="${esc(x)}">${esc(x)}</button>`).join("")}</span>`;
      return `<span class="value">${esc(v)}</span>`;
    };
    // Player colours (D-106): a table setting for every seated player, used in the lobby and by every game. During a
    // game the name opens the player's exchange window (D-159, D-166); the colours stay right-aligned.
    const playerColors = () => {
      const seated = state.players.filter((p) => p.seat !== null).sort((a, b) => a.seat - b.seat);
      if (!seated.length) return "";
      const manage = seated.some(canExchange);
      const name = (p) => {
        const label = `<span class="pdot" style="background:${esc(p.color ?? "")}"></span>${esc(p.name)}`;
        return canExchange(p)
          ? `<button class="pname" data-exchange="${esc(p.id)}" aria-label="Exchange ${esc(p.name)}">${label}<span class="chev" aria-hidden="true">›</span></button>`
          : `<span class="pname">${label}</span>`;
      };
      // How each AI player plays in the chosen game (D-226), shown beside its name; a tap changes it (from its next move
      // on during a game).
      const g = games.find((x) => x.id === state.game?.id);
      const aiStyle = (p) => {
        if (p.kind !== "ai" || !g?.aiOptions?.length) return "";
        // The values on the row (labels can be long, e.g. "Strength (Elo, approximate)"); label and value on hover.
        const value = (o) => p.aiOptions?.[o.key] ?? o.default;
        const text = g.aiOptions.map(value).join(" · ");
        const full = g.aiOptions.map((o) => `${o.label ?? o.key}: ${value(o)}`).join(" · ");
        return !REMOTE || state.remote?.boardControl
          ? `<button class="ai-style" data-ai-options="${esc(p.id)}" title="${esc(full)}" aria-label="How ${esc(p.name)} plays: ${esc(full)}">${esc(text)}</button>`
          : `<span class="ai-style faint" title="${esc(full)}">${esc(text)}</span>`;
      };
      return `<div class="group player-colors"><div class="eyebrow">${inRunningGame() ? "Players" : "Player colours"}</div>
        ${manage ? `<div class="faint group-note">Tap a player's name to exchange them for someone at the table, a remote player or an AI player, or to change how an AI player plays.</div>` : ""}
        ${seated.map((p) => `<div class="row">${name(p)}${aiStyle(p)}<span class="swatches">${SEAT_COLORS.map((c, i) =>
          `<button class="swatch ${c === p.color ? "on" : ""}" style="--c:${c}" data-color-player="${esc(p.id)}" data-color="${c}" aria-label="${esc(p.name)}: colour ${i + 1}"></button>`).join("")}</span></div>`).join("")}
        <div class="faint" style="font-size:.7em;margin-top:6px">Picking a colour someone else has swaps the two.</div></div>`;
    };
    const gameSettings = fields.length
      ? `<div class="group game-rules ${editable ? "" : "locked"}"><div class="eyebrow">${esc(state.game.name)} · game settings${editable ? "" : ` <span class="lock" aria-label="locked">🔒 locked during the game</span>`}</div>
          ${fields.map((f) => `<div class="row"><span>${esc(f.label ?? f.key)}</span>${setting(f)}</div>`).join("")}
          ${editable ? "" : `<div class="faint" style="font-size:.7em;margin-top:6px">These can be changed before the game starts.</div>`}</div>`
      : "";
    setPanel(o, `<div class="panel"><h2>Settings</h2>
      <div class="group"><div class="eyebrow">Display</div>
        <div class="row"><span>Sound effects</span><button data-sound class="${state.display?.sound !== false ? "on" : ""}" role="switch" aria-checked="${state.display?.sound !== false}">${state.display?.sound !== false ? "On" : "Off"}</button></div>
        ${REMOTE || IN_PLAY ? "" : `<div class="row"><span>Another screen on this WiFi, such as an iPad or a TV, shows the board instead</span><button data-screen>Board on another screen…</button></div>`}
        ${fullscreenRow()}</div>
      <div class="group"><div class="eyebrow">Joining</div>
        ${state.developer?.boardDeck ? `<div class="row"><span class="faint">Played from the board (Developer settings): no phone joins at the table</span></div>` : `<div class="row"><span>The QR code and address for phones, to join or rejoin, also during a game</span><button data-join-code>Show join code…</button></div>`}
        <div class="row"><span>${remoteJoinText()}</span>${inviteButton("Invite remote player…")}</div></div>
      ${playerColors()}
      ${(state.watchers ?? []).length ? `<div class="group player-colors watchers-group"><div class="eyebrow">Watching</div>${watcherRows()}<div class="faint group-note">${WATCHER_NOTE}</div></div>` : ""}
      ${gameSettings}
      ${items.length ? `<div class="group game-settings"><div class="eyebrow">${esc(state.game.name)}</div>${items.map((it, k) => `<div class="row"><span>${esc(it.label)}</span>${control(it, k)}</div>`).join("")}</div>` : ""}
      <div class="actions settings-actions"><button class="primary" data-close-overlay>Done</button></div></div>`);
  };
  const close = () => {
    unsub();
    unsubView();
    fsDoc.removeEventListener("fullscreenchange", draw);
    o.remove();
    settingsOverlay = null;
  };
  draw();
  const unsub = onState(draw);
  // A game's own items show the game's view (Backgammon's Undo for both players): a change made here comes back as a
  // game update, not a lobby state, so redraw on those too (D-215).
  const unsubView = onGameView(draw);
  fsDoc.addEventListener("fullscreenchange", draw);
  // Choices with more options than fit as buttons are pulldowns (D-129b).
  o.addEventListener("change", (e) => {
    const sel = e.target.closest("select");
    if (!sel) return;
    if (sel.dataset.settingSelect) {
      const f = gameFields().find((x) => x.key === sel.dataset.settingSelect);
      if (f && sel.value !== String(state.game.settings?.[f.key] ?? f.default)) act("POST", "/game/settings", { settings: { [f.key]: sel.value } });
    } else if (sel.dataset.itemSelect !== undefined) {
      const it = items[Number(sel.dataset.itemSelect)];
      it?.onChange?.(it.options[Number(sel.value)].value);
    }
  });
  o.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (e.target === o || b?.dataset.closeOverlay !== undefined) return close();
    if (!b) return;
    if (b.dataset.fs !== undefined) toggleFullscreen();
    if (b.dataset.sound !== undefined) return void act("POST", "/display", { sound: state.display?.sound === false });
    if (b.dataset.joinCode !== undefined) return openJoinCode();
    if (b.dataset.screen !== undefined) return openScreenLink();
    if (b.dataset.colorPlayer) return void act("POST", `/players/${encodeURIComponent(b.dataset.colorPlayer)}/color`, { color: b.dataset.color });
    if (b.dataset.watcherRemove || b.dataset.watcherPlay) return void watcherAction(b);
    if (b.dataset.invite !== undefined) return void openInvite(b.dataset.invite === "watch"); // D-169
    if (b.dataset.exchange) return void openExchange(b.dataset.exchange);
    if (b.dataset.aiOptions) return void (inRunningGame() ? editAiOptions(b.dataset.aiOptions) : configureAi(b.dataset.aiOptions));
    if (b.dataset.setting) {
      const f = gameFields().find((x) => x.key === b.dataset.setting);
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

// ---------- the table's access code (D-113) ----------
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_STATUS = { waiting: "checking…", accepted: "accepted", unknown: "not recognised", expired: "expired", revoked: "revoked", "in-use": "used by another table" };
const CODE_HELP = {
  none: "A code from the Game Table console approves this table at once, without a pairing code.",
  waiting: "Asking the service about this code…",
  accepted: "The service approved this table with this code.",
  unknown: "The service does not know this code. Check it, or ask an admin for a new one.",
  expired: "This code has run out. Ask an admin for a new one, or approve the table with its pairing code.",
  revoked: "An admin revoked this code.",
  "in-use": "Another table already uses this code. An admin can release it in the console.",
};
const codeMask = (hint) => `${hint}••-••••`;
/**
 * "valid forever", "valid for 12 weeks", … "valid for 30 minutes"; null when the code has run out. Rounded down, with a
 * minute's slack so a new one-week code reads "7 days", not "6 days".
 */
function validityText(expiresAt, now = Date.now()) {
  if (expiresAt === null) return "valid forever";
  const ms = expiresAt - now;
  if (ms <= 0) return null;
  const x = ms + 60_000; // the slack, for hours and up; minutes are counted exactly
  const n = (unit) => Math.floor(x / unit);
  const say = (k, word) => `valid for ${k} ${word}${k === 1 ? "" : "s"}`;
  if (x >= 14 * 86400_000) return say(n(7 * 86400_000), "week");
  if (x >= 86400_000) return say(n(86400_000), "day");
  if (x >= 3600_000) return say(n(3600_000), "hour");
  return say(Math.max(1, Math.floor(ms / 60_000)), "minute");
}
/**
 * The lobby's warning when the table's access code runs out within 3 hours (D-220), in minutes; refreshed by
 * the board's tick. Past its validity the table keeps working until an admin disconnects it, so it says that too.
 * The table's own board only: a remote player can do nothing about it.
 */
function codeWarning(now = Date.now()) {
  const code = state?.cloud?.code;
  if (REMOTE || code?.status !== "accepted" || code.expiresAt == null) return "";
  const ms = code.expiresAt - now;
  if (ms > CODE_WARN_MS) return "";
  if (ms <= 0) return "Access code expired";
  const min = Math.ceil(ms / 60_000);
  return `Access code expires in ${min} minute${min === 1 ? "" : "s"}`;
}
const CODE_WARN_MS = 3 * 3600_000;

/**
 * The board's one tick for what counts down in minutes, every 30 s while the access code has an end: its validity in
 * Advanced, and the lobby's warning (D-220).
 */
const ticks = new Set();
const onTick = (fn) => (ticks.add(fn), () => ticks.delete(fn));
setInterval(() => state?.cloud?.code?.expiresAt && ticks.forEach((fn) => fn()), 30_000);
onTick(() => {
  const el = center.querySelector(".code-warning");
  if (el) el.textContent = codeWarning();
});

/** The badge after the masked code: the service's answer, or, once accepted, how long the code is valid. */
function codeBadge(code) {
  if (code.status === "accepted" && code.expiresAt !== undefined) {
    const text = validityText(code.expiresAt);
    // Past its validity the table keeps working (validity counts only for the first use); an admin may disconnect it.
    return text ? `<span class="code-status accepted" title="Accepted by the service">${esc(text)}</span>` : `<span class="code-status expired" title="Past its validity: the table keeps working until an admin disconnects it">expired</span>`;
  }
  return `<span class="code-status ${esc(code.status)}">${esc(CODE_STATUS[code.status] ?? code.status)}</span>`;
}

/**
 * The group for the table's access code, in Advanced (D-219): on the table's own board only, and only with the
 * service. Set up once, so it is out of the way of the settings people use while playing.
 */
function serviceSettings() {
  const c = state.cloud;
  if (REMOTE || !c || c.status === "disabled") return "";
  const code = c.code;
  const value = code ? `<span class="code-value"><span class="mono">${esc(codeMask(code.hint))}</span> ${codeBadge(code)}</span>` : `<span class="faint">none</span>`;
  const button = code?.source === "start" ? `<span class="faint">set at start</span>` : `<button data-access-code>${code ? "Change" : "Enter code"}</button>`;
  const pastValidity = code?.status === "accepted" && code.expiresAt != null && code.expiresAt <= Date.now();
  const help = pastValidity
    ? "This code's validity has ended. The table keeps working, but an admin may disconnect it; ask for a new code to be safe."
    : code?.source === "start" && code.status === "accepted"
      ? "Given when the table started (TABLE_CODE or --code); the service approved this table with it."
      : CODE_HELP[code?.status ?? "none"];
  return `<div class="group service"><div class="eyebrow">Game Table service</div>
    <div class="row"><span>Access code</span><span class="code-cell">${value}${button}</span></div>
    <div class="faint code-help" style="font-size:.7em;margin-top:6px">${esc(help)}</div></div>`;
}

/**
 * A keypad for the code: the board is a touchscreen without a keyboard. A keyboard works too, and so does pasting
 * (Ctrl/⌘+V or the Paste button), with or without the dash the console shows.
 */
let codePad = null;
function openCodePad() {
  if (codePad) return;
  const o = (codePad = document.createElement("div"));
  o.className = "overlay code-pad";
  let typed = "";
  const fromBoard = state.cloud.code?.source === "board";
  const draw = () => {
    const slots = Array.from({ length: 8 }, (_, i) => `<span class="slot ${i === typed.length ? "next" : ""}">${esc(typed[i] ?? "")}</span>${i === 3 ? `<span class="dash">-</span>` : ""}`).join("");
    o.innerHTML = `<div class="panel"><h2>Access code</h2>
      <p class="faint" style="margin:0 0 14px;font-size:.8em">From the Game Table console. It approves this table without a pairing code.</p>
      <div class="slots" aria-live="polite" aria-label="Code typed so far">${slots}</div>
      <div class="keys">${[...CODE_ALPHABET].map((k) => `<button data-key="${k}" ${typed.length >= 8 ? "disabled" : ""}>${k}</button>`).join("")}
        <button class="third" data-paste>Paste</button><button class="third" data-back aria-label="Delete the last character" ${typed ? "" : "disabled"}>⌫</button><button class="third" data-clear ${typed ? "" : "disabled"}>Clear</button></div>
      <div class="actions">${fromBoard ? `<button class="danger" data-remove>Remove code</button>` : ""}<span style="flex:1"></span>
        <button data-cancel>Cancel</button><button class="primary" data-save ${typed.length === 8 ? "" : "disabled"}>Use this code</button></div></div>`;
    faceFront(o.querySelector(".panel"));
  };
  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("paste", onPaste, true);
    o.remove();
    codePad = null;
  };
  const save = async (code) => {
    try {
      await api("POST", "/cloud/code", { code });
      close(); // the settings behind show the code and what the service says about it
    } catch {}
  };
  const press = (k) => {
    if (k === "back") typed = typed.slice(0, -1);
    else if (k === "clear") typed = "";
    else if (typed.length < 8 && CODE_ALPHABET.includes(k)) typed += k;
    draw();
  };
  /** Fill in a pasted code: upper case, spaces and dashes ignored; anything else means it is not a code. */
  const fill = (text) => {
    const s = String(text ?? "").toUpperCase().replace(/[\s-]/g, "");
    if (!s) return toast("The clipboard is empty");
    if (s.length > 8 || ![...s].every((c) => CODE_ALPHABET.includes(c))) return toast("That is not an access code (8 characters, like ABCD-EFGH)");
    typed = s;
    draw();
  };
  const onPaste = (e) => {
    e.preventDefault();
    fill(e.clipboardData?.getData("text"));
  };
  const pasteButton = async () => {
    try {
      fill(await navigator.clipboard.readText());
    } catch {
      toast("The browser did not allow reading the clipboard: press Ctrl+V (⌘V on a Mac), or type the code");
    }
  };
  const onKey = (e) => {
    // Shortcuts (Ctrl/⌘+V and the like) are not letters: let the browser handle them, and the paste event fills in.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Enter" && typed.length === 8) return void save(typed);
    if (e.key === "Backspace") return (e.preventDefault(), press("back"));
    const k = e.key.toUpperCase();
    if (k.length === 1 && CODE_ALPHABET.includes(k)) press(k);
  };
  o.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (e.target === o || b?.dataset.cancel !== undefined) return close();
    if (!b) return;
    if (b.dataset.key) press(b.dataset.key);
    else if (b.dataset.back !== undefined) press("back");
    else if (b.dataset.clear !== undefined) press("clear");
    else if (b.dataset.paste !== undefined) pasteButton();
    else if (b.dataset.save !== undefined) save(typed);
    else if (b.dataset.remove !== undefined) save("");
  });
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("paste", onPaste, true);
  draw();
  overlayRoot.appendChild(o);
}

/**
 * The game's corner for Lobby, Show result and Statistics (its manifest's `lobbyButton`), as a class. On a remote board
 * turned to a north seat the surface stands on its head, so the corner is taken as its player sees it and the buttons
 * turn with them (D-157): "top-right" is their top right, with upright text, and the tools stay at their bottom left.
 */
const CORNER_NAMES = ["top-left", "top-right", "bottom-right", "bottom-left"];
function cornerClass(name) {
  if (!REMOTE || remoteEdge() !== "north") return name;
  return `${CORNER_NAMES[(CORNER_NAMES.indexOf(name) + 2) % 4]} turned`;
}

// ---------- center panel ----------
function render() {
  if (!state) return;
  gameEdge(); // keeps the last north/south facing current, so a game starts facing the way the lobby last did
  renderSeats();
  if (REMOTE) fit();
  renderViewButton();
  const front = viewEdge();
  center.style.transform = `rotate(${ROT[front]}deg)`;
  center.classList.toggle("sideways", front === "east" || front === "west");

  const playing = !lobbyPhase();
  // A game that ends by itself keeps its last screen until someone taps Show result (D-091); one ended from the
  // lobby goes straight to the result. This is per screen: each board (and remote board) moves on by itself.
  if (state.phase === "finished" && (lastPhase === "active" || lastPhase === "paused") && game) {
    holdFinal = true;
    settleFinal();
  }
  if (state.phase !== "finished") {
    holdFinal = false;
    finalSettled = true;
    finalToken++;
  }
  lastPhase = state.phase;
  const showingGame = playing || holdFinal;
  lobbyBtn.hidden = !playing;
  // Beside its corner when the corner arrows stay during the game (D-227), so both have room.
  const gameCorner = `${cornerClass(state.game?.lobbyButton ?? "bottom-right")}${!REMOTE && anyFacing() ? " beside" : ""}`;
  lobbyBtn.className = gameCorner;
  // The way on from a game's last screen (D-216): Awards and Results when the game has them (their window's Done leads
  // to the results), else Show result straight to the results.
  const atEnd = holdFinal && finalSettled;
  const stats = hasStatistics(state.summary);
  resultBtn.hidden = !atEnd || stats;
  resultBtn.className = `primary ${gameCorner}`;
  statsBtn.hidden = !atEnd || !stats;
  statsBtn.className = `primary ${gameCorner}`;
  if (state.phase !== "finished") overlayRoot.querySelector(".overlay.statistics")?.remove();

  renderPause();
  renderAway();
  renderCorners(showingGame && state.phase !== "paused" && !anyFacing());
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
  // With an access code that the service did not accept, the board says why, beside the pairing code (D-113).
  const codeNote = c.code && c.code.status !== "accepted" && c.code.status !== "waiting" ? ` · access code <span style="white-space:nowrap">${esc(codeMask(c.code.hint))}</span>: ${esc(CODE_STATUS[c.code.status] ?? c.code.status)}` : "";
  if (c.status === "pending")
    return `<div class="cloud">Waiting for an admin to approve this table · pairing code <b>${esc(c.pairingCode ?? "…")}</b>${codeNote || (c.code ? "" : " · or enter an access code in Advanced")}</div>`;
  if (c.status === "offline") return `<div class="cloud">The table is offline · new games start when the connection returns</div>`;
  if (c.status === "revoked")
    return c.code?.status === "revoked"
      ? `<div class="cloud">This table's access code was revoked, so it is disconnected. An admin can reconnect it in the console.</div>`
      : `<div class="cloud">This table was disconnected by an admin. It reconnects by itself once an admin presses Reconnect in the console.</div>`;
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

/** No free seat (D-129): + AI player and Invite are greyed out, with the reason as their tooltip. */
function fullAttr() {
  return state.noSeat ? `disabled title="${esc(state.noSeat)}"` : "";
}
/** The remote places (D-168): remote players and watchers together, at most `max`. */
function remotePlaces() {
  const watching = state.watchers?.length ?? 0;
  const used = (state.remote?.players ?? 0) + watching;
  const max = state.remote?.maxPlayers ?? 4;
  return { used, watching, max, full: used >= max };
}

/** Invite: a player while a seat is free, else a watcher (D-168); off when the remote places are taken. */
function inviteButton(label) {
  if (state.cloud?.status !== "online")
    return `<button data-invite disabled title="Remote play needs the connection to the Game Table service">${label}</button>`;
  if (remotePlaces().full) return `<button data-invite disabled title="All remote places are taken (players and watchers)">${label}</button>`;
  // During a game a person comes in only through an exchange (D-159), so the lobby's invite is for watching.
  const why = inRunningGame() ? "During a game, a remote player comes in through an exchange" : state.noSeat;
  return why ? `<button data-invite="watch" title="${esc(why)}: invite someone to watch">Invite a watcher…</button>` : `<button data-invite>${label}</button>`;
}

/** Settings › Joining, the remote row (D-169): what an invite brings now, and how many remote places are taken. */
function remoteJoinText() {
  const r = remotePlaces();
  const used = `<span class="faint">${r.used} of ${r.max} remote places taken${r.watching ? ` (${r.watching} watching)` : ""}</span>`;
  if (state.cloud?.status !== "online") return `Someone remote, with an invite link <span class="faint">· needs the Game Table service</span>`;
  const what = r.full
    ? "Someone remote, with an invite link"
    : inRunningGame()
      ? "Someone remote, as a watcher; tap a player's name below to give them a seat"
      : state.noSeat
        ? "Someone remote, as a watcher: every seat is taken"
        : "Someone remote, with an invite link (or to watch only)";
  return `${what} · ${used}`;
}

function joinPanel() {
  if (REMOTE) return "";
  // Played from the board (D-175): no phone joins at the table, so no code to scan.
  if (state.developer?.boardDeck) return `<aside class="join board-deck"><div class="eyebrow">Played from the board</div>
    <p class="faint">The deck beside the board is the one player at the table (Developer settings). Remote players come with an invite.</p>
    <div class="right">${inviteButton("Invite remote player…")}</div></aside>`;
  const code = state.joinUrl.split("/").pop();
  // No free seat (D-129): the code still works for nobody, so the panel says so; a phone that scans it is told too.
  if (state.noSeat) return `<aside class="join full">
    <div class="eyebrow">No free seat</div>
    <img src="/qr.svg?u=${encodeURIComponent(state.joinUrl)}" alt="QR code to join this table, while no seat is free" class="dimmed">
    <div class="full-note">${esc(state.noSeat)}</div>
    <button data-new-code style="font-size:.7em">New code</button>
  </aside>`;
  return `<aside class="join">
    <div class="eyebrow">Scan to join locally</div>
    <img src="/qr.svg?u=${encodeURIComponent(state.joinUrl)}" alt="QR code to join this table locally">
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
    ${REMOTE ? "" : `<div class="right"><button data-add-ai ${fullAttr()}>+ AI player</button>${inviteButton("Invite remote player…")}</div>`}
  </div>
  ${REMOTE || !sel ? "" : `<div class="toolbar selected"><div class="right"><span class="faint">${esc(sel.name)}</span>
    ${sel.kind === "ai" ? `<button data-config="${sel.id}">Configure</button>` : ""}
    <button class="danger" data-remove="${sel.id}">Remove</button></div></div>`}`;
}

function renderLobby() {
  const humans = state.players.filter((p) => p.kind === "human").length;
  center.innerHTML = `<section class="main">
      <div class="title-row"><div class="eyebrow">${esc(state.tableName)}</div><span class="code-warning">${codeWarning()}</span></div>
      ${cloudNotice()}<h1>Pick a game</h1>
      <div class="sub">${humans ? `${humans} at the table${REMOTE ? "" : " · tap a seat, then another to move a player"}` : REMOTE ? "Waiting for players" : "Scan the code to take a seat"}${remoteNote()}</div>
      ${gameTiles()}
      ${toolbar()}
    </section>${joinPanel()}`;
  sizeTiles();
}

// The lobby shows the games a page at a time (three tiles fit beside the join panel), with arrows and dots.
const PAGE_SIZE = 3;
let gamePage = 0;
/** A remote board that may not operate the table: a watcher, or board control switched off (D-167, D-170). */
const viewOnly = () => REMOTE && !state.remote?.boardControl;
// A remote board without board control (a watcher, or control switched off) shows the games, not as buttons (D-170).
const tileHtml = (g) => `<button class="tile ${g.selectable ? "selectable" : ""} ${viewOnly() ? "view-only" : ""}" data-game="${g.id}" ${g.selectable && !viewOnly() ? "" : viewOnly() ? 'tabindex="-1" aria-disabled="true"' : "disabled"}>
          <span class="title">${esc(g.name)}</span><span class="desc">${esc(g.description ?? "")}</span>
          <span class="faint" style="font-size:.66em">${playersLabel(g.players)}${g.ai ? " · AI" : ""}${g.extra ? ` · <span style="color:var(--brass)">extra</span>` : ""}</span>
          ${g.selectable ? `<span class="hint">${esc(tileHint(g))}</span>` : `<span class="why">${esc(g.reasons[0])}</span>`}</button>`;
function gameTiles() {
  const pages = Math.max(1, Math.ceil(games.length / PAGE_SIZE));
  gamePage = Math.min(gamePage, pages - 1);
  const tiles = games.slice(gamePage * PAGE_SIZE, (gamePage + 1) * PAGE_SIZE).map(tileHtml).join("");
  const pager = pages < 2 ? "" : `<div class="pager">
      <button data-page="-1" ${gamePage === 0 ? "disabled" : ""} aria-label="Previous games">‹</button>
      ${Array.from({ length: pages }, (_, i) => `<button class="dot ${i === gamePage ? "on" : ""}" data-page-to="${i}" aria-label="Games page ${i + 1}"></button>`).join("")}
      <button data-page="1" ${gamePage === pages - 1 ? "disabled" : ""} aria-label="More games">›</button>
      <span class="faint">${games.length} games</span></div>`;
  return `<div class="games">${tiles}</div>${pager}`;
}

/**
 * Every tile as tall as the tallest of all the games, on any page (D-228), so paging doesn't move the pager or what
 * is below it. All tiles are laid out once, unseen, at the grid's width; that is redone only when their text or the
 * width changes (games added or removed, a game's hint, a narrower remote board), not on every redraw.
 */
let tileSize = { key: "", height: 0 };
function sizeTiles() {
  const grid = center.querySelector(".games");
  if (!grid) return;
  const key = `${grid.clientWidth}|${games.map(tileHtml).join("")}`;
  if (key !== tileSize.key) {
    const probe = document.createElement("div");
    probe.className = "games";
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;width:${grid.clientWidth}px`;
    probe.innerHTML = games.map(tileHtml).join("");
    grid.parentElement.appendChild(probe);
    // offsetHeight: the layout size, before the surface's scale and rotation.
    const height = Math.max(0, ...[...probe.children].map((t) => t.offsetHeight));
    probe.remove();
    tileSize = { key, height };
  }
  grid.style.setProperty("--tile-min", `${tileSize.height}px`);
}

/** What a choosable game still needs, or that it can start right away. */
function tileHint(g) {
  const n = g.needs ?? [];
  return n.length ? n[0][0].toUpperCase() + n[0].slice(1) : "Ready to play";
}

function remoteNote() {
  const r = state.remote;
  if (REMOTE && r?.watching) return ` · <span class="faint">watching — you are not a player at this table</span>`; // D-167
  if (REMOTE) return r && !r.boardControl ? ` · <span class="faint">view only — the table has switched off board control for remote players</span>` : "";
  return r?.players ? ` · ${r.players} remote` : "";
}

function playersLabel(p) {
  if (p.length === 1) return `${p[0]} players`;
  const contiguous = p.every((n, i) => i === 0 || n === p[i - 1] + 1);
  return contiguous ? `${p[0]}–${p.at(-1)} players` : `${p.join(", ")} players`;
}

/**
 * A seated player's chip on the Up next screen, in their colour (D-106): a filled dot once they are ready, a ring
 * before. Offline (their phone dropped; the seat is held for the grace period): no dot, a red background. On the
 * table's own board the chip is a button that offers to remove the player, online or not.
 */
function playerChip(p) {
  const state_ = !p.connected ? "offline" : p.ready ? "ready" : "not ready";
  const cls = `chip player ${p.connected ? (p.ready ? "ready" : "") : "away"}`;
  const inner = `${p.connected ? `<span class="dot" aria-hidden="true"></span>` : ""}${esc(p.name)}`;
  const style = p.color ? ` style="--pc:${esc(p.color)}"` : "";
  return REMOTE
    ? `<span class="${cls}"${style} title="${esc(p.name)}: ${state_}">${inner}</span>`
    : `<button type="button" class="${cls}"${style} data-chip="${esc(p.id)}" title="${esc(p.name)}: ${state_}. Tap to remove" aria-label="${esc(p.name)}, ${state_}. Remove…">${inner}</button>`;
}

function renderReady() {
  const humans = state.players.filter((p) => p.kind === "human" && p.seat !== null);
  const needs = state.game.needs ?? [];
  // AI players only (the developer setting, D-118): nobody needs to tap Ready.
  const all = needs.length === 0 && (humans.length > 0 || state.developer?.allowNoLocalPlayer) && humans.every((p) => p.ready && p.connected);
  const seated = state.players.filter((p) => p.seat !== null).length;
  const g = games.find((x) => x.id === state.game.id);
  const roomForAi = g?.ai && seated < Math.max(...state.game.players);
  center.innerHTML = `<section class="main waiting">
      <div><div class="eyebrow">Up next · ${playersLabel(state.game.players)} · ${seated} seated</div><h1>${esc(state.game.name)}</h1>
      <div class="sub">${needs.length ? `${esc(needs.map((n, i) => (i ? n : n[0].toUpperCase() + n.slice(1))).join(" · "))}. Scan the code to join${g?.ai ? " or add an AI player" : ""}.` : !humans.length ? "AI players only (developer setting): <b>Start game</b> plays it on the board." : !state.players.some((p) => p.seat !== null && p.kind === "human" && p.location === "local") && state.developer?.allowNoLocalPlayer ? "No player at the table (developer setting). Everyone taps <b>Ready</b> on their phone." : "Everyone taps <b>Ready</b> on their phone."}</div></div>
      <div class="ready-list">${state.players.filter((p) => p.seat !== null).map(playerChip).join("")}</div>
      ${REMOTE ? "" : `<div class="toolbar">${seatButtons()}${roomForAi ? `<div class="right"><button data-add-ai ${fullAttr()}>+ AI player</button></div>` : ""}</div>`}
      <div class="toolbar">${viewOnly() ? "" : `<button class="primary" data-start ${all ? "" : "disabled"}>Start game</button><button data-close>Change game</button>`}
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
  center.innerHTML = `<section class="main finished">
      <div class="summary"><div class="eyebrow">${esc(state.game?.name ?? "Game")} · finished</div>
      <div class="big">${esc(s?.text ?? "Game over")}</div>
      ${s?.table ? `<div class="summary-scroll">${summaryTable(s.table)}</div>` : ""}
      <div class="toolbar"><button class="primary" data-again>Play again</button>${hasStatistics(s) ? `<button data-stats>Awards and Results</button>` : ""}<button data-close>Back to lobby</button></div></div>
    </section>${joinPanel()}`;
}

// ---------- pause screen ----------
function renderPause() {
  const p = state.phase === "paused" ? state.pause : null;
  pauseLayer.hidden = !p;
  pauseLayer.classList.toggle("ai-wait", p?.reason === "ai" || p?.reason === "player");
  if (!p) return void (pauseLayer.innerHTML = "");
  if (p.reason === "ai") return renderAiWait(p);
  if (p.reason === "player") return renderPlayerWait(p);
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

/** Where a waiting card goes: from the seat a little toward the middle, so it covers the seat's corner of the game, not the table's edge. */
function nearSeat(seat) {
  const at = seatPositions(state.seatEdges)[seat] ?? { x: W / 2, y: H / 2 };
  return { x: at.x + (W / 2 - at.x) * 0.22, y: at.y + (H / 2 - at.y) * 0.42 };
}

/**
 * An AI player is out of time (D-112): the game is paused and the board stays visible. A card near the AI's seat, facing
 * the players, offers "Play now" (the game's quick move for it); otherwise the game goes on when the AI answers. Remote
 * boards show the button only when they have board control.
 */
function renderAiWait(p) {
  const who = state.players.find((x) => x.id === p.ai?.playerId);
  const { x, y } = nearSeat(p.ai?.seat);
  const control = !REMOTE || state.remote?.boardControl;
  pauseLayer.innerHTML = `<div class="ai-wait-card" data-ai-wait="${esc(p.ai?.playerId ?? "")}" style="left:${x}px;top:${y}px;transform:translate(-50%,-50%) rotate(${ROT[gameEdge()]}deg)">
    <div class="who"><span class="dot" style="background:${who?.color ?? "var(--brass)"}"></span>${esc(p.ai?.name ?? "AI player")}</div>
    <div class="what"><span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span> is still thinking</div>
    <p>The game is paused. ${control ? "Wait for it, or let it move now." : "It goes on as soon as the AI moves."}</p>
    ${control ? `<div class="row"><button class="primary" data-pause="play-now">Play now</button>${REMOTE ? "" : `<button class="danger" data-pause="end">End game</button>`}</div>` : ""}
  </div>`;
}

/**
 * The game can't go on without a player whose phone is away (D-119): paused, their seat held, the game visible. A card
 * near their seat says the game's reason; it goes on by itself when they are back, or the table ends the game.
 */
function renderPlayerWait(p) {
  const list = p.players ?? [];
  const first = list[0];
  const { x, y } = nearSeat(first?.seat);
  const control = !REMOTE || state.remote?.boardControl;
  const names = list.map((w) => {
    const who = state.players.find((x) => x.id === w.playerId);
    return `<span class="dot" style="background:${who?.color ?? "var(--brass)"}"></span>${esc(w.name)}`;
  }).join(" · ");
  const reasons = [...new Set(list.map((w) => w.text).filter(Boolean))];
  pauseLayer.innerHTML = `<div class="ai-wait-card player-wait" data-player-wait="${esc(list.map((w) => w.playerId).join(" "))}" style="left:${x}px;top:${y}px;transform:translate(-50%,-50%) rotate(${ROT[gameEdge()]}deg)">
    <div class="who">${names || "A player"}</div>
    <div class="what">${list.every((w) => w.left) ? "left the game" : `<span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span> ${list.length > 1 ? "are" : "is"} away`}</div>
    ${reasons.map((r) => `<p>${esc(r)}</p>`).join("")}
    <p>${list.every((w) => w.left) ? "The game is paused. They come back by scanning the join code with their name; or exchange them for another player, or end the game." : `The game is paused and goes on as soon as ${list.length > 1 ? "they are" : `${esc(first?.name ?? "they")} is`} back, or when they are exchanged.`}</p>
    ${control ? `<div class="row">${exchangeButtons(list)}<button class="danger" data-pause="end">End game</button></div>` : ""}
  </div>`;
}

/** "Exchange …" for away players (D-144, D-159): opens the exchange dialog (an AI, someone at the table, a remote player). */
function exchangeButtons(list) {
  if (REMOTE && !state.remote?.boardControl) return "";
  return list.map((w) => `<button data-exchange-away="${esc(w.playerId)}">Exchange ${esc(w.name)}…</button>`).join("");
}

const inRunningGame = () => state.phase === "active" || state.phase === "paused";
/** Who may be exchanged here (D-159): a seated player of the running game; a remote board only with board control. */
const canExchange = (p) => inRunningGame() && p.seat !== null && (!REMOTE || !!state.remote?.boardControl);

/**
 * Exchange a seat's player during a game (D-159). The seat keeps its cards and score; another player plays it from now
 * on: an AI player at once, or a person who joins with a QR code (at the table) or an invite (remote). The window stays
 * open until the new player has taken the seat, or it is cancelled. For an AI player: how it plays, instead.
 */
function openExchange(playerId) {
  const first = state.players.find((x) => x.id === playerId);
  if (!first || first.seat === null) return;
  const seat = first.seat;
  const o = document.createElement("div");
  o.className = "overlay exchange";
  let waiting = false; // an exchange for a person is open
  let error = "";
  const close = () => (unsub(), o.remove());
  const draw = () => {
    if (!state || !inRunningGame()) return close();
    const now = state.players.find((q) => q.seat === seat);
    const x = state.exchange && state.exchange.seat === seat ? state.exchange : null;
    if (waiting && !x) {
      // Taken (someone else is in the seat now) or cancelled elsewhere.
      if (now && now.id !== playerId) {
        toast(`${now.name} took over ${first.name}'s seat`);
        return close();
      }
      waiting = false;
    }
    if (x) waiting = true;
    const g = games.find((q) => q.id === state.game?.id);
    const cur = now ?? first;
    const dot = `<span class="pdot" style="background:${esc(cur.color ?? "")}"></span>`;
    const head = `<h2>${dot}Exchange ${esc(cur.name)}</h2>`;
    if (!waiting) {
      const online = state.cloud?.status === "online";
      // A new remote player needs a remote place (D-171); a remote player's own may free up (the table decides).
      const room = !remotePlaces().full || cur.location === "remote";
      const choices = [
        REMOTE || state.developer?.boardDeck ? "" : `<button class="choice" data-ex="local"><b>Someone at the table</b><span>A QR code to scan with their phone</span></button>`,
        `<button class="choice" data-ex="remote" ${online && room ? "" : "disabled"}><b>A remote player</b><span>${!online ? "Needs the connection to the Game Table service" : room ? "An invite link to send" : "All remote places are taken (players and watchers)"}</span></button>`,
        ...(state.watchers ?? []).map((w) => `<button class="choice" data-ex="watcher" data-watcher="${esc(w.id)}"><b>${esc(w.name)}, watching</b><span>Takes the seat from their own window</span></button>`),
        g?.ai && cur.kind !== "ai" ? `<button class="choice" data-ex="ai"><b>An AI player</b><span>Takes over at once</span></button>` : "",
        cur.kind === "ai" && (g?.aiOptions?.length ?? 0) ? `<button class="choice" data-ex="ai-options"><b>How ${esc(cur.name)} plays</b><span>Change this AI player's settings</span></button>` : "",
      ].join("");
      setPanel(o, `<div class="panel exchange-panel">${head}
        <p class="muted">The seat keeps its cards and score; from now on another player plays it.${cur.kind === "human" && cur.connected ? ` ${esc(cur.name)}'s phone is connected: ${esc(cur.name)} loses the seat.` : ""}</p>
        <div class="choices">${choices}</div>
        ${error ? `<p class="exchange-error">${esc(error)}</p>` : ""}
        <div class="actions settings-actions"><button class="primary" data-close-overlay>Cancel</button></div></div>`);
    } else {
      const local = x.kind === "local";
      if (x.watcher)
        return setPanel(o, `<div class="panel exchange-panel">${head}
        <p class="muted">${esc(x.watcher.name)}'s window opens a deck; ${esc(x.watcher.name)} takes over ${esc(cur.name)}'s seat from there.</p>
        <p class="exchange-wait"><span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span> Waiting for ${esc(x.watcher.name)}…</p>
        <div class="actions settings-actions"><button data-ex-cancel>Cancel</button></div></div>`);
      setPanel(o, `<div class="panel exchange-panel">${head}
        ${local ? `<div class="join-big"><img src="/qr.svg?exchange=1&s=${x.since}" alt="QR code to take over this seat">${linkLine(x.url)}</div>
          <p class="muted">Scan this with the new player's phone. They type their name and take over ${esc(cur.name)}'s seat.</p>`
          : `${x.url ? `<div class="join-big"><img src="/qr.svg?exchange=1&s=${x.since}" alt="QR code of the invite">${linkLine(x.url)}</div>` : ""}
          <p class="muted">Send this invite to the remote player, or let them scan the code. When they open it, they take over ${esc(cur.name)}'s seat.</p>`}
        <p class="exchange-wait"><span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span> Waiting for the new player to join…</p>
        <div class="actions settings-actions"><button data-ex-cancel>Cancel</button></div></div>`);
    }
  };
  const unsub = onState(draw);
  o.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (e.target === o && !waiting) return close();
    if (!b) return;
    if (b.dataset.closeOverlay !== undefined) return close();
    if (b.dataset.exCancel !== undefined) {
      await api("DELETE", "/exchange").catch(() => {});
      return close();
    }
    const kind = b.dataset.ex;
    if (!kind) return;
    const cur = state.players.find((q) => q.seat === seat) ?? first;
    if (kind === "ai-options") {
      close();
      return void editAiOptions(cur.id);
    }
    // The last player at the table (D-223): without one, the next game starts only with the developer setting "Games
    // without a player at the table", so the board says so, and switches it on with the exchange.
    const last = kind !== "local" && state.developer?.protectedPlayer === cur.id;
    if (last) {
      const what = kind === "ai" ? "an AI player" : kind === "watcher" ? "a watcher" : "a remote player";
      const then = REMOTE
        ? "Without a player at the table, the next game can start only once the table's board allows games without one (Developer settings)."
        : "Without a player at the table, the next game needs the developer setting “Games without a player at the table”, so it is switched on now (Developer settings).";
      if (!(await confirmDialog(`Exchange ${cur.name}, the last player at the table, for ${what}?`, `${kind === "ai" ? `An AI player takes over ${cur.name}'s seat for the rest of this game. ` : ""}${then}`, "Exchange"))) return;
    } else if (kind === "ai" && !(await confirmDialog(`Exchange ${cur.name} for an AI player?`, `An AI player takes over ${cur.name}'s seat for the rest of this game.`, "Exchange"))) return;
    error = "";
    const r = await api("POST", "/exchange", { seat, kind, ...(kind === "watcher" ? { watcher: b.dataset.watcher } : {}), ...(last && !REMOTE ? { allowNoLocalPlayer: true } : {}) }).catch((err) => ((error = err?.message ?? "That did not work"), null));
    if (r && kind === "ai") {
      toast(`An AI player took over ${cur.name}'s seat`);
      return close();
    }
    if (r) waiting = true;
    draw();
  });
  draw();
  overlayRoot.appendChild(o);
}

/**
 * Players away during a game whose seat waits for them (D-144): a card at the seat says so and offers to exchange them
 * (D-159). The game is not paused; it waits by itself when it is their move.
 */
function renderAway() {
  const list = state.phase === "active" && (!REMOTE || state.remote?.boardControl) ? (state.away ?? []) : [];
  awayLayer.hidden = !list.length;
  const html = list
    .map((w) => {
      const who = state.players.find((x) => x.id === w.playerId);
      const { x, y } = nearSeat(w.seat);
      return `<div class="ai-wait-card away-card" data-away="${esc(w.playerId)}" style="left:${x}px;top:${y}px;transform:translate(-50%,-50%) rotate(${ROT[gameEdge()]}deg)">
    <div class="who"><span class="dot" style="background:${who?.color ?? "var(--brass)"}"></span>${esc(w.name)}</div>
    <div class="what">${w.left ? "left the game" : "is away"}</div>
    <p>${w.left ? "The seat waits: they come back by scanning the join code with their name. Or exchange them for another player." : "The seat waits for them. Or exchange them for another player, and the game goes on."}</p>
    ${exchangeButtons([w]) ? `<div class="row">${exchangeButtons([w])}</div>` : ""}
  </div>`;
    })
    .join("");
  if (awayLayer.dataset.html !== html) {
    awayLayer.innerHTML = html;
    awayLayer.dataset.html = html;
  }
}

for (const layer of [pauseLayer, awayLayer])
  layer.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-exchange-away]");
    if (b) openExchange(b.dataset.exchangeAway);
  });

pauseLayer.addEventListener("click", async (e) => {
  const a = e.target.closest("button[data-pause]")?.dataset.pause;
  if (a === "resume") act("POST", "/game/resume");
  if (a === "play-now") act("POST", "/game/play-now");
  if (a === "save" && (await confirmDialog("Save and exit?", "The game is saved on this table and ends for now. Resuming saved games comes in a later update.", "Save and exit"))) {
    const r = await api("POST", "/game/save").catch(() => null);
    if (r) toast(`Saved as ${r.saveId}`);
  }
  if (a === "end" && (await confirmDialog("End this game?", "The game stops for everyone and the result is recorded as ended.", "End game"))) act("POST", "/game/end");
});

// ---------- game surface: the game's own board.js ----------
// A game package may ship board.js exporting mount(root, ctx) -> { update(view, events, info), destroy() }.
let game = null; // { key, inst, loading }

/**
 * Seats the board may move for by touch (D-102): on the table's board every human sitting at the table; on a remote
 * board only its own player. A game uses it to decide which tokens answer a tap; the table checks again.
 */
function controlSeats() {
  if (!state) return [];
  if (REMOTE) {
    const seat = remoteSeat();
    return seat === null ? [] : [seat];
  }
  return state.players.filter((p) => p.kind === "human" && p.location === "local" && p.seat !== null).map((p) => p.seat);
}

/** Send an intent for the player in `seat`, made by touching the board. Resolves { ok, reason }; a rejection toasts. */
function boardAct(seat, name, payload) {
  const p = state?.players.find((x) => x.seat === seat);
  if (!p) return Promise.resolve({ ok: false, reason: "nobody sits there" });
  return wsSend("game", "intent", { playerId: p.id, name, payload }).then((r) => {
    if (!r.ok && r.reason) toast(r.reason);
    return r;
  });
}

/**
 * Fire one of the game's skippable timers now (D-136), e.g. Hold'em's "Next hand". Resolves { ok, reason }. A timer that
 * fired meanwhile (a second tap, the wait ran out) answers 409 and is not worth a toast.
 */
async function skipTimer(id) {
  const res = await fetch("/api/v1/game/skip-timer", {
    method: "POST",
    headers: { ...(KEY ? { "x-table-key": KEY } : {}), "content-type": "application/json" },
    body: JSON.stringify({ id }),
  }).catch(() => null);
  if (res?.ok) return { ok: true };
  const data = await res?.json().catch(() => ({}));
  if (res?.status !== 409) toast(data?.error ?? "Could not skip");
  return { ok: false, reason: data?.error };
}

function gameInfo() {
  return {
    controlSeats: controlSeats(),
    // Whether this board may use the game's table controls (Next hand, D-136): always on the table's board, on a
    // remote board only while the table gives remote players board control.
    boardControl: !REMOTE || !!state.remote?.boardControl,
    players: state.players,
    seatColors: state.seatColors ?? {}, // seats whose player left keep their colour (D-125)
    seatEdges: state.seatEdges,
    seatPositions: seatPositions(state.seatEdges),
    frontEdge: gameEdge(),
    rotation: ROT[gameEdge()],
    settings: state.game?.settings ?? {},
    prefs: state.game?.prefs ?? {},
    sound: state.display?.sound !== false, // sound effects on (D-092)
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
    let mod;
    try {
      mod = await import(`/games/${state.game.id}/board.js?v=${encodeURIComponent(state.game.version)}`);
    } catch {
      mod = { mount: genericBoard };
    }
    if (game !== mine) return; // a newer game replaced this one while loading
    mine.inst = mod.mount(gameLayer, { gameId: state.game.id, assetUrl: (p) => `/games/${state.game.id}/assets/${p}`, act: boardAct, skipTimer });
  }
  if (game.inst && gameMsg) {
    game.inst.update(gameMsg.view, [], gameInfo());
    reportIdle(gameMsg.seq);
  }
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
  else if ("addAi" in d) act("POST", "/ai", {});
  else if (d.chip) {
    // The player's chip on the Up next screen: remove them, online or not.
    const p = state.players.find((x) => x.id === d.chip);
    if (!p) return;
    if (cannotRemove(p)) return;
    const why = p.kind === "ai" ? "The AI player leaves its seat." : p.connected ? "Their phone is disconnected and must scan the QR code again to rejoin." : "Their phone is offline; the seat is freed now instead of after the waiting time.";
    if (await confirmDialog(`Remove ${p.name}?`, why, "Remove")) {
      if (selectedPlayer === p.id) selectedPlayer = null;
      act("DELETE", `/players/${p.id}`);
    }
  } else if (d.remove) {
    const p = state.players.find((x) => x.id === d.remove);
    if (cannotRemove(p)) return;
    if (await confirmDialog(`Remove ${p?.name}?`, p?.kind === "ai" ? "The AI player leaves its seat." : "Their phone is disconnected and must scan the QR code again to rejoin.", "Remove")) {
      selectedPlayer = null;
      act("DELETE", `/players/${d.remove}`);
    }
  } else if ("start" in d) act("POST", "/game/start");
  else if ("close" in d) act("POST", "/game/close");
  else if ("stats" in d) showStatistics();
  else if ("again" in d) act("POST", "/game/select", { gameId: state.game.id, settings: state.game.settings });
  else if ("invite" in d) openInvite(d.invite === "watch");
  else if ("newCode" in d && (await confirmDialog("New join code?", "The current QR code stops working. Players already at the table stay in.", "New code"))) act("POST", "/join/new");
});

lobbyBtn.addEventListener("click", openLobbyOverlay);

/**
 * The terms of service in a window on the board (D-108), over whatever is open, facing the lobby's edge; closed by ✕,
 * Close, the backdrop or Escape. Not a new tab: a remote board lives in a frame, and a tab's "Back" went nowhere.
 */
async function openTerms() {
  const o = document.createElement("div");
  o.className = "overlay terms";
  o.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-label="Terms of service">
    <div class="terms-head"><h2>Terms of service</h2><button class="terms-close" data-close-terms aria-label="Close">✕</button></div>
    <div class="md"><p class="muted">Loading…</p></div>
    <div class="actions" style="display:flex;justify-content:flex-end;margin-top:20px"><button class="primary" data-close-terms>Close</button></div></div>`;
  faceFront(o.querySelector(".panel"));
  overlayRoot.appendChild(o);
  // Escape is the board-wide handler's: a click on this overlay.
  o.addEventListener("click", (e) => {
    if (e.target === o || e.target.closest("[data-close-terms]")) o.remove();
  });
  try {
    const r = await fetch("/shared/terms.md");
    if (!r.ok) throw new Error(String(r.status));
    const { html } = renderRules(await r.text(), "/shared/");
    o.querySelector(".md").innerHTML = html;
  } catch {
    o.querySelector(".md").innerHTML = `<p class="muted">The terms could not be loaded. Try again in a moment.</p>`;
  }
}

function openLobbyOverlay() {
  const o = document.createElement("div");
  o.className = "overlay";
  const draw = () => {
    setPanel(o, `<div class="panel"><h2>Lobby</h2>
      <div class="group"><div class="eyebrow">Players</div>${state.players
        .map((p) => `<div class="row"><span>${esc(p.name)} <span class="faint">· ${p.seat === null ? "no seat" : `${esc(seatName(state.seatEdges, p.seat))} seat`}${p.connected ? "" : " · reconnecting"}</span></span>
          ${canExchange(p) ? `<button data-exchange="${p.id}">Exchange…</button>` : REMOTE ? "" : `<button class="danger" data-remove="${p.id}">Remove</button>`}</div>`)
        .join("") || `<div class="faint">Nobody yet</div>`}</div>
      ${REMOTE ? "" : `<div class="group"><div class="eyebrow">View</div><div class="row"><span>Lobby and menus face</span>
        <span class="seg">${EDGE_ORDER.map((e) => `<button data-face="${e}" class="${state.frontEdge === e ? "on" : ""}">${e[0].toUpperCase() + e.slice(1)}</button>`).join("")}</span></div></div>`}
      <div class="group">${REMOTE ? "" : `<div class="row"><span>Remote players${state.remote?.players ? ` · ${state.remote.players} joined` : ""}${state.watchers?.length ? ` · ${state.watchers.length} watching` : ""}</span>${inviteButton("Invite…")}</div>`}
        <div class="row"><span>Terms of service</span><button data-terms>Open</button></div></div>
      <div class="actions" style="display:flex;justify-content:space-between;margin-top:20px">
        <button class="danger" data-end>End game</button><button class="primary" data-close-overlay>Back to game</button></div></div>`);
  };
  draw();
  const unsub = onState(draw);
  o.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (e.target === o || b?.dataset.closeOverlay !== undefined) return (unsub(), o.remove());
    if (!b) return;
    if (b.dataset.face) act("POST", "/face", { edge: b.dataset.face });
    if (b.dataset.invite !== undefined) openInvite(b.dataset.invite === "watch");
    if (b.dataset.terms !== undefined) openTerms();
    if (b.dataset.exchange) return void openExchange(b.dataset.exchange); // a running game keeps its players (D-159)
    if (b.dataset.remove) {
      const p = state.players.find((x) => x.id === b.dataset.remove);
      if (cannotRemove(p)) return;
      if (await confirmDialog(`Remove ${p?.name}?`, "They are not playing in this game, which goes on as it is.", "Remove")) act("DELETE", `/players/${b.dataset.remove}`);
    }
    if (b.dataset.end !== undefined && (await confirmDialog("End this game?", "The game stops for everyone and the result is recorded as ended.", "End game"))) {
      await act("POST", "/game/end");
      unsub();
      o.remove();
    }
  });
  overlayRoot.appendChild(o);
}

// ---------- the join code, from the settings (D-130) ----------
/**
 * The QR code, address and code for phones, whenever the lobby's QR panel is not on the screen (during a game): a
 * phone that lost its seat or its session rejoins with it. Follows a new code and the free seats (D-129).
 */
function openJoinCode() {
  const o = document.createElement("div");
  o.className = "overlay join-code";
  const draw = () => {
    if (!state) return;
    const code = state.joinUrl.split("/").pop();
    setPanel(o, `<div class="panel"><h2>Join the table</h2>
      <div class="join-big">
        <img src="/qr.svg?u=${encodeURIComponent(state.joinUrl)}" alt="QR code to join this table" class="${state.noSeat ? "dimmed" : ""}">
        <div>${linkLine(state.joinUrl)}<div class="code" style="text-align:center;margin-top:6px">${esc(code)}</div></div>
        ${state.noSeat ? `<div class="full-note">${esc(state.noSeat)}</div>` : `<div class="faint" style="font-size:.75em;text-align:center">Scan with the phone's camera to join, or to rejoin after the phone lost its seat.</div>`}
      </div>
      <div class="actions settings-actions"><button data-new-code-here>New code</button><button class="primary" data-close-overlay>Done</button></div></div>`);
  };
  draw();
  const unsub = onState(draw);
  const close = () => (unsub(), o.remove());
  o.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (e.target === o || b?.dataset.closeOverlay !== undefined) return close();
    if (b?.dataset.newCodeHere !== undefined && (await confirmDialog("New join code?", "The current QR code stops working. Players already at the table stay in.", "New code"))) act("POST", "/join/new");
  });
  overlayRoot.appendChild(o);
}

/**
 * The board on another screen (D-190): a QR code and link with the table key. Opened on an iPad, a TV or another
 * computer on the same network, it remembers that browser and moves the board there; this window then offers to take
 * it back. Only on the table's own board (remote boards have no key).
 */
function openScreenLink() {
  const o = document.createElement("div");
  o.className = "overlay join-code";
  const link = `${new URL(state.joinUrl).origin}/board/screen?key=${encodeURIComponent(KEY)}`;
  setPanel(o, `<div class="panel"><h2>The board on another screen</h2>
    <div class="join-big">
      <img src="/qr.svg?screen" alt="QR code that opens the board on another screen">
      <div>${linkLine(link)}</div>
      <div class="faint" style="font-size:.75em;text-align:center;max-width:520px">Scan it with the iPad's camera, or open the link in its browser. The screen must be on this WiFi. It shows the board from then on, also after a restart; this window offers to take the board back.<br><b>The link lets a screen run the table:</b> show it only on screens you own.</div>
    </div>
    <div class="actions settings-actions"><button class="primary" data-close-overlay>Done</button></div></div>`);
  const close = () => o.remove();
  o.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (e.target === o || b?.dataset.closeOverlay !== undefined) close();
  });
  overlayRoot.appendChild(o);
}

// ---------- Advanced (D-128) ----------
/**
 * The versions running on this table (D-182), at the bottom of Advanced, also on remote boards: the platform (its
 * release, "dev" outside a release build, and protocol) and every game the lobby offers, with games added from a
 * game repository marked.
 */
function versionsGroup(platform) {
  const list = [...games].sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="group versions"><div class="eyebrow">Versions</div>
    <div class="vlist"><span>Platform</span><span class="v">${platform ? `${esc(platform.version)} <span class="faint">· protocol ${esc(String(platform.protocol))}</span>` : `<span class="faint">…</span>`}</span>
      ${list.map((g) => `<span data-game="${esc(g.id)}">${esc(g.name)}${g.extra ? ` <span class="faint">(added)</span>` : ""}</span><span class="v">${esc(g.version)}</span>`).join("")}</div></div>`;
}

/**
 * Tools that are not part of playing: AI-only simulations, the game logs and the developer setting, behind the
 * hammer-and-wrench button beside the gear. A remote board with board control gets the game logs only.
 */
function openAdvanced() {
  const o = document.createElement("div");
  o.className = "overlay advanced";
  let platform = null;
  const draw = () => {
    if (!state) return;
    const dev = !!state.developer?.allowNoLocalPlayer;
    setPanel(o, `<div class="panel"><h2>Advanced</h2>
      <p class="muted" style="font-size:.8em;margin-top:-6px">For testing and finding problems; not needed to play.</p>
      ${REMOTE ? "" : `<div class="group"><div class="eyebrow">Simulation</div>
        <div class="row"><span>Games of AI players only, without the board, for testing and AI training</span><button data-adv="sim">Simulation…</button></div></div>`}
      <div class="group"><div class="eyebrow">Game logs</div>
        <div class="row"><span>Finished games on this table, move by move</span><button data-adv="logs">Game logs…</button></div></div>
      ${REMOTE ? "" : `<div class="group developer"><div class="eyebrow">Developer settings</div>
        <div class="row"><span>Games without a player at the table</span><button data-adv="no-local" data-dev-no-local class="${dev ? "on" : ""}" role="switch" aria-checked="${dev}">${dev ? "On" : "Off"}</button></div>
        <div class="faint" style="font-size:.7em;margin-top:6px">For testing: games with remote and AI players only, or AI players only. Off again when the table restarts.</div>
        <div class="row" style="margin-top:10px"><span>Play from the board: one player's deck beside the board, no phone</span><button data-adv="board-deck" class="${state.developer?.boardDeck ? "on" : ""}" role="switch" aria-checked="${!!state.developer?.boardDeck}">${state.developer?.boardDeck ? "On" : "Off"}</button></div>
        <div class="faint" style="font-size:.7em;margin-top:6px">For developing games without a phone: the board shows one player's deck, like a remote player's page, and nobody else joins at the table (the QR code goes); remote and AI players as usual. Off again when the table restarts; that player stays.</div>
        <div class="row" style="margin-top:10px"><span>What holds the game up right now: AI players, the board, the phones</span><button data-adv="live">Live status…</button></div></div>`}
      ${serviceSettings()}
      ${versionsGroup(platform)}
      <div class="actions settings-actions"><button class="primary" data-close-overlay>Done</button></div></div>`);
  };
  draw();
  const unsub = onState(draw);
  const unsubTick = onTick(draw); // the access code's "valid for …" counts down while Advanced is open
  api("GET", "/version").then((v) => ((platform = v), draw())).catch(() => {});
  const close = () => (unsub(), unsubTick(), o.remove());
  // Choices with more options than fit as buttons are pulldowns (D-129b).
  o.addEventListener("change", (e) => {
    const sel = e.target.closest("select");
    if (!sel) return;
    if (sel.dataset.settingSelect) {
      const f = gameFields().find((x) => x.key === sel.dataset.settingSelect);
      if (f && sel.value !== String(state.game.settings?.[f.key] ?? f.default)) act("POST", "/game/settings", { settings: { [f.key]: sel.value } });
    } else if (sel.dataset.itemSelect !== undefined) {
      const it = items[Number(sel.dataset.itemSelect)];
      it?.onChange?.(it.options[Number(sel.value)].value);
    }
  });
  o.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (e.target === o || b?.dataset.closeOverlay !== undefined) return close();
    const a = b?.dataset.adv;
    if (a === "sim") return (close(), openSimulation());
    if (a === "logs") return (close(), openGameLogs());
    if (a === "live") return (close(), openLiveStatus());
    if (b?.dataset.accessCode !== undefined) return openCodePad();
    if (a === "no-local") act("POST", "/developer", { allowNoLocalPlayer: !state.developer?.allowNoLocalPlayer });
    if (a === "board-deck") act("POST", "/developer", { boardDeck: !state.developer?.boardDeck });
  });
  overlayRoot.appendChild(o);
}

// ---------- live status (D-157) ----------
/**
 * What holds a game up, refreshed twice a second: each AI player's move in the making (pause before acting, waiting for
 * the board, thinking), how far the board has shown the game, what each phone is still held back (D-143), and the AI
 * players' recent answers. For finding problems; the table's own board only.
 */
function openLiveStatus() {
  const o = document.createElement("div");
  o.className = "overlay live-status";
  const s = (ms) => (ms === null || ms === undefined ? "–" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
  const draw = (d) => {
    if (!d) return;
    const p = d.pacing;
    const behind = p.sent - p.shown;
    const html = `<div class="panel"><h2>Live status</h2>
      <p class="muted" style="font-size:.8em;margin-top:-6px">Game ${esc(d.phase)}${d.pause ? ` · paused (${esc(d.pause)})` : ""}</p>
      <div class="group"><div class="eyebrow">Board</div>
        <div class="row"><span>${p.on ? (p.localBoard ? "AI players and phones follow this board" : "No board at the table: nothing waits") : "Pacing off (BOARD_PACING=0)"}</span><span>${behind > 0 ? `<b>${behind} message${behind > 1 ? "s" : ""} still to show</b>, the last sent ${s(p.sentMsAgo)} ago` : "has shown everything"}</span></div></div>
      <div class="group"><div class="eyebrow">AI players</div>
        ${d.ai.length ? d.ai.map((a) => `<div class="row"><span>${esc(a.name)}</span><span>${esc(a.state)} · ${s(a.ms)}</span></div>`).join("") : `<div class="row"><span>No AI player is asked right now</span></div>`}</div>
      <div class="group"><div class="eyebrow">Phones held back until the board shows the AI moves</div>
        ${d.decks.length ? d.decks.map((x) => `<div class="row"><span>${esc(x.player)}</span><span>${x.held} message${x.held > 1 ? "s" : ""}, the oldest ${s(x.oldestMsAgo)}</span></div>`).join("") : `<div class="row"><span>None: every phone has the latest</span></div>`}</div>
      <div class="group"><div class="eyebrow">Recent AI answers</div>
        <div class="live-trace">${d.trace.length ? d.trace.slice().reverse().map((t) => `<div>${s(t.msAgo)} ago · ${esc(t.name)}: ${esc(t.what)}</div>`).join("") : "none yet"}</div></div>
      <div class="actions settings-actions"><button class="primary" data-close-overlay>Done</button></div></div>`;
    setPanel(o, html);
  };
  let stop = false;
  const poll = async () => {
    if (stop) return;
    draw(await api("GET", "/debug").catch(() => null));
    setTimeout(poll, 500);
  };
  poll();
  o.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (e.target === o || b?.dataset.closeOverlay !== undefined) (stop = true), o.remove();
  });
  overlayRoot.appendChild(o);
}

// ---------- the Game Viewer (D-120) ----------
/** Finished games, move by move: from Advanced (D-128), also on remote boards with board control. */
function openGameLogs() {
  openViewer({
    api,
    overlayRoot,
    toast,
    face: (el) => (faceFront(el), overlayEdge() === "east" || overlayEdge() === "west"),
    openStats: (summary, gameName) => openStatistics({ summary, gameName, overlayRoot, edge: overlayEdge(), turnable: !REMOTE }),
  });
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
      // How the games ended (D-116): a run of stalled games must not look like a good one.
      const ends = Object.entries(r.endReasons ?? {}).map(([k, n]) => `${n} ${k === "terminated" ? "stopped" : k}`).join(", ");
      out.innerHTML = `Done: ${r.games.length} game(s)${ends ? ` (${esc(ends)})` : ""}. Log <code>${esc(r.logId)}</code> saved${state?.cloud?.status === "online" ? " and queued for upload to the service" : ""}.`
        + (r.verified === false ? `<br><span style="color:var(--ruby, #e07a6b)">Some games did not replay to the same end: the log says which.</span>` : "")
        + (r.games.some((g) => g.reason !== "finished") ? `<br>Games that did not finish: ${esc(r.games.map((g, i) => (g.reason === "finished" ? null : `${i + 1}: ${g.summary?.text ?? g.reason}`)).filter(Boolean).slice(0, 3).join("; "))}` : "");
    } catch {
      out.textContent = "";
    }
  });
  overlayRoot.appendChild(o);
}

// ---------- typing a name on the board (D-155) ----------
/** At most this many characters (code points: an emoji or an accented letter counts once), the table's MAX_NAME. */
const MAX_NAME = 12;
/** A name as the table keeps it (D-148 trimName): control and invisible characters dropped, spaces tidied, cut. */
function cleanName(raw, trim = true) {
  let n = String(raw ?? "").normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f]/g, "").replace(/\s+/g, " ");
  if (trim) n = n.trimStart();
  n = Array.from(n).slice(0, MAX_NAME).join("");
  return trim ? n.trim() : n;
}
const NAME_ROWS = [[..."QWERTYUIOP"], [..."ASDFGHJKL"], [..."ZXCVBNM"], [..."ÄÖÜÉÈÀÇÑÅØ"]];
/**
 * A keyboard for a name: the board is a touchscreen without one (D-148). Letters (the first of each word capitalised,
 * ⇧ for the other case), common accented letters, digits by a switch, space and delete. A real keyboard, an input
 * method for any script, and pasting work in the field too. Calls done(name) with the cleaned name ("" for none).
 */
let namePad = null;
function openNamePad(initial, done, title = "Player's name") {
  if (namePad) return;
  const o = (namePad = document.createElement("div"));
  o.className = "overlay name-pad";
  let shift = false;
  let digits = false;
  o.innerHTML = `<div class="panel"><h2>${esc(title)}</h2>
    <div class="name-field"><input maxlength="48" autocomplete="off" spellcheck="false" aria-label="Name"><span class="count"></span></div>
    <div class="keys"></div>
    <div class="actions"><button data-clear>Clear</button><span style="flex:1"></span><button data-cancel>Cancel</button><button class="primary" data-save>Use this name</button></div></div>`;
  const input = o.querySelector("input");
  input.value = cleanName(initial);
  const length = () => Array.from(input.value).length;
  const capital = () => shift !== (input.value === "" || input.value.endsWith(" "));
  const drawKeys = () => {
    const up = capital();
    const full = length() >= MAX_NAME;
    const rows = digits ? [[..."1234567890"], [..."-'.&!?"]] : NAME_ROWS.map((r) => (up ? r : r.map((c) => c.toLowerCase())));
    const key = (k, cls = "") => `<button class="${cls}" data-key="${esc(k)}" ${full ? "disabled" : ""}>${k === " " ? "space" : esc(k)}</button>`;
    o.querySelector(".keys").innerHTML =
      rows.map((r) => `<div class="row">${r.map((k) => key(k)).join("")}</div>`).join("") +
      `<div class="row"><button class="wide" data-shift aria-pressed="${shift}" ${digits ? "disabled" : ""}>⇧</button>` +
      `<button class="wide" data-digits>${digits ? "ABC" : "123"}</button>${digits ? "" : key("ß")}${key(" ", "space")}` +
      `<button class="wide" data-back aria-label="Delete the last character" ${input.value ? "" : "disabled"}>⌫</button></div>`;
    o.querySelector(".count").textContent = `${length()}/${MAX_NAME}`;
  };
  const set = (v) => {
    input.value = cleanName(v, false);
    input.setSelectionRange(input.value.length, input.value.length); // keys type at the end
    shift = false;
    drawKeys();
  };
  // Keys don't take the focus from the field, so a real keyboard can carry on where the keys left off.
  o.addEventListener("mousedown", (e) => e.target.closest(".keys button") && e.preventDefault());
  const close = () => (o.remove(), (namePad = null));
  const save = () => (done(cleanName(input.value)), close());
  input.addEventListener("input", () => {
    const v = cleanName(input.value, false);
    if (v !== input.value) input.value = v;
    drawKeys();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) save();
  });
  o.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (e.target === o || b?.dataset.cancel !== undefined) return close();
    if (!b) return;
    if (b.dataset.key !== undefined) set(input.value + b.dataset.key);
    else if (b.dataset.back !== undefined) set(Array.from(input.value).slice(0, -1).join(""));
    else if (b.dataset.clear !== undefined) set("");
    else if (b.dataset.shift !== undefined) ((shift = !shift), drawKeys());
    else if (b.dataset.digits !== undefined) ((digits = !digits), drawKeys());
    else if (b.dataset.save !== undefined) save();
  });
  drawKeys();
  overlayRoot.appendChild(o);
  faceFront(o.querySelector(".panel"));
}

// ---------- remote invites (phase 1c) ----------
async function openInvite(watch = false) {
  const title = watch ? "Invite a watcher" : "Invite a remote player";
  const o = document.createElement("div");
  o.className = "overlay";
  o.innerHTML = `<div class="panel"><h2>${title}</h2><div class="muted">Creating an invite…</div></div>`;
  faceFront(o.querySelector(".panel"));
  overlayRoot.appendChild(o);
  const close = () => (unsub?.(), o.remove());
  let unsub = null;
  o.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (e.target === o || b?.dataset.x === "close") return close();
    if (b?.dataset.x === "another") return (close(), openInvite(watch));
  });
  o.addEventListener("change", (e) => {
    if (e.target.name === "control") act("POST", "/remote", { boardControl: e.target.checked });
    // Watch only (D-168): a new invite of the other kind; the one shown stays valid until it expires.
    if (e.target.name === "watch") (close(), openInvite(e.target.checked));
  });
  let inv;
  try {
    inv = await api("POST", "/invites", { watch });
  } catch {
    return close();
  }
  let qr = "";
  try {
    const r = await fetch(`/api/v1/qr?text=${encodeURIComponent(inv.url)}`, { headers: { "x-table-key": KEY } });
    if (r.ok) qr = await r.text();
  } catch {}
  const until = new Date(inv.expiresAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  // An optional name for the player (D-155): it travels in the link (?name=) and fills in their name field, which they
  // can still change. Cut to MAX_NAME characters like every name (D-148).
  let guest = "";
  const link = () => {
    const u = new URL(inv.url);
    if (guest) u.searchParams.set("name", guest);
    return u.toString();
  };
  const loadQr = async () => {
    try {
      const r = await fetch(`/api/v1/qr?text=${encodeURIComponent(link())}`, { headers: { "x-table-key": KEY } });
      if (r.ok) qr = await r.text();
    } catch {}
  };
  o.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b?.dataset.x === "name") openNamePad(guest, async (n) => ((guest = n), await loadQr(), draw()));
    if (b?.dataset.x === "noname") (async () => ((guest = ""), await loadQr(), draw()))();
  });
  const draw = () => {
    const r = state.remote ?? { boardControl: true };
    // The invited player has joined (D-164): the link is used up, so the dialog closes by itself.
    const joined = r.joined?.find((j) => j.invite === inv.token);
    if (joined) {
      if (namePad) namePad.remove(), (namePad = null);
      close();
      return toast(watch ? `${joined.name} is watching` : `${joined.name} joined through the invite`);
    }
    o.innerHTML = `<div class="panel invite"><h2>${title}</h2>
      <div class="muted">Send this link by email or chat. It works once, for one ${watch ? "watcher" : "player"}, until ${esc(until)}.${watch ? " A watcher sees the board, takes no seat and has no deck." : ""}</div>
      <label class="invite-control invite-watch"><input type="checkbox" name="watch" ${watch ? "checked" : ""}> Watch only: the board, without a seat</label>
      <div class="invite-name"><span>${watch ? "Watcher's" : "Player's"} name <span class="faint">(optional, they can change it)</span></span>
        <button data-x="name" class="name-value ${guest ? "" : "empty"}">${guest ? esc(guest) : "Add a name…"}</button>
        ${guest ? `<button data-x="noname" aria-label="Remove the name">✕</button>` : ""}</div>
      <div class="invite-body"><div class="qr">${qr}</div>
        <div>${linkLine(link())}<div class="code">${esc(inv.token)}</div>
        <div class="faint" style="margin-top:10px">${remotePlaces().used} of ${remotePlaces().max} remote places in use (players and watchers)</div></div></div>
      ${watch ? "" : `<label class="invite-control"><input type="checkbox" name="control" ${r.boardControl ? "checked" : ""}>
        Remote players can use the board controls (pick games, start, end)</label>`}
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
/** Called after the game's board got a new view (the settings window, D-215). */
const gameViewListeners = new Set();
function onGameView(fn) {
  gameViewListeners.add(fn);
  return () => gameViewListeners.delete(fn);
}

async function refreshGames() {
  games = await api("GET", "/games").catch(() => games);
}

// Requests on the socket that expect an answer (a board intent, D-102): seq -> resolve.
let ws = null;
let wsSeq = 0;
const wsPending = new Map();
function wsSend(ch, type, payload) {
  if (ws?.readyState !== 1) return Promise.resolve({ ok: false, reason: "not connected to the table" });
  const seq = ++wsSeq;
  ws.send(JSON.stringify({ v: 1, ch, type, seq, payload }));
  return new Promise((resolve) => {
    wsPending.set(seq, resolve);
    setTimeout(() => wsPending.delete(seq) && resolve({ ok: false, reason: "no answer from the table" }), 5000);
  });
}

// ---------- one board window at the table (D-132) ----------
// This tab's id, kept across reloads (sessionStorage), so a reload or a dropped connection gets the board back at once.
const TAB = (() => {
  try {
    let t = sessionStorage.getItem("gametable.board.tab");
    if (!t) sessionStorage.setItem("gametable.board.tab", (t = Math.random().toString(36).slice(2, 12)));
    return t;
  } catch {
    return "";
  }
})();
let elsewhere = null; // why this window does not show the table: "elsewhere" (another window has it) or "replaced"
// Opened with the board's link for another screen (D-190): this screen takes the board over at once.
let takeover = location.hash === "#screen";
if (takeover) history.replaceState(null, "", location.pathname + location.search);
const elsewhereLayer = document.createElement("div");
elsewhereLayer.id = "elsewhere-layer";
elsewhereLayer.hidden = true;
document.body.appendChild(elsewhereLayer);
function renderElsewhere(why, info = {}) {
  elsewhere = why;
  elsewhereLayer.hidden = !why;
  if (!why) return void (elsewhereLayer.innerHTML = "");
  const playing = info.phase === "active" || info.phase === "paused";
  // Where it went (D-190): another screen on the network, or back to the table's own computer.
  const screen = why === "replaced" && info.from && !info.local;
  const home = why === "replaced" && info.local && !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const title = screen ? "The board moved to another screen" : home ? "The board moved back to the table's computer" : why === "replaced" ? "The board moved to another window" : "The board is open in another window";
  const text =
    screen
      ? `It shows on the screen at ${esc(info.from)} now, opened with the board's link. Only one screen shows the board at a time, so that a game is never shown twice.`
      : why === "replaced"
      ? "Another window took over the table. Only one window shows the board, so that a game is never shown twice."
      : playing
        ? `A game${info.game ? ` of ${esc(info.game)}` : ""} is running there. Only one window shows the board at a time.`
        : "Only one window shows the board at a time.";
  elsewhereLayer.innerHTML = `<div class="panel"><h2>${title}</h2><p>${text}</p><div class="row">
    <button class="primary" type="button" data-elsewhere="here">Show the board here</button>
    <button type="button" data-elsewhere="leave">${why === "replaced" ? "Leave it there" : "Keep the other window"}</button></div>
    <p class="note" hidden>You can close this window.</p></div>`;
}
elsewhereLayer.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-elsewhere]");
  if (!b) return;
  if (b.dataset.elsewhere === "leave") {
    elsewhereLayer.querySelector(".row").hidden = true;
    elsewhereLayer.querySelector(".note").hidden = false;
    window.close(); // works only for windows a script opened; otherwise the note stays
    return;
  }
  takeover = true;
  renderElsewhere(null);
  if (ws && ws.readyState <= 1) ws.close();
  else connect();
});

/**
 * Tell the table when this board has shown game message `seq` (D-141): its game's whenIdle (D-134), or at once for a
 * game without one or while none is shown. AI players wait for it, so the board never falls behind the game.
 * Remote boards don't pace the game.
 */
let idleToken = 0;
function reportIdle(seq) {
  if (REMOTE || !seq) return;
  const token = ++idleToken;
  let idle;
  try {
    idle = game?.inst && typeof game.inst.whenIdle === "function" ? Promise.resolve(game.inst.whenIdle()) : Promise.resolve();
  } catch {
    idle = Promise.resolve();
  }
  idle.catch(() => {}).then(() => {
    if (token === idleToken && ws?.readyState === 1) ws.send(JSON.stringify({ v: 1, ch: "game", type: "idle", payload: { seq } }));
  });
}

/** A message to the invite page that holds this remote board (same origin), D-168. */
let lastTold = "";
function tellPage(msg) {
  const k = JSON.stringify(msg);
  if (k === lastTold || window.parent === window) return;
  lastTold = k;
  try {
    window.parent.postMessage(msg, location.origin);
  } catch {}
}

function connect() {
  ws = openTableSocket(REMOTE);
  ws.onopen = () => {
    // A remote board names its browser's person (from the invite page), for the watchers list (D-168).
    const hello = REMOTE ? { role: "board", name: new URLSearchParams(location.search).get("name") ?? "" } : { role: "board", key: KEY, tab: TAB, ...(takeover ? { takeover: true } : {}) };
    takeover = false;
    ws.send(JSON.stringify({ v: 1, ch: "system", type: "hello", payload: hello }));
  };
  ws.onmessage = async (ev) => {
    const m = JSON.parse(ev.data);
    // A removed watcher (D-168): the invite page closes the connection and says so.
    if (REMOTE && m.ch === "system" && m.type === "removed") {
      elsewhere = "removed";
      tellPage({ type: "gt-removed", message: m.payload?.message ?? "" });
      return;
    }
    if (m.ch === "system" && (m.type === "elsewhere" || m.type === "replaced")) {
      renderElsewhere(m.type, m.payload ?? {});
      if (m.type === "elsewhere") ws.close();
      return;
    }
    const answer = m.ch === "system" && m.seq !== undefined && wsPending.get(m.seq);
    if (answer) {
      wsPending.delete(m.seq);
      answer(m.type === "ack" ? { ok: true } : { ok: false, reason: m.payload?.reason ?? m.payload?.message });
      return;
    }
    if (m.ch === "lobby" && m.type === "state") {
      state = m.payload;
      if (selectedPlayer && !state.players.some((p) => p.id === selectedPlayer)) selectedPlayer = null;
      // The games list serves only the lobby and its dialogs: skip it while a game runs.
      if (state.phase !== "active" && state.phase !== "paused" && state.phase !== "terminating") await refreshGames();
      render();
      showSoundHint();
      stateListeners.forEach((f) => f());
      // The invite page shows the deck only to a player or to one let in to play; else it is a watcher's (D-168).
      if (REMOTE) tellPage({ type: "gt-seat", mayJoin: state.remote?.mayJoin !== false, watching: !!state.remote?.watching });
      // Play from the board (D-175): the board moves into the page that shows the deck beside it, and back when it is
      // switched off (that page listens).
      else if (IN_PLAY) tellPage({ type: "gt-board-deck", on: !!state.developer?.boardDeck });
      else if (state.developer?.boardDeck && window.parent === window) location.replace("/board/play.html");
    } else if (m.ch === "game" && m.type === "gesture") {
      // A phone's live sling gesture (D-189), for the game's board to show at once.
      game?.inst?.gesture?.(m.payload.seat, m.payload.data);
    } else if (m.ch === "game" && m.type === "board") {
      gameMsg = { ...m.payload, receivedAt: Date.now() };
      if (game?.inst && state) game.inst.update(gameMsg.view, gameMsg.events ?? [], gameInfo());
      else if (state && inRunningGame()) showGame();
      for (const fn of gameViewListeners) fn();
      reportIdle(gameMsg.seq);
    }
  };
  ws.onclose = () => {
    for (const r of wsPending.values()) r({ ok: false, reason: "connection lost" });
    wsPending.clear();
    // A window without the table waits for "Show the board here"; that button reconnects (D-132).
    if (!elsewhere) setTimeout(connect, takeover ? 0 : 1000);
  };
}
connect();
