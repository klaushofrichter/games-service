// Card Sling phone (EXPERIMENT, games-service experiment/card-sling). Your cards sit at the bottom. Touch one and push
// it up: it follows your finger and leaves the phone at the top, and the board shows the part that has left at your
// seat while you drag (`ctx.gesture`, live, not logged). Let go with more than half of it out, or flick it up, and it
// is played; otherwise it slides back. Draw a card and it comes in from the top once the board has sent it your way.
import { useStyles } from "/shared/board-kit.js";
import { cardFace } from "/games/card-sling/assets/cards.js";

const CW = 88, CH = 132;
const FLICK = -0.8; // px per ms upward that counts as a flick

export function mount(root, ctx) {
  useStyles("/games/card-sling/deck.css");
  root.innerHTML = `<div class="csd">
    <div class="csd-top"><div class="csd-hint">Push a card up and off the top to play it</div><div class="csd-arrow" aria-hidden="true">↑</div></div>
    <div class="csd-bar"><span class="csd-count"></span><button type="button" class="primary csd-draw">Draw a card</button></div>
    <div class="csd-hand"></div></div>`;
  const $ = (s) => root.querySelector(s);
  const box = $(".csd");
  let view = null, drag = null, pending = null, gone = false;
  let sendRaf = 0, lastSent = null;

  // ---------- gestures to the board: the latest pose, at most once a frame ----------
  function gesture(data) {
    lastSent = data;
    sendRaf ||= requestAnimationFrame(() => {
      sendRaf = 0;
      ctx.gesture?.(lastSent);
    });
  }
  const gestureNow = (data) => (cancelAnimationFrame(sendRaf), (sendRaf = 0), ctx.gesture?.(data));

  // ---------- the hand ----------
  function layout(n) {
    const w = $(".csd-hand").clientWidth - 24;
    const step = n > 1 ? Math.min(CW + 8, (w - CW) / (n - 1)) : 0;
    const start = 12 + Math.max(0, (w - CW - step * (n - 1)) / 2);
    return (i) => start + i * step;
  }
  function render(entering = null) {
    const hand = view?.hand ?? [];
    const left = layout(hand.length);
    $(".csd-hand").innerHTML = hand
      .map((c, i) => `<div class="csd-card" data-id="${c.id}" style="left:${left(i)}px;z-index:${i + 1}">${cardFace(c, CW, CH)}</div>`)
      .join("");
    $(".csd-count").textContent = `${hand.length} cards · ${view?.played ?? 0} of ${view?.plays ?? 0} played`;
    $(".csd-draw").disabled = !view?.canDraw;
    if (entering) {
      // A drawn card comes in from the top, once the board has thrown it toward this seat.
      const el = $(`.csd-card[data-id="${entering}"]`);
      if (el) {
        const r = el.getBoundingClientRect(), top = box.getBoundingClientRect().top;
        el.animate([{ transform: `translateY(${top - r.bottom - 10}px) rotate(-8deg)` }, { transform: "none" }], { duration: 420, delay: 330, easing: "cubic-bezier(.2,.8,.3,1)", fill: "backwards" });
      }
    }
  }

  // ---------- dragging a card ----------
  function measure(d) {
    const top = box.getBoundingClientRect().top;
    const r = d.el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (top - r.top) / r.height));
    const bw = box.clientWidth;
    const x = Math.max(-1, Math.min(1, (r.left + r.width / 2 - bw / 2) / (bw / 2)));
    return { f, x };
  }
  function moveTo(d, dx, dy) {
    d.dx = dx;
    d.dy = dy;
    d.el.style.transform = `translate(${dx}px, ${dy}px) scale(1.06) rotate(${Math.max(-8, Math.min(8, dx / 25))}deg)`;
    const { f, x } = measure(d);
    d.f = f;
    if (f > 0 || d.sent) {
      d.sent = true;
      gesture({ card: d.card, f, x });
    }
  }
  /** Animate the dragged card to (dx, dy) in ms, sending its pose every frame; then `done`. */
  function glide(d, dx, dy, ms, done) {
    const x0 = d.dx, y0 = d.dy, t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - (1 - k) ** 3;
      moveTo(d, x0 + (dx - x0) * e, y0 + (dy - y0) * e);
      if (k < 1 && !gone) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  }

  root.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".csd-card");
    if (!el || drag || !view) return;
    const card = view.hand.find((c) => c.id === Number(el.dataset.id));
    if (!card) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add("drag");
    drag = { el, card, id: e.pointerId, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, f: 0, sent: false, samples: [{ t: e.timeStamp, y: e.clientY }] };
    ctx.vibrate?.(8);
  });
  root.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.samples.push({ t: e.timeStamp, y: e.clientY });
    while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 90) drag.samples.shift();
    moveTo(drag, e.clientX - drag.sx, e.clientY - drag.sy);
  });
  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    const s = d.samples, a = s[0], b = s.at(-1);
    const v = b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
    if (d.f >= 0.5 || (v < FLICK && d.f > 0.02)) {
      // Out it goes: off the top, then the move.
      const top = box.getBoundingClientRect().top, r = d.el.getBoundingClientRect();
      glide(d, d.dx, d.dy - (r.bottom - top) - 4, Math.max(70, 160 * (1 - d.f)), async () => {
        gestureNow({ card: d.card, f: 1, x: measure(d).x });
        d.el.style.visibility = "hidden";
        ctx.vibrate?.(20);
        const r2 = await ctx.send("play", { id: d.card.id });
        drag = null;
        if (pending) {
          const p = pending;
          pending = null;
          view = p.v;
          render(p.entering);
        } else if (!r2?.ok) (gestureNow({ end: true }), render());
      });
    } else {
      glide(d, 0, 0, 180, () => {
        if (d.sent) gestureNow({ end: true });
        d.el.classList.remove("drag");
        d.el.style.transform = "";
        drag = null;
        if (pending) ((view = pending.v), render(pending.entering), (pending = null));
      });
    }
  };
  root.addEventListener("pointerup", release);
  root.addEventListener("pointercancel", release);

  root.addEventListener("click", (e) => {
    if (e.target.closest(".csd-draw")) ctx.send("draw");
  });

  return {
    update(v, events, info) {
      const before = new Set((view?.hand ?? []).map((c) => c.id));
      const drewMine = events.some((e) => e.name === "drew" && e.data.seat === info.seat);
      const entering = drewMine ? v.hand.find((c) => !before.has(c.id))?.id ?? null : null;
      if (drag) return void (pending = { v, entering }); // keep the card under the finger; show the rest after
      view = v;
      render(entering);
    },
    destroy() {
      gone = true;
      cancelAnimationFrame(sendRaf);
    },
  };
}
