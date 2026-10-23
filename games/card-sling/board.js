// Card Sling board (EXPERIMENT, games-service experiment/card-sling). A card a player drags off the top of their
// phone shows at once at their seat: the part that has left the phone pokes out of a slot above their plate (live
// gestures, `gesture(seat, data)`). When the card is played it flies from there to the pile; a card drawn flies from
// the pile to the seat and slips into the slot. AI players' cards fly in from their seats the same way.
import { seatPlates, useStyles } from "/shared/board-kit.js";
import { cardBack, cardFace } from "/games/card-sling/assets/cards.js";

const CW = 120, CH = 180; // a card on the board
const GAP = 46; // from a plate's centre to the slot's bottom edge, toward the middle
const SPREAD = 150; // how far the phone's left-right position moves the card along the edge
const PILE = { x: 960, y: 520 };

export function mount(root, ctx) {
  useStyles("/games/card-sling/board.css");
  root.innerHTML = `<div class="cs-root"><div class="cs-pile"></div><div class="cs-slots"></div><div class="cs-fly"></div><div class="cs-count"></div></div>`;
  const $ = (s) => root.querySelector(s);
  let info = null, view = null, raf = 0, gone = false;
  const slots = new Map(); // seat -> { el, card, f, x, tf, tx, key }
  const landing = new Set(); // pile cards still in the air

  const pos = (seat) => info?.seatPositions?.[seat];

  /** The card's centre and angle on the board for a slot pose (f: how much of it is out, x: −1…1 along the edge). */
  function pose(seat, f, x) {
    const at = pos(seat);
    const lx = x * SPREAD, ly = -GAP - f * CH + CH / 2;
    const a = (at.rot * Math.PI) / 180;
    return { x: at.x + lx * Math.cos(a) - ly * Math.sin(a), y: at.y + lx * Math.sin(a) + ly * Math.cos(a), angle: at.rot };
  }

  function slot(seat) {
    let s = slots.get(seat);
    if (s) return s;
    const at = pos(seat);
    if (!at) return null;
    const el = document.createElement("div");
    el.className = "cs-anchor";
    el.style.cssText = `left:${at.x}px;top:${at.y}px;transform:rotate(${at.rot}deg)`;
    el.innerHTML = `<div class="cs-slot" style="left:${-SPREAD - CW}px;width:${2 * (SPREAD + CW)}px;top:${-GAP - CH}px;height:${CH}px"><div class="cs-card"></div></div>`;
    $(".cs-slots").appendChild(el);
    s = { el, card: el.querySelector(".cs-card"), f: 0, x: 0, tf: 0, tx: 0, key: "" };
    slots.set(seat, s);
    return s;
  }

  function face(s, key, markup) {
    if (s.key !== key) ((s.key = key), (s.card.innerHTML = markup));
  }

  // One loop eases every slot toward its latest gesture, so 30–60 messages a second look smooth.
  function tick() {
    raf = 0;
    let moving = false;
    for (const s of slots.values()) {
      s.f += (s.tf - s.f) * 0.5;
      s.x += (s.tx - s.x) * 0.5;
      if (Math.abs(s.tf - s.f) < 0.002) s.f = s.tf;
      if (Math.abs(s.tx - s.x) < 0.002) s.x = s.tx;
      else moving = true;
      if (s.f !== s.tf) moving = true;
      s.card.style.transform = `translate(${SPREAD + s.x * SPREAD}px, ${(1 - s.f) * CH}px)`;
      s.card.style.visibility = s.f > 0.001 ? "visible" : "hidden";
    }
    if (moving && !gone) raf = requestAnimationFrame(tick);
  }
  const kick = () => (raf ||= requestAnimationFrame(tick));

  function renderPile() {
    const cards = (view?.pile ?? []).filter((c) => !landing.has(c.id));
    $(".cs-pile").innerHTML = cards
      .map((c) => `<div class="cs-on-pile" style="transform:translate(${PILE.x + c.dx - CW / 2}px,${PILE.y + c.dy - CH / 2}px) rotate(${c.angle}deg)">${cardFace(c, CW, CH)}</div>`)
      .join("");
  }

  /** A flying card from one pose to another (board coordinates), then `done`. */
  function fly(markup, from, to, { ms, fadeIn = false } = {}, done = () => {}) {
    const el = document.createElement("div");
    el.className = "cs-flying";
    el.innerHTML = markup;
    $(".cs-fly").appendChild(el);
    let turn = to.angle - from.angle;
    turn = ((((turn + 180) % 360) + 360) % 360) - 180; // the short way round
    const t = (p, a, k = 1) => `translate(${p.x - CW / 2}px,${p.y - CH / 2}px) rotate(${a}deg) scale(${k})`;
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const anim = el.animate(
      [
        { transform: t(from, from.angle), opacity: fadeIn ? 0 : 1 },
        { transform: t(mid, from.angle + turn * 0.6, 1.12), opacity: 1, offset: 0.45 },
        { transform: t(to, from.angle + turn), opacity: 1 },
      ],
      { duration: ms ?? Math.min(560, 260 + dist * 0.45), easing: "cubic-bezier(.25,.7,.3,1)", fill: "forwards" },
    );
    anim.onfinish = () => (el.remove(), done());
  }

  /** A played card: from the seat's slot (where the player's drag left it) to its place on the pile. */
  function played(seat, card) {
    const s = slot(seat);
    if (!s) return renderPile();
    const live = s.key === `c${card.id}` && s.f > 0.05;
    const from = live ? pose(seat, s.f, s.x) : pose(seat, 0.5, 0);
    s.f = s.tf = 0;
    s.card.style.visibility = "hidden";
    landing.add(card.id);
    renderPile();
    fly(cardFace(card, CW, CH), from, { x: PILE.x + card.dx, y: PILE.y + card.dy, angle: card.angle }, { fadeIn: !live }, () => {
      landing.delete(card.id);
      renderPile();
    });
  }

  /** A drawn card: from the pile to the seat, then into the slot, as if it went onto the phone. */
  function drew(seat) {
    const s = slot(seat);
    if (!s) return;
    const to = pose(seat, 1, 0);
    fly(cardBack(CW, CH), { x: PILE.x, y: PILE.y, angle: 0 }, to, { ms: 420 }, () => {
      face(s, "back", cardBack(CW, CH));
      s.x = s.tx = 0;
      s.f = 1;
      s.tf = 0;
      kick();
    });
  }

  return {
    update(v, events, i) {
      view = v;
      info = i;
      seatPlates(root.querySelector(".cs-root"), i, (seat) => `${v.counts[seat] ?? 0} cards`);
      $(".cs-count").textContent = `${v.played} of ${v.plays} cards played`;
      for (const e of events) {
        if (e.name === "played") played(e.data.seat, e.data.card);
        else if (e.name === "drew") drew(e.data.seat);
      }
      if (!events.some((e) => e.name === "played")) renderPile();
    },
    // A phone's live gesture (games-service experiment): { card, f, x } while a card is dragged, { end } after.
    gesture(seat, d) {
      const s = slot(seat);
      if (!s || !d) return;
      if (d.end) s.tf = 0;
      else {
        if (d.card) face(s, `c${d.card.id}`, cardFace(d.card, CW, CH));
        s.tf = Math.max(0, Math.min(1, Number(d.f) || 0));
        s.tx = Math.max(-1, Math.min(1, Number(d.x) || 0));
      }
      kick();
    },
    whenIdle: () => new Promise((r) => setTimeout(r, landing.size ? 600 : 0)),
    destroy() {
      gone = true;
      cancelAnimationFrame(raf);
    },
  };
}
