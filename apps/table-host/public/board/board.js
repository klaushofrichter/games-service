// Board UI: lobby, seats around the edge, QR join, game surface and the lobby overlay.
// Talks to the Table Host through the board control API (same API the tests and local AI agents use).
import { ROT, W, H, esc, seatPositions } from "/shared/board-kit.js";

const KEY = window.TABLE_KEY;
const surface = document.getElementById("surface");
const seatsEl = document.getElementById("seats");
const center = document.getElementById("center");
const lobbyBtn = document.getElementById("lobby-button");
const overlayRoot = document.getElementById("overlay-root");
const gameLayer = document.getElementById("game-layer");

let state = null;
let games = [];
let gameMsg = null; // last game.board message
let selectedPlayer = null;

// ---------- API ----------
async function api(method, path, body) {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: { "x-table-key": KEY, ...(body ? { "content-type": "application/json" } : {}) },
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
  if (state) el.style.transform = `rotate(${ROT[state.frontEdge]}deg)`;
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

// ---------- scaling ----------
function fit() {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  surface.style.transform = `scale(${s})`;
}
window.addEventListener("resize", fit);
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
        : state.phase === "ready" && pl.kind === "human"
          ? `<span class="dot"></span>${pl.ready ? "Ready" : "Not ready"}`
          : pl.kind === "ai" ? "AI player" : pl.location === "remote" ? "Remote" : "";
    el.innerHTML = `<div class="num">Seat ${seat + 1} · ${p.edge}</div>
      <div class="name">${pl ? esc(pl.name) : "—"}</div><div class="status">${status}</div>`;
    if (!playing) el.addEventListener("click", () => onSeatTap(seat, pl));
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

// ---------- center panel ----------
function render() {
  if (!state) return;
  renderSeats();
  const front = state.frontEdge;
  center.style.transform = `rotate(${ROT[front]}deg)`;
  center.classList.toggle("sideways", front === "east" || front === "west");

  const playing = state.phase === "active" || state.phase === "paused" || state.phase === "terminating";
  lobbyBtn.hidden = !playing;
  lobbyBtn.className = state.game?.lobbyButton ?? "bottom-right";

  seatsEl.hidden = playing;
  center.hidden = playing;
  gameLayer.hidden = !playing;
  if (playing) return void showGame();
  closeGame();
  if (state.phase === "finished") return renderFinished();
  if (state.phase === "ready") return renderReady();
  renderLobby();
}

function cloudNotice() {
  const c = state.cloud;
  if (c.status === "pending") return `<div class="cloud">Waiting for an admin to approve this table · pairing code <b>${esc(c.pairingCode)}</b></div>`;
  if (c.status === "offline") return `<div class="cloud">The table is offline · new games start when the connection returns</div>`;
  if (c.status === "revoked") return `<div class="cloud">This table was disconnected by an admin</div>`;
  return "";
}

function joinPanel() {
  const code = state.joinUrl.split("/").pop();
  return `<aside class="join">
    <div class="eyebrow">Scan to join</div>
    <img src="/qr.svg?u=${encodeURIComponent(state.joinUrl)}" alt="QR code to join this table">
    <div><div class="url">${esc(state.joinUrl)}</div><div class="code" style="text-align:center;margin-top:6px">${esc(code)}</div></div>
  </aside>`;
}

function toolbar() {
  const sel = state.players.find((p) => p.id === selectedPlayer);
  return `<div class="toolbar">
    <span class="seg">${[2, 4, 6, 8].map((n) => `<button data-layout="${n}" class="${state.layout === n ? "on" : ""}">${n}</button>`).join("")}</span>
    <button data-rotate="90">⟳ 90°</button>
    <button data-rotate="180">⟳ 180°</button>
    <button data-add-ai>+ AI player</button>
    ${sel ? `<button class="danger" data-remove="${sel.id}">Remove ${esc(sel.name)}</button>` : ""}
    <span class="spacer"></span>
    <button data-sim>Simulation…</button>
  </div>`;
}

function renderLobby() {
  const humans = state.players.filter((p) => p.kind === "human").length;
  center.innerHTML = `<section class="main">
      <div class="eyebrow">${esc(state.tableName)}</div>
      ${cloudNotice()}<h1>Pick a game</h1>
      <div class="sub">${humans ? `${humans} at the table · tap a seat, then another to move a player` : "Scan the code to take a seat"}</div>
      <div class="games">${games
        .map((g) => `<button class="tile ${g.selectable ? "selectable" : ""}" data-game="${g.id}" ${g.selectable ? "" : "disabled"}>
          <span class="title">${esc(g.name)}</span><span class="desc">${esc(g.description ?? "")}</span>
          <span class="faint" style="font-size:.66em">${playersLabel(g.players)}${g.ai ? " · AI" : ""}</span>
          ${g.selectable ? "" : `<span class="why">${esc(g.reasons[0])}</span>`}</button>`)
        .join("")}</div>
      ${toolbar()}
    </section>${joinPanel()}`;
}

function playersLabel(p) {
  if (p.length === 1) return `${p[0]} players`;
  const contiguous = p.every((n, i) => i === 0 || n === p[i - 1] + 1);
  return contiguous ? `${p[0]}–${p.at(-1)} players` : `${p.join(", ")} players`;
}

function renderReady() {
  const humans = state.players.filter((p) => p.kind === "human" && p.seat !== null);
  const all = humans.length > 0 && humans.every((p) => p.ready && p.connected);
  center.innerHTML = `<section class="main waiting">
      <div><div class="eyebrow">Up next</div><h1>${esc(state.game.name)}</h1>
      <div class="sub">Everyone taps <b>Ready</b> on their phone.</div></div>
      <div class="ready-list">${humans.map((p) => `<span class="chip ${p.ready ? "ok" : ""}"><span class="dot" style="background:${p.ready ? "var(--jade)" : ""}"></span>${esc(p.name)}</span>`).join("")}</div>
      <div class="toolbar"><button class="primary" data-start ${all ? "" : "disabled"}>Start game</button><button data-close>Change game</button>
      <span class="spacer"></span><button data-rotate="180">⟳ 180°</button></div>
    </section>${joinPanel()}`;
}

function renderFinished() {
  const s = state.summary;
  center.innerHTML = `<section class="main">
      <div class="summary"><div class="eyebrow">${esc(state.game?.name ?? "Game")} · finished</div>
      <div class="big">${esc(s?.text ?? "Game over")}</div>
      <div class="toolbar"><button class="primary" data-again>Play again</button><button data-close>Back to lobby</button></div></div>
    </section>${joinPanel()}`;
}

// ---------- game surface: the game's own board.js ----------
// A game package may ship board.js exporting mount(root, ctx) -> { update(view, events, info), destroy() }.
let game = null; // { key, inst, loading }

function gameInfo() {
  return {
    players: state.players,
    seatEdges: state.seatEdges,
    seatPositions: seatPositions(state.seatEdges),
    frontEdge: state.frontEdge,
    rotation: ROT[state.frontEdge],
    settings: state.game?.settings ?? {},
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
  if (d.game) act("POST", "/game/select", { gameId: d.game });
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
});

lobbyBtn.addEventListener("click", openLobbyOverlay);

function openLobbyOverlay() {
  const o = document.createElement("div");
  o.className = "overlay";
  const draw = () => {
    o.innerHTML = `<div class="panel"><h2>Lobby</h2>
      <div class="group"><div class="eyebrow">Players</div>${state.players
        .map((p) => `<div class="row"><span>${esc(p.name)} <span class="faint">· ${p.seat === null ? "no seat" : `seat ${p.seat + 1}`}${p.kind === "ai" ? " · AI" : ""}${p.connected ? "" : " · reconnecting"}</span></span>
          <button class="danger" data-remove="${p.id}">Remove</button></div>`)
        .join("") || `<div class="faint">Nobody yet</div>`}</div>
      <div class="group"><div class="eyebrow">View</div><div class="row"><span>Turn the board for players on another edge</span>
        <span><button data-rotate="90">⟳ 90°</button> <button data-rotate="180">⟳ 180°</button></span></div></div>
      <div class="group"><div class="row"><span class="faint">Invite remote players — coming in phase 1c</span><button disabled>Invite</button></div>
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
    if (b.dataset.rotate) act("POST", "/rotate", { degrees: Number(b.dataset.rotate) });
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
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onopen = () => ws.send(JSON.stringify({ v: 1, ch: "system", type: "hello", payload: { role: "board", key: KEY } }));
  ws.onmessage = async (ev) => {
    const m = JSON.parse(ev.data);
    if (m.ch === "lobby" && m.type === "state") {
      state = m.payload;
      if (selectedPlayer && !state.players.some((p) => p.id === selectedPlayer)) selectedPlayer = null;
      await refreshGames();
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
