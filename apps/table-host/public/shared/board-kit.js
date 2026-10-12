// Board kit: helpers shared by the board page and by games' own board.js / deck.js.
// Games import it as `/shared/board-kit.js`.

export const W = 1920;
export const H = 1080;

/** Rotation that makes content readable from an edge (bottom of the text faces that edge). */
export const ROT = { south: 0, west: 90, north: 180, east: -90 };

/** One color per seat, distinct on the dark felt and for common color-vision deficiencies. */
export const SEAT_COLORS = ["#e8b04a", "#5fb7e8", "#e8735f", "#7fd18b", "#c38be8", "#e8e15f", "#5fe0c8", "#e88fbf"];
export const seatColor = (seat) => SEAT_COLORS[seat % SEAT_COLORS.length];

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
      return `<div class="kit-plate ${active ? "active" : ""} ${p.connected ? "" : "away"}" style="left:${at.x}px;top:${at.y}px;transform:translate(-50%,-50%) rotate(${at.rot}deg);--seat:${seatColor(p.seat)}">
        <div class="kit-name">${p.kind === "ai" ? "◆ " : ""}${esc(p.name)}</div>
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

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
