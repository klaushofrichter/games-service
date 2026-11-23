// Board kit: helpers shared by the board page and by games' own board.js / deck.js.
// Games import it as `/shared/board-kit.js`.

export const W = 1920;
export const H = 1080;

/** Rotation that makes content readable from an edge (bottom of the text faces that edge). */
export const ROT = { south: 0, west: 90, north: 180, east: -90 };

/** One color per seat, distinct on the dark felt and for common color-vision deficiencies. */
export const SEAT_COLORS = ["#f2d24b", "#5fb7e8", "#e5484d", "#7fd18b", "#9d6bf0", "#dde3ea", "#f08a3c", "#ef8fcf"];
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
    if (actx?.state === "closed") actx = null;
    actx ??= new (window.AudioContext || window.webkitAudioContext)();
    // Not only "suspended": Safari "interrupts" it (a locked screen, a call, the tab in the background) and it stays
    // so until resumed (D-195).
    if (actx.state !== "running") actx.resume().catch(() => {});
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
  if (!ctx) return;
  // A new audio context starts suspended and resumes a moment later: play once it runs instead of dropping the
  // first sounds after the board loads (Hold'em's first shuffle, D-139). Only if it runs within a second, so a board
  // that may not play sound yet (nobody has touched it) does not let a pile of old sounds out at the first tap.
  if (ctx.state !== "running") {
    const asked = performance.now();
    ctx.resume().then(() => ctx.state === "running" && performance.now() - asked < 1000 && start(ctx, name, make), () => {});
    return;
  }
  start(ctx, name, make);
}

function start(ctx, name, make) {
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
 * so they always agree. A seat nobody sits in gets the seat's colour (a seat never loses its player during a game,
 * D-159, so `seatColors` is always empty).
 */
export function playerColor(info, seat) {
  const ok = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
  const c = info?.players?.find((p) => p.seat === seat)?.color;
  return ok(c) ? c : seatColor(seat);
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
  const markup = info.players
    .filter((p) => p.seat !== null && pos[p.seat])
    .map((p) => {
      const at = pos[p.seat];
      const active = opts.active === p.seat;
      return `<div class="kit-plate ${active ? "active" : ""} ${p.connected ? "" : "away"}" style="left:${at.x}px;top:${at.y}px;transform:translate(-50%,-50%) rotate(${at.rot}deg);--seat:${playerColor(info, p.seat)}">
        <div class="kit-name"><span class="kit-dot" aria-hidden="true"></span>${esc(p.name)}</div>
        <div class="kit-extra">${p.connected ? extra(p.seat, p) : "Reconnecting…"}</div></div>`;
    })
    .join("");
  // Written only when it changed: boards call this on every update, and a rewrite restarts the plates' animations.
  if (platesShown.get(box) !== markup) {
    platesShown.set(box, markup);
    box.innerHTML = markup;
  }
  return box;
}
const platesShown = new WeakMap();

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

/**
 * A game's data on the table (D-302), as its board and its players' phones get it in `ctx.store` when the manifest
 * says `storage: true`: favourites and the like, kept on the table's own computer between games. Plain JSON under
 * keys ("favourites", "configs"); 64 entries, 48 KB each, 256 KB in all. Shared by everyone at the table.
 *
 *   await store.get(key)          the entry, or undefined
 *   await store.keys()            the keys there are
 *   await store.all()             { key: value, … }
 *                                 These three throw when the table gives no answer (not connected just now): "nothing
 *                                 there" and "could not ask" must not look alike, or a game would write its empty
 *                                 start over what the table keeps. Catch it and ask again later.
 *   await store.set(key, value)   { ok, reason? }; null or undefined removes the entry
 *   store.onChange((key, value) => …)   another screen changed an entry (value undefined: removed); key null: all of
 *                                       it was replaced or removed, or this screen was away from the table for a
 *                                       moment and may have missed changes: read again. Returns a function that stops
 *                                       it. A screen is not told of its own changes.
 *
 * `send(type, payload)` asks the table and resolves to { ok, reason?, payload? }. Returns the store and `changed`,
 * which the page calls with the table's change messages.
 */
export function gameStore(send, gameId) {
  const cache = new Map(); // key -> value as the table keeps it (null: no such entry)
  let known = null; // the keys, once asked for
  const listeners = new Set();
  const copy = (v) => (v === null || v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const note = (key, value) => {
    cache.set(key, value ?? null);
    if (known) value === null || value === undefined ? known.delete(key) : known.add(key);
  };
  const store = {
    async get(key) {
      if (!cache.has(key)) {
        const r = await send("get", { key });
        if (!r.ok) throw new Error(`the table's game data could not be read: ${r.reason ?? "no answer"}`);
        if (!cache.has(key)) note(key, r.payload?.value ?? null); // unless a change arrived meanwhile
      }
      return copy(cache.get(key));
    },
    async keys() {
      if (!known) {
        const r = await send("keys", {});
        if (!r.ok) throw new Error(`the table's game data could not be read: ${r.reason ?? "no answer"}`);
        known ??= new Set(r.payload?.keys ?? []);
      }
      return [...known];
    },
    async all() {
      // asked for together: one round trip's wait, also over a remote player's connection
      const keys = await store.keys();
      const values = await Promise.all(keys.map((k) => store.get(k)));
      return Object.fromEntries(keys.map((k, i) => [k, values[i]]).filter(([, v]) => v !== undefined));
    },
    async set(key, value) {
      const r = await send("set", { key, value: value ?? null });
      if (r.ok) note(key, value === undefined ? null : JSON.parse(JSON.stringify(value)));
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  /** The page is connected to the table again: changes may have been missed, so nothing kept here counts any more. */
  const reconnected = () => changed({ gameId, reset: true });
  const changed = (c) => {
    if (!c || c.gameId !== gameId) return;
    if (c.reset) {
      cache.clear();
      known = null;
    } else note(c.key, c.value);
    for (const fn of listeners) {
      try {
        fn(c.reset ? null : c.key, c.reset ? undefined : copy(c.value));
      } catch (err) {
        console.error(err);
      }
    }
  };
  return { store, changed, reconnected };
}

/**
 * Screen movement taken into an element's own frame: the linear part of every transform from the element up to the
 * page (rotation and scale; moves don't turn a vector), inverted. The board is scaled to the screen and turned to an
 * edge of the table, so "down" for a finger is not always down for what it touches. Returns (dx, dy) => { x, y }.
 */
export function localFrame(el) {
  let m = new DOMMatrix();
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    const t = getComputedStyle(n).transform;
    if (t && t !== "none") m = new DOMMatrix(t).multiply(m);
  }
  const det = m.a * m.d - m.b * m.c || 1;
  return (dx, dy) => ({ x: (m.d * dx - m.c * dy) / det, y: (-m.b * dx + m.a * dy) / det });
}

/**
 * Scrolling made for a finger on the table's touchscreen (D-306), for an element that scrolls up and down: a wide bar
 * of its own at the right edge instead of the browser's thin one (drag its thumb, or tap the track above or below it
 * for a page), and the content itself moves with one finger or two dragged across it, whichever way the board is
 * turned. A drag is not a tap: what it started on is not pressed. Sliders, pulldowns and text fields keep their own
 * touch. The mouse wheel and the keyboard scroll as always. Wider content also moves sideways with the fingers. A
 * scrolling element inside another: the inner one takes the fingers while it has something to scroll.
 *
 * Call it again after the element's content was drawn anew (it puts its bar back and measures); it is set up once per
 * element. The element gets the classes `touch-scroll` and, while there is something to scroll, `scrolls`; style the
 * room for the bar with those (shared/theme.css has the bar itself).
 */
const touchScrolls = new WeakMap(); // element -> its update()
// Fingers lift anywhere, not only over what they scrolled: the scrollers with a finger down hear of every release.
const touchReleases = new Set();
if (typeof window !== "undefined") {
  for (const type of ["pointerup", "pointercancel"]) window.addEventListener(type, (e) => touchReleases.forEach((fn) => fn(e)), true);
}
export function touchScroll(el) {
  const known = touchScrolls.get(el);
  if (known) return known();
  const MOVE = 12; // px a press may wander and still be a tap
  const rail = document.createElement("div");
  rail.className = "scroll-rail";
  rail.innerHTML = `<div class="scroll-bar" hidden><i class="scroll-thumb"></i></div>`;
  const bar = rail.firstElementChild;
  const thumb = bar.firstElementChild;
  const room = () => el.scrollHeight - el.clientHeight;
  let fling = 0;
  const stop = () => cancelAnimationFrame(fling);

  function update() {
    if (rail.parentElement !== el) el.prepend(rail); // (the content was drawn anew)
    const over = room() > 1;
    el.classList.toggle("scrolls", over);
    bar.hidden = !over;
    if (!over) return;
    // The rail lies over the element's top padding and stays there while the content scrolls (sticky insets count
    // from the padding's inner edge, hence the negative ones); the bar hangs from it down the right edge.
    const cs = getComputedStyle(el);
    const padTop = parseFloat(cs.paddingTop) || 0;
    rail.style.height = `${padTop}px`;
    rail.style.marginTop = rail.style.top = `${-padTop}px`;
    bar.style.right = `${6 - (parseFloat(cs.paddingRight) || 0)}px`;
    track = el.clientHeight - 16;
    bar.style.height = `${track}px`;
    thumbH = Math.max(90, (track * el.clientHeight) / el.scrollHeight);
    thumb.style.height = `${thumbH}px`;
    span = room();
    place();
  }
  // While the content scrolls (every frame of a drag or a fling) only the thumb moves; the bar is measured again
  // when there is more or less to scroll than when it was measured.
  let track = 0, thumbH = 0, span = 0;
  const place = () => (thumb.style.transform = `translateY(${((track - thumbH) * el.scrollTop) / span}px)`);
  el.classList.add("touch-scroll");
  el.addEventListener("scroll", () => (room() === span && span > 1 ? place() : update()), { passive: true });
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => (el.isConnected ? update() : ro.disconnect()));
    ro.observe(el);
  }

  // The content under one finger or two: it follows the fingers' middle.
  const fingers = new Map(); // pointerId -> { x, y }
  let drag = null; // { frame, x, y: the middle at the start, top, last, t, v }
  let dragged = false;
  const middle = () => {
    let x = 0, y = 0;
    for (const p of fingers.values()) (x += p.x), (y += p.y);
    return { x: x / fingers.size, y: y / fingers.size };
  };
  const restart = (t) => {
    const m = middle();
    drag = { frame: drag?.frame ?? localFrame(el), x: m.x, y: m.y, top: el.scrollTop, left: el.scrollLeft, last: m.y, lastX: m.x, t, v: 0 };
  };
  el.addEventListener("pointerdown", (e) => {
    // A finger's pan ends without a click, so "that was a drag" is forgotten with the next press: also one on a field
    // or in a scroller inside this one, which this element leaves alone.
    if (!fingers.size) dragged = false;
    if (e.button > 0 || e.gtScrolls || e.target.closest?.(".scroll-rail, input, select, textarea, [contenteditable]")) return;
    if (room() > 1) e.gtScrolls = true; // (not also the scrolling element around this one)
    stop();
    if (!fingers.size) drag = null;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    touchReleases.add(release);
    restart(e.timeStamp); // (a second finger: from where the two are now, without a jump)
  });
  el.addEventListener("pointermove", (e) => {
    const f = fingers.get(e.pointerId);
    if (!f || !drag) return;
    f.x = e.clientX;
    f.y = e.clientY;
    const m = middle();
    const d = drag.frame(m.x - drag.x, m.y - drag.y);
    if (!dragged && Math.abs(d.y) < MOVE && !(el.scrollWidth > el.clientWidth + 1 && Math.abs(d.x) >= MOVE)) return;
    if (!dragged) {
      dragged = true;
      for (const id of fingers.keys()) {
        try {
          el.setPointerCapture?.(id);
        } catch {} // (a finger that is gone by now: its release comes by the window anyway)
      }
    }
    el.scrollTop = drag.top - d.y;
    el.scrollLeft = drag.left - d.x;
    const dt = e.timeStamp - drag.t;
    const step = drag.frame(m.x - drag.lastX, m.y - drag.last).y;
    if (dt > 0) drag.v = (0.8 * step) / dt + 0.2 * drag.v;
    drag.last = m.y;
    drag.lastX = m.x;
    drag.t = e.timeStamp;
  });
  const release = (e) => {
    if (!fingers.delete(e.pointerId) || !drag) return;
    if (fingers.size) return restart(e.timeStamp); // one finger still down: on from there
    touchReleases.delete(release);
    let v = dragged && e.timeStamp - drag.t < 100 ? drag.v : 0; // (px per ms; a drag that paused does not run on)
    drag = null;
    let t = performance.now();
    const run = (now) => {
      el.scrollTop -= v * (now - t);
      v *= Math.pow(0.995, now - t);
      t = now;
      if (Math.abs(v) > 0.02) fling = requestAnimationFrame(run);
    };
    if (Math.abs(v) > 0.1) fling = requestAnimationFrame(run);
  };
  // a drag is not a tap on what it started on
  el.addEventListener(
    "click",
    (e) => {
      if (!dragged) return;
      dragged = false;
      e.stopImmediatePropagation();
      e.preventDefault();
    },
    true,
  );

  // The bar: drag its thumb, or tap the track above or below it for a page.
  let grab = null;
  bar.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    stop();
    e.preventDefault();
    e.stopPropagation();
    const frame = localFrame(bar);
    if (e.target === thumb) {
      grab = { id: e.pointerId, x: e.clientX, y: e.clientY, top: el.scrollTop, frame, ratio: room() / Math.max(1, bar.clientHeight - thumb.offsetHeight) };
      bar.setPointerCapture?.(e.pointerId);
      return;
    }
    const r = thumb.getBoundingClientRect();
    const below = frame(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)).y > 0;
    el.scrollTop += (below ? 1 : -1) * 0.9 * el.clientHeight;
  });
  bar.addEventListener("pointermove", (e) => {
    if (grab && e.pointerId === grab.id) el.scrollTop = grab.top + grab.frame(e.clientX - grab.x, e.clientY - grab.y).y * grab.ratio;
  });
  const letGo = (e) => grab && e.pointerId === grab.id && (grab = null);
  bar.addEventListener("pointerup", letGo);
  bar.addEventListener("pointercancel", letGo);
  bar.addEventListener("click", (e) => e.stopPropagation()); // (not a tap on the window behind it)

  touchScrolls.set(el, update);
  update();
}
