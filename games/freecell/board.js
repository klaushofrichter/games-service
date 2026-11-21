// FreeCell on the board (D-308): the whole game is played here, with a finger or the mouse. Four free cells and four
// foundations on top, eight columns below. A card (or a run of cards) is dragged to where it should go, or tapped to
// go where it fits best. The 52 cards are 52 elements that stay: a move only changes where they lie, so every move,
// undo and card going home slides there by itself.
import { html, ping, playSound, seatPlates, useStyles } from "/shared/board-kit.js";

const W = 140, H = 196, GAP = 22; // a card, and the gap between columns
const X0 = (1920 - (8 * W + 7 * GAP)) / 2;
const TOP = 60; // the free cells and foundations
const TAB = 292; // the columns start here …
const TAB_END = 930; // … and their last card ends here at the latest (the seat plate is below)
const FAN = 46; // how far each card in a column lies below the one before, while there is room
const HOME = 12;
const SLIDE = 230; // ms a card takes to slide to its place
const DRAG_START = 8; // px a press may wander and still be a tap

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠", "♥", "♦", "♣"];
const rank = (c) => c >> 2;
const suit = (c) => c & 3;
const red = (c) => suit(c) === 1 || suit(c) === 2;
const cardName = (c) => `${RANKS[rank(c)]}${SUITS[suit(c)]}`;
const colX = (i) => X0 + i * (W + GAP);
const placeName = (p) => (p === HOME ? "its foundation" : p >= 8 ? "a free cell" : `column ${p + 1}`);

function tick(ctx, t, out) {
  ping(ctx, out, t, { freq: 900, partials: [1, 2.4], decay: 0.05, gain: 0.18 });
}
function homeSound(ctx, t, out) {
  ping(ctx, out, t, { freq: 1500, partials: [1, 2], decay: 0.12, gain: 0.14 });
}
function winSound(ctx, t, out) {
  [1047, 1319, 1568, 2093].forEach((f, i) => ping(ctx, out, t + i * 0.13, { freq: f, decay: 0.5, gain: 0.25 }));
}

export function mount(root, ctx) {
  useStyles("/games/freecell/board.css");
  const box = html(`<div class="fc-root">
    <div class="fc-slots"></div>
    <div class="fc-cards"></div>
    <div class="fc-side fc-buttons">
      <button type="button" class="fc-btn" data-do="undo">Undo</button>
      <button type="button" class="fc-btn" data-do="hint">Hint</button>
      <button type="button" class="fc-btn" data-do="restart">Start again</button>
      <button type="button" class="fc-btn" data-do="giveUp">Give up</button>
    </div>
    <div class="fc-side fc-status">
      <div class="fc-eyebrow">FreeCell</div>
      <div class="fc-stat"><span>Deal</span><b class="fc-deal"></b></div>
      <div class="fc-stat"><span>Moves</span><b class="fc-moves"></b></div>
      <div class="fc-stat"><span>Time</span><b class="fc-time"></b></div>
      <div class="fc-stat"><span>Home</span><b class="fc-home"></b></div>
    </div>
    <div class="fc-note" hidden></div>
  </div>`);
  root.appendChild(box);
  const slots = box.querySelector(".fc-slots");
  const layer = box.querySelector(".fc-cards");
  const note = box.querySelector(".fc-note");

  // The places: four free cells, four foundations, eight columns.
  let slotMarkup = "";
  for (let i = 0; i < 4; i++) slotMarkup += `<div class="fc-slot fc-cell" data-place="${8 + i}" style="left:${colX(i)}px;top:${TOP}px"></div>`;
  for (let s = 0; s < 4; s++) slotMarkup += `<div class="fc-slot fc-found ${s === 1 || s === 2 ? "red" : ""}" data-place="${HOME}" data-suit="${s}" style="left:${colX(4 + s)}px;top:${TOP}px">${SUITS[s]}</div>`;
  for (let c = 0; c < 8; c++) slotMarkup += `<div class="fc-slot fc-col" data-place="${c}" style="left:${colX(c)}px;top:${TAB}px"></div>`;
  slotMarkup += `<div class="fc-label" style="left:${colX(0)}px;top:${TOP - 32}px">Free cells</div><div class="fc-label" style="left:${colX(4)}px;top:${TOP - 32}px">Foundations</div>`;
  slots.innerHTML = slotMarkup;

  const cards = [];
  for (let c = 0; c < 52; c++) {
    const el = html(`<div class="fc-card ${red(c) ? "red" : ""}" data-card="${c}"><span class="fc-ix">${RANKS[rank(c)]}<i>${SUITS[suit(c)]}</i></span><span class="fc-pip">${SUITS[suit(c)]}</span></div>`);
    layer.appendChild(el);
    cards.push(el);
  }

  let view = null;
  let info = null;
  let where = new Map(); // card -> { place, index, x, y, z }
  let idleAt = 0;
  let drag = null; // { id, cards, from, n, x, y: the press (board pixels), moved, targets }
  let confirm = null; // { what, timer }: "Start again" and "Give up" ask once more
  let received = 0; // performance.now() when the latest view came
  let dealt = false;

  const mine = () => !!view && !!info && info.controlSeats?.includes(view.seat) && !view.over;
  const north = () => info?.rotation === 180;

  /** A point of the screen in the board's own 1920 × 1080, whichever way it is turned. */
  function local(e) {
    const r = root.getBoundingClientRect();
    let x = ((e.clientX - r.left) / r.width) * 1920;
    let y = ((e.clientY - r.top) / r.height) * 1080;
    if (north()) (x = 1920 - x), (y = 1080 - y);
    return { x, y };
  }

  const fan = (n) => (n <= 1 ? FAN : Math.min(FAN, (TAB_END - TAB - H) / (n - 1)));

  /** Where every card lies in this view. */
  function layout(v) {
    const at = new Map();
    v.cols.forEach((col, c) => {
      const step = fan(col.length);
      col.forEach((card, i) => at.set(card, { place: c, index: i, x: colX(c), y: TAB + i * step, z: 10 + i }));
    });
    v.cells.forEach((card, i) => card !== null && at.set(card, { place: 8 + i, index: 0, x: colX(i), y: TOP, z: 10 }));
    for (let s = 0; s < 4; s++) for (let r = 0; r < v.home[s]; r++) at.set(r * 4 + s, { place: HOME, index: r, x: colX(4 + s), y: TOP, z: 10 + r });
    return at;
  }

  function put(el, p, delay = 0, lift = false) {
    el.style.transitionDelay = delay ? `${delay}ms` : "";
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    el.style.zIndex = String(lift ? 500 + p.z : p.z);
  }

  /** The cards and what is lit: from the view, and the hint. */
  function draw(delays = new Map()) {
    const next = layout(view);
    let longest = 0;
    for (let c = 0; c < 52; c++) {
      const p = next.get(c);
      if (!p) continue;
      const old = where.get(c);
      const moved = !old || old.x !== p.x || old.y !== p.y;
      const delay = delays.get(c) ?? 0;
      if (drag?.moved && drag.cards.includes(c)) continue; // (in the hand)
      put(cards[c], p, delay, moved);
      if (moved) longest = Math.max(longest, delay + SLIDE);
      cards[c].classList.remove("fc-drag");
    }
    where = next;
    if (longest) {
      idleAt = Math.max(idleAt, performance.now() + longest);
      setTimeout(() => {
        if (!drag?.moved) for (let c = 0; c < 52; c++) if (where.get(c)) cards[c].style.zIndex = String(where.get(c).z);
      }, longest + 20);
    }
    // what can be picked up
    const movable = new Set();
    if (mine()) for (const key of Object.keys(view.legal ?? {})) {
      const [from, n] = key.split(":").map(Number);
      if (from >= 8) movable.add(view.cells[from - 8]);
      else movable.add(view.cols[from][view.cols[from].length - n]);
    }
    for (let c = 0; c < 52; c++) cards[c].classList.toggle("fc-movable", movable.has(c));
    // the hint: the card, and where it goes
    for (const el of box.querySelectorAll(".fc-hint")) el.classList.remove("fc-hint", "fc-hint-from");
    if (view.hint) {
      const h = view.hint;
      const card = h.from >= 8 ? view.cells[h.from - 8] : view.cols[h.from][view.cols[h.from].length - h.n];
      cards[card]?.classList.add("fc-hint", "fc-hint-from");
      target(h.to, card)?.classList.add("fc-hint");
    }
  }

  /** The element that stands for a place a card can go to: the top card of a column, or the empty slot. */
  function target(place, card) {
    if (place === HOME) return view.home[suit(card)] ? cards[(view.home[suit(card)] - 1) * 4 + suit(card)] : slots.querySelector(`.fc-found[data-suit="${suit(card)}"]`);
    if (place >= 8) return slots.querySelector(`.fc-cell[data-place="${place}"]`);
    const col = view.cols[place];
    return col.length ? cards[col[col.length - 1]] : slots.querySelector(`.fc-col[data-place="${place}"]`);
  }

  function status() {
    if (!view) return;
    box.querySelector(".fc-deal").textContent = `#${view.deal}`;
    box.querySelector(".fc-moves").textContent = view.moves;
    box.querySelector(".fc-home").textContent = `${view.home.reduce((a, b) => a + b, 0)} / 52`;
    const can = mine();
    const set = (what, on, label) => {
      const b = box.querySelector(`[data-do="${what}"]`);
      b.disabled = !on;
      b.textContent = confirm?.what === what ? "Tap again" : label;
      b.classList.toggle("fc-ask", confirm?.what === what);
    };
    set("undo", can && view.canUndo, "Undo");
    set("hint", can && !view.stuck, "Hint");
    set("restart", can && view.canUndo, "Start again");
    set("giveUp", can, "Give up");
    box.querySelector(".fc-buttons").hidden = !!view.over || !info?.controlSeats?.includes(view.seat);
    let text = "";
    if (view.over === "won") text = `Solved! Deal ${view.deal} in ${view.moves} moves.`;
    else if (view.over) text = `Deal ${view.deal} given up.`;
    else if (view.stuck) text = "No card can move. Undo, start again, or give up.";
    else if (view.noWay) text = "No way to win from here was found. Take some moves back.";
    else if (view.hint) {
      const h = view.hint;
      const card = h.from >= 8 ? view.cells[h.from - 8] : view.cols[h.from][view.cols[h.from].length - h.n];
      text = `Hint: ${cardName(card)} to ${placeName(h.to)}`;
    }
    note.hidden = !text;
    note.textContent = text;
    note.classList.toggle("fc-won", view.over === "won");
    clock();
  }

  function clock() {
    if (!view) return;
    let ms = view.firstAt === null ? 0 : view.lastAt - view.firstAt;
    if (view.firstAt !== null && !view.over) ms += performance.now() - received; // (runs on between moves)
    const s = Math.max(0, Math.floor(ms / 1000));
    box.querySelector(".fc-time").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  const ticking = setInterval(clock, 1000);

  async function act(name, payload) {
    const r = await ctx.act(view.seat, name, payload);
    if (!r?.ok) draw(); // (refused: everything back to where it lies)
    return r;
  }

  // ---------- the buttons ----------
  box.querySelector(".fc-buttons").addEventListener("click", (e) => {
    const b = e.target.closest("[data-do]");
    if (!b || b.disabled || !mine()) return;
    const what = b.dataset.do;
    const asks = what === "restart" || what === "giveUp";
    if (asks && confirm?.what !== what) {
      clearTimeout(confirm?.timer);
      confirm = { what, timer: setTimeout(() => ((confirm = null), status()), 3000) };
      return status();
    }
    clearTimeout(confirm?.timer);
    confirm = null;
    status();
    act(what);
  });

  // ---------- picking up, dragging and dropping ----------
  /** The cards a press on this card would take: itself and what lies on it, if they can move together. */
  function grab(card) {
    const p = where.get(card);
    if (!p || p.place === HOME) return null;
    if (p.place >= 8) return view.legal?.[`${p.place}:1`] ? { from: p.place, n: 1, cards: [card] } : null;
    const col = view.cols[p.place];
    const n = col.length - p.index;
    // (also a card that can't move anywhere may be tapped: the rules say why not)
    return { from: p.place, n, cards: col.slice(p.index), fixed: !view.legal?.[`${p.place}:${n}`] };
  }

  layer.addEventListener("pointerdown", (e) => {
    if (drag || e.button > 0 || !mine()) return;
    const el = e.target.closest(".fc-card");
    if (!el) return;
    const g = grab(Number(el.dataset.card));
    if (!g) return;
    const at = local(e);
    drag = { ...g, id: e.pointerId, x: at.x, y: at.y, moved: false, targets: view.legal?.[`${g.from}:${g.n}`] ?? [] };
    layer.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });

  layer.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const at = local(e);
    const dx = at.x - drag.x, dy = at.y - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_START || drag.fixed) return;
      drag.moved = true;
      for (const c of drag.cards) cards[c].classList.add("fc-drag");
      for (const t of drag.targets) target(t, drag.cards[0])?.classList.add("fc-target");
    }
    drag.cards.forEach((c, i) => {
      const p = where.get(c);
      cards[c].style.transform = `translate(${p.x + dx}px, ${p.y + dy}px)`;
      cards[c].style.zIndex = String(900 + i);
    });
    // the place under the cards lights up
    const over = dropPlace(at, dx, dy);
    for (const el of box.querySelectorAll(".fc-over")) el.classList.remove("fc-over");
    if (over !== null) target(over, drag.cards[0])?.classList.add("fc-over");
  });

  /** The place the dragged cards are over, if they may go there: by the middle of the first card. */
  function dropPlace(at, dx, dy) {
    const p = where.get(drag.cards[0]);
    const cx = p.x + dx + W / 2, cy = p.y + dy + H / 2;
    let best = null, bestD = Infinity;
    for (const t of drag.targets) {
      let x, y0, y1;
      if (t === HOME) (x = colX(4 + suit(drag.cards[0]))), (y0 = TOP), (y1 = TOP + H);
      else if (t >= 8) (x = colX(t - 8)), (y0 = TOP), (y1 = TOP + H);
      else (x = colX(t)), (y0 = TAB), (y1 = 1080);
      // (the foundations as a whole take a card for its own suit)
      const inX = t === HOME ? cx >= colX(4) - GAP / 2 && cx <= colX(7) + W + GAP / 2 : Math.abs(cx - (x + W / 2)) <= (W + GAP) / 2;
      const inY = cy >= y0 - H / 2 && cy <= y1 + H / 2;
      if (!inX || !inY) continue;
      const d = Math.abs(cx - (x + W / 2));
      if (d < bestD) (best = t), (bestD = d);
    }
    return best;
  }

  function drop(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    for (const el of box.querySelectorAll(".fc-target, .fc-over")) el.classList.remove("fc-target", "fc-over");
    if (!d.moved) {
      if (!cancelled) act("tap", { from: d.from, n: d.n });
      return;
    }
    const at = local(e);
    drag = d; // (dropPlace reads it)
    const to = cancelled ? null : dropPlace(at, at.x - d.x, at.y - d.y);
    drag = null;
    if (to === null) return draw(); // back to where they were
    // They stay where they were let go until the table answers; then they slide into place (or back).
    for (const c of d.cards) cards[c].classList.remove("fc-drag");
    act("move", { from: d.from, to, n: d.n });
  }
  layer.addEventListener("pointerup", (e) => drop(e, false));
  layer.addEventListener("pointercancel", (e) => drop(e, true));
  layer.addEventListener("lostpointercapture", (e) => drag && drop(e, true));

  return {
    update(v, events, i) {
      const first = !view;
      view = v;
      info = i;
      received = performance.now();
      box.classList.toggle("fc-north", north());
      seatPlates(root, info).classList.toggle("fc-north", north());
      // Cards that go home by themselves follow one after the other; a new deal is dealt out card by card.
      const delays = new Map();
      let k = 0;
      for (const ev of events ?? []) {
        if (ev.name === "home") delays.set(ev.data.card, ++k * 90);
        if (ev.name === "moved") playSound(info, "fc-move", tick);
        if (ev.name === "home") playSound(info, "fc-home", homeSound);
        if (ev.name === "won") playSound(info, "fc-won", winSound);
      }
      if (first && !dealt) {
        dealt = true;
        if (v.moves === 0 && !v.over) {
          // from the middle of the top row, card by card
          for (let c = 0; c < 52; c++) cards[c].style.transform = `translate(${1920 / 2 - W / 2}px, ${TOP}px)`;
          v.cols.forEach((col, ci) => col.forEach((card, ri) => delays.set(card, 60 + (ri * 8 + ci) * 18)));
          void layer.offsetWidth; // (so the cards slide from there)
        }
      }
      if (drag && (events ?? []).length) {
        // the table moved on under a card in the hand: let go of it
        drag = null;
        for (const el of box.querySelectorAll(".fc-target, .fc-over, .fc-drag")) el.classList.remove("fc-target", "fc-over", "fc-drag");
      }
      draw(delays);
      status();
    },
    whenIdle() {
      const wait = idleAt - performance.now();
      return wait > 0 ? new Promise((r) => setTimeout(r, wait)) : Promise.resolve();
    },
    destroy() {
      clearInterval(ticking);
      clearTimeout(confirm?.timer);
      box.remove();
    },
  };
}
