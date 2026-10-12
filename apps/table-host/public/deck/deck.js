// Deck UI: join with a name, lobby with Ready, and the game's own private deck view.
// A game package may ship deck.js exporting mount(root, ctx) -> { update(view, events, info), destroy() }.
import { esc } from "/shared/board-kit.js";

const app = document.getElementById("app");
const SESSION_KEY = `gametable.session.${location.host}`;
const params = new URLSearchParams(location.search);
const joinToken = params.get("t");

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
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
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
        if (m.payload.sessionToken) storage.set(m.payload.sessionToken);
        retry = 0;
        banner = "";
        if (joinToken) history.replaceState(null, "", "/deck/"); // the join code is single-use
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
  top.innerHTML = `${banner ? `<div class="banner">${esc(banner)}</div>` : ""}
    <div><div class="eyebrow">${esc(state.tableName)}${inGame ? ` · ${esc(state.game?.name)}` : ""}</div><h1>${esc(p?.name ?? "")}</h1></div>
    ${inGame ? "" : `<div class="card seatcard"><div class="badge">${p?.seat == null ? "–" : p.seat + 1}</div>
      <div>${p?.seat == null ? `<div>No seat yet</div><div class="muted" style="font-size:.85em">You'll get one when a seat opens.</div>`
        : `<div>Seat ${p.seat + 1}</div><div class="muted" style="font-size:.85em">${esc(state.seatEdges[p.seat])} side of the board</div>`}</div></div>`}`;
}

function render() {
  if (removed) {
    closeGame();
    top.innerHTML = "";
    body.innerHTML = `<div class="card center"><h1>You left the table</h1><p class="muted">Scan the QR code on the board to join again.</p></div>`;
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
    .map((x) => `<div class="row"><span class="${x.id === me ? "me" : ""}">${esc(x.name)}${x.kind === "ai" ? " · AI" : ""}</span>
      <span class="muted">${x.seat == null ? "no seat" : `seat ${x.seat + 1}`}${state.phase === "ready" && x.kind === "human" ? (x.ready ? " · ready" : "") : ""}${x.connected ? "" : " · away"}</span></div>`)
    .join("");
  let action = `<div class="card muted">Choose a game on the board.</div>`;
  if (state.phase === "ready" && state.game) {
    action = p?.seat == null
      ? `<div class="card muted">${esc(state.game.name)} is about to start. You're not seated for this one.</div>`
      : `<div class="card"><div class="eyebrow">Up next</div><div class="display" style="font-size:1.5em;margin:4px 0 14px">${esc(state.game.name)}</div>
         <button class="${p.ready ? "" : "primary"} big" id="ready">${p.ready ? "Not ready" : "I'm ready"}</button></div>`;
  } else if (state.phase === "finished" && state.summary) {
    action = `<div class="card"><div class="eyebrow">Result</div><div class="display" style="font-size:1.3em;margin-top:6px">${esc(state.summary.text)}</div></div>`;
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
      send: (name, payload) => send("game", "intent", { name, payload }),
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
