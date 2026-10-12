// Deck UI: join with a name, lobby with Ready, and the private seat view during a game.
const app = document.getElementById("app");
const SESSION_KEY = `gametable.session.${location.host}`;
const params = new URLSearchParams(location.search);
const joinToken = params.get("t");

let ws = null;
let me = null; // playerId
let state = null;
let game = null; // { seat, view }
let banner = "";
let removed = false;
let seq = 0;
let retry = 0;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const storage = {
  get: () => { try { return localStorage.getItem(SESSION_KEY); } catch { return null; } },
  set: (v) => { try { localStorage.setItem(SESSION_KEY, v); } catch {} },
  clear: () => { try { localStorage.removeItem(SESSION_KEY); } catch {} },
};

function send(ch, type, payload) {
  if (ws?.readyState === 1) ws.send(JSON.stringify({ v: 1, ch, type, seq: ++seq, payload }));
}

function connect(hello) {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onopen = () => send("system", "hello", hello);
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.ch === "system" && m.type === "welcome") {
      me = m.payload.playerId;
      if (m.payload.sessionToken) storage.set(m.payload.sessionToken);
      retry = 0;
      banner = "";
      if (joinToken) history.replaceState(null, "", "/deck/"); // the join code is single-use
    } else if (m.ch === "system" && m.type === "removed") {
      removed = true;
      storage.clear();
    } else if (m.ch === "system" && (m.type === "error" || m.type === "reject")) {
      const msg = m.payload.message ?? m.payload.reason;
      if (m.payload.status === 403) {
        storage.clear();
        me = null;
        banner = msg;
        render();
        return;
      }
      banner = msg;
      setTimeout(() => ((banner = ""), render()), 3000);
    } else if (m.ch === "lobby" && m.type === "state") {
      state = m.payload;
      if (state.phase !== "active" && state.phase !== "paused") game = null;
    } else if (m.ch === "game" && m.type === "view") {
      game = m.payload;
      if (navigator.vibrate && isMyTurn()) navigator.vibrate(60);
    }
    render();
  };
  ws.onclose = (ev) => {
    if (removed || ev.code === 4003) return render();
    const token = storage.get();
    if (!token) return render();
    banner = "Reconnecting…";
    render();
    setTimeout(() => connect({ sessionToken: token }), Math.min(5000, 500 * 2 ** retry++));
  };
}

function isMyTurn() {
  return game?.view?.myTurn === true;
}

// ---------- screens ----------

function render() {
  if (removed) {
    app.innerHTML = `<div class="card center"><h1>You left the table</h1><p class="muted">Scan the QR code on the board to join again.</p></div>`;
    return;
  }
  if (!me) return renderJoin();
  if (!state) return (app.innerHTML = `<p class="muted center">Connecting…</p>`);
  const self = state.players.find((p) => p.id === me);
  const top = `${banner ? `<div class="banner">${esc(banner)}</div>` : ""}
    <div><div class="eyebrow">${esc(state.tableName)}</div><h1>${esc(self?.name ?? "")}</h1></div>
    <div class="card seatcard"><div class="badge">${self?.seat == null ? "–" : self.seat + 1}</div>
      <div>${self?.seat == null ? `<div>No seat yet</div><div class="muted" style="font-size:.85em">You'll get one when a seat opens.</div>`
        : `<div>Seat ${self.seat + 1}</div><div class="muted" style="font-size:.85em">${esc(state.seatEdges[self.seat])} side of the board</div>`}</div></div>`;

  if ((state.phase === "active" || state.phase === "paused") && game) return (app.innerHTML = top + renderGame());
  if (state.phase === "active") return (app.innerHTML = top + `<div class="card muted">A game is running. You can play from the next game${state.game ? ` of ${esc(state.game.name)}` : ""}.</div>`);
  app.innerHTML = top + renderLobby(self);
}

function renderJoin() {
  const saved = storage.get();
  if (saved && !ws) {
    connect({ sessionToken: saved });
    app.innerHTML = `<p class="muted center">Reconnecting…</p>`;
    return;
  }
  if (!joinToken) {
    app.innerHTML = `${banner ? `<div class="banner">${esc(banner)}</div>` : ""}<div class="card center"><h1>Join the table</h1><p class="muted">Scan the QR code on the board, or type the address shown below it.</p></div>`;
    return;
  }
  app.innerHTML = `${banner ? `<div class="banner">${esc(banner)}</div>` : ""}
    <div><div class="eyebrow">Game Table</div><h1>What should we call you?</h1></div>
    <form id="join" class="card" style="display:flex;flex-direction:column;gap:14px">
      <input type="text" name="name" maxlength="24" autocomplete="nickname" placeholder="Your name" autofocus>
      <button class="primary big" type="submit">Take a seat</button>
      <div class="faint" style="font-size:.8em">No account needed. Any name works.</div>
    </form>`;
  app.querySelector("#join").addEventListener("submit", (e) => {
    e.preventDefault();
    banner = "";
    connect({ joinToken, name: new FormData(e.target).get("name") });
  });
}

function renderLobby(self) {
  const players = state.players
    .map((p) => `<div class="row"><span class="${p.id === me ? "me" : ""}">${esc(p.name)}${p.kind === "ai" ? " · AI" : ""}</span>
      <span class="muted">${p.seat == null ? "no seat" : `seat ${p.seat + 1}`}${state.phase === "ready" && p.kind === "human" ? (p.ready ? " · ready" : "") : ""}${p.connected ? "" : " · away"}</span></div>`)
    .join("");
  let action = `<div class="card muted">Choose a game on the board.</div>`;
  if (state.phase === "ready" && state.game) {
    action = self?.seat == null
      ? `<div class="card muted">${esc(state.game.name)} is about to start. You're not seated for this one.</div>`
      : `<div class="card"><div class="eyebrow">Up next</div><div class="display" style="font-size:1.5em;margin:4px 0 14px">${esc(state.game.name)}</div>
         <button class="${self.ready ? "" : "primary"} big" id="ready">${self.ready ? "Not ready" : "I'm ready"}</button></div>`;
  } else if (state.phase === "finished" && state.summary) {
    action = `<div class="card"><div class="eyebrow">Result</div><div class="display" style="font-size:1.3em;margin-top:6px">${esc(state.summary.text)}</div></div>`;
  }
  queueMicrotask(() => app.querySelector("#ready")?.addEventListener("click", () => send("lobby", "ready", { ready: !self.ready })));
  return `${action}<div class="card list"><div class="eyebrow" style="margin-bottom:6px">At the table</div>${players}</div>`;
}

// Phase 1a stub games get small built-in deck views; real games ship their own deck UI.
function renderGame() {
  const v = game.view;
  const id = state.game?.id;
  if (id === "coin-flip") {
    queueMicrotask(() =>
      app.querySelectorAll("[data-guess]").forEach((b) => b.addEventListener("click", () => send("game", "intent", { name: "guess", payload: b.dataset.guess }))),
    );
    return `<div class="card"><div class="stat"><span class="eyebrow">Round ${v.round} of ${v.rounds}</span><span class="n">${v.myScore}</span></div>
      <div class="muted" style="font-size:.85em">${v.lastFlip ? `Last flip: ${esc(v.lastFlip)}` : "Guess the first flip"}</div></div>
      <div class="choices">${["heads", "tails"].map((g) => `<button data-guess="${g}" class="${v.myGuess === g ? "picked" : ""}" ${v.myGuess || v.done ? "disabled" : ""}>${g[0].toUpperCase() + g.slice(1)}</button>`).join("")}</div>
      <div class="muted center">${v.myGuess ? "Waiting for the others…" : "Your call"}</div>`;
  }
  if (id === "quartet") {
    queueMicrotask(() => app.querySelector("[data-pass]")?.addEventListener("click", () => send("game", "intent", { name: "pass" })));
    return `<div class="card"><div class="stat"><span class="eyebrow">Passes</span><span class="n">${v.passes}/${v.total}</span></div></div>
      <button class="primary big" data-pass ${v.myTurn ? "" : "disabled"}>${v.myTurn ? "Pass the token" : "Wait for your turn"}</button>`;
  }
  return `<div class="card"><pre>${esc(JSON.stringify(v, null, 2))}</pre></div>`;
}

render();
