// Board kit: helpers shared by the board page and by games' own board.js / deck.js.
// Games import it as `/shared/board-kit.js`.

export const W = 1920;
export const H = 1080;

/** Rotation that makes content readable from an edge (bottom of the text faces that edge). */
export const ROT = { south: 0, west: 90, north: 180, east: -90 };

/** One color per seat, distinct on the dark felt and for common color-vision deficiencies. */
export const SEAT_COLORS = ["#e8b04a", "#5fb7e8", "#e8735f", "#7fd18b", "#c38be8", "#dde3ea", "#5fe0c8", "#e88fbf"];
export const seatColor = (seat) => SEAT_COLORS[seat % SEAT_COLORS.length];

/**
 * Copy text to the clipboard (D-094). The clipboard API needs a secure context (https, localhost); a board opened
 * over plain http on the LAN falls back to the older copy command. Resolves true when it worked.
 */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {}
  ta.remove();
  return ok;
}

// ---------- sound effects (D-092) ----------
// One shared AudioContext for the page. Browsers start it suspended until the page has been touched; the board
// resumes it on the first touch (the table PC's kiosk browser allows sound from the start).
let actx = null;
export function audio() {
  try {
    actx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume().catch(() => {});
    return actx;
  } catch {
    return null;
  }
}

/**
 * Play a game's sound effect if the table has sound on (`info.sound`). `make(ctx, t0)` schedules the Web Audio
 * nodes for it, starting at time t0; output goes through one gain node so effects share a sensible volume.
 */
export function playSound(info, name, make) {
  if (info?.sound === false) return;
  const ctx = audio();
  if (!ctx || ctx.state !== "running") return;
  const out = ctx.createGain();
  out.gain.value = 0.5;
  out.connect(ctx.destination);
  try {
    make(ctx, ctx.currentTime + 0.01, out);
    (window.gameTableSounds ??= []).push(name); // what played, for the browser tests
    if (window.gameTableSounds.length > 50) window.gameTableSounds.shift();
  } catch {}
}

/** A short struck-metal tone (a few decaying partials): the building block for coin, bell and chip sounds. */
export function ping(ctx, out, t, { freq = 2600, partials = [1, 1.58, 2.27], decay = 0.25, gain = 0.3 } = {}) {
  for (const [k, ratio] of partials.entries()) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq * ratio;
    g.gain.setValueAtTime(gain / (k + 1), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay / (1 + k * 0.4));
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + decay + 0.05);
  }
}

/**
 * A player's colour (D-106): the table gives every seated player one (`player.color` in the lobby state), chosen in
 * the board's settings or else their seat's, the same in the lobby and in every game. Boards and decks both use this,
 * so they always agree. A seat nobody sits in gets the seat's colour.
 */
export function playerColor(info, seat) {
  const c = info?.players?.find((p) => p.seat === seat)?.color;
  return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : seatColor(seat);
}

/** Relative luminance of a #rrggbb colour (WCAG 2). */
function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/** WCAG contrast ratio of two #rrggbb colours (1 to 21). */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** The text colour for a background: near-black or white, whichever reads better on it (D-101). */
export const INK_DARK = "#1b1407";
export const INK_LIGHT = "#ffffff";
export function inkOn(bg) {
  return contrast(bg, INK_DARK) >= contrast(bg, INK_LIGHT) ? INK_DARK : INK_LIGHT;
}

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Seat centers on the 1920 × 1080 surface, with the rotation that faces the seat's edge. */
export function seatPositions(edges) {
  const byEdge = {};
  edges.forEach((e, i) => (byEdge[e] ??= []).push(i));
  const pos = [];
  for (const [edge, list] of Object.entries(byEdge)) {
    list.forEach((seat, k) => {
      const n = list.length;
      if (edge === "south" || edge === "north") {
        const span = 1300;
        const x0 = (W - span) / 2;
        let x = x0 + (span * (k + 0.5)) / n;
        if (edge === "north") x = W - x; // left to right as seen from that edge
        pos[seat] = { x, y: edge === "south" ? H - 92 : 92, rot: ROT[edge], edge };
      } else {
        pos[seat] = { x: edge === "east" ? W - 92 : 92, y: H / 2, rot: ROT[edge], edge };
      }
    });
  }
  return pos;
}

/**
 * A seat's compass name (D-087): "south", "southwest", "northeast"… Seat numbers are not shown to players.
 * One seat on an edge is that edge; two are its west and east halves (north and south) or north and south
 * halves (east and west); three add the plain edge in the middle. Unique for every layout.
 */
export function seatName(edges, seat) {
  const edge = edges?.[seat];
  if (!edge) return "";
  const mine = edges.map((e, i) => (e === edge ? i : -1)).filter((i) => i >= 0);
  if (mine.length < 2) return edge;
  // Order along the edge from the west (or north) end, using the positions seatPositions gives.
  const pos = seatPositions(edges);
  const along = (i) => (edge === "south" || edge === "north" ? pos[i].x : pos[i].y);
  const order = [...mine].sort((a, b) => along(a) - along(b));
  const ends = edge === "south" || edge === "north" ? ["west", "east"] : ["north", "south"];
  const k = order.indexOf(seat);
  const part = k === 0 ? ends[0] : k === order.length - 1 ? ends[1] : "";
  if (!part) return edge;
  return edge === "south" || edge === "north" ? `${edge}${part}` : `${part}${edge}`;
}

/** The same, capitalised, for a heading: "Southwest seat". */
export const seatTitle = (edges, seat) => {
  const n = seatName(edges, seat);
  return n ? `${n[0].toUpperCase()}${n.slice(1)} seat` : "";
};

/** Create an element from an HTML string. */
export function html(markup) {
  const t = document.createElement("template");
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

/** Create an SVG element with attributes. */
export function svg(tag, attrs = {}, parent) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (parent) parent.appendChild(el);
  return el;
}

/**
 * Countdown for a host timer. `info.timers[id]` is the deadline in host time and `info.now` the host
 * clock when the message was sent, so device clock skew does not matter.
 */
export function remainingMs(info, id) {
  const deadline = info?.timers?.[id];
  if (!deadline) return null;
  const elapsed = Date.now() - (info.receivedAt ?? Date.now());
  return Math.max(0, deadline - info.now - elapsed);
}

/**
 * Standard player plates at each seat, rotated to face their edge. `extra(seat, player)` may return
 * HTML for a second line (score, balance, cards left). Returns the container for re-use.
 */
export function seatPlates(layer, info, extra = () => "", opts = {}) {
  let box = layer.querySelector(":scope > .kit-plates");
  if (!box) {
    box = html(`<div class="kit-plates"></div>`);
    layer.appendChild(box);
  }
  const pos = info.seatPositions;
  box.innerHTML = info.players
    .filter((p) => p.seat !== null && pos[p.seat])
    .map((p) => {
      const at = pos[p.seat];
      const active = opts.active === p.seat;
      return `<div class="kit-plate ${active ? "active" : ""} ${p.connected ? "" : "away"}" style="left:${at.x}px;top:${at.y}px;transform:translate(-50%,-50%) rotate(${at.rot}deg);--seat:${playerColor(info, p.seat)}">
        <div class="kit-name"><span class="kit-dot" aria-hidden="true"></span>${esc(p.name)}</div>
        <div class="kit-extra">${p.connected ? extra(p.seat, p) : "Reconnecting…"}</div></div>`;
    })
    .join("");
  return box;
}

/** Inject a stylesheet once (games call this for their own CSS file). */
export function useStyles(href) {
  if (document.querySelector(`link[data-kit="${href}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = href;
  l.dataset.kit = href;
  document.head.appendChild(l);
}

/**
 * Remote play: tell the invite page's service worker which page this frame belongs to (it forgets when
 * restarted). Used by the board and deck pages.
 */
export function claimServiceWorkerPage() {
  if (!navigator.serviceWorker) return;
  const own = () => navigator.serviceWorker.controller?.postMessage({ type: "gt-own", page: new URLSearchParams(location.search).get("gtp") });
  own();
  setInterval(own, 10000);
}

/** The table's live socket; a remote page uses the one its invite page carries over the WebRTC channel. */
export function openTableSocket(remote) {
  return remote && window.parent !== window && window.parent.gameTableSocket
    ? window.parent.gameTableSocket()
    : new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
}
