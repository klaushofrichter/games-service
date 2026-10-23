// Sling (D-189): a phone flicks a card (or a die, a token…) off its top edge onto the board. The platform owns the
// gesture and its animation; the game owns what the thing looks like, where it lands and what the move means.
//
//   Phone (deck.js):  const sling = slingDeck(area, ctx, { item, canSling, onSling, reveal, speed })
//   Board (board.js): const sling = slingBoard(root, { render, size, speed })
//                     … and in the module: gesture(seat, data) { sling.gesture(seat, data) }
//
// While a player drags, the phone sends live gestures (`ctx.gesture`, not logged, no rules run) and the board shows
// the part that has left the phone at that player's edge of the board, with the same tilt. Let go with half of it
// out, or flick it, and the phone calls the game's `onSling` (which sends the move); the board flies the item from
// where it was to wherever the game says when the move's event arrives (`fly`). Drawing goes the other way: the board
// throws an item to a seat (`toSeat`) and the phone lets it come in at its top (`receive`), timed to match.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Timings in ms at speed 1; a game may offer a slower or faster board (`speed` multiplies them). */
export const SLING_MS = { flyMin: 390, flyPerPx: 0.68, flyMax: 840, toSeat: 630, back: 270, receiveDelay: 500, receive: 500 };

// ---------------------------------------------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------------------------------------------

/**
 * Lets the elements with `data-sling="<id>"` inside `area` be slung off its top edge. `area` must clip its content
 * (`overflow: hidden`): its top edge is where things leave the phone.
 *
 * opts:
 * - `item(id)`: what the board needs to draw the thing face up (game data, small). Sent only with `reveal: "drag"`.
 * - `reveal`: `"move"` (default) shows the board only the back until the move is made; `"drag"` shows the face at once.
 * - `canSling(id)`: true to allow; false or a reason (string) and the thing bounces back from the top edge.
 * - `onSling(id, { direction })`: make the move (send the intent); resolve true if it was accepted. `direction` is
 *   `"left"`, `"middle"` or `"right"`: where the flick went, for games that care (most don't).
 * - `threshold` (0.5): the share that must be out when letting go; `flick` (0.8 px/ms upward) also counts.
 * - `line()`: optional, a height on the page (clientY, e.g. the bottom of a status box): let go with the thing's
 *   middle above it and it is played toward the middle, without pushing it all the way off (D-193). While it is above
 *   the line, it and `area` have the class `sling-armed`. Off the top, left, middle or right still count.
 * - `speed()`: the board's animation speed (1 = normal), for `receive`.
 * - `tilt` (true): the thing leans with sideways movement, and the board shows the same angle.
 */
export function slingDeck(area, ctx, opts = {}) {
  const o = { reveal: "move", threshold: 0.5, flick: 0.8, tilt: true, speed: () => 1, canSling: () => true, ...opts };
  let drag = null, raf = 0, latest = null, gone = false;

  function send(data, now = false) {
    latest = data;
    if (now) {
      cancelAnimationFrame(raf);
      raf = 0;
      return ctx.gesture?.(data);
    }
    raf ||= requestAnimationFrame(() => ((raf = 0), ctx.gesture?.(latest)));
  }

  function measure(d) {
    const box = area.getBoundingClientRect(), r = d.el.getBoundingClientRect();
    // The element's own height, not its rotated bounding box: the tilt changes the box, not how much is out.
    const h = d.h;
    const top = r.top + (r.height - h) / 2;
    return { f: clamp((box.top - top) / h, 0, 1), x: clamp((r.left + r.width / 2 - box.left - box.width / 2) / (box.width / 2), -1, 1) };
  }

  function pose(d, dx, dy) {
    d.dx = dx;
    d.dy = dy;
    d.a = o.tilt ? clamp(dx / 25, -10, 10) : 0;
    d.el.style.transform = `translate(${dx}px, ${dy}px) rotate(${d.a}deg) scale(1.05)`;
    const { f, x } = measure(d);
    d.f = f;
    if (o.line) {
      const r = d.el.getBoundingClientRect();
      d.armed = !d.blocked && r.top + r.height / 2 < o.line();
      d.el.classList.toggle("sling-armed", d.armed);
      area.classList.toggle("sling-armed", d.armed);
    }
    if (d.blocked && f > 0.35) {
      // Not allowed: it may peek out a little, then it goes back.
      d.dy -= (f - 0.35) * d.h;
      d.el.style.transform = `translate(${dx}px, ${d.dy}px) rotate(${d.a}deg) scale(1.05)`;
      d.f = 0.35;
    }
    if (d.f > 0 || d.sent) {
      d.sent = true;
      send({ id: d.id, f: d.f, x, a: d.a, ...(o.reveal === "drag" && o.item ? { item: o.item(d.id) } : {}) });
    }
  }

  function glide(d, dx, dy, ms, done) {
    const x0 = d.dx, y0 = d.dy, t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - (1 - k) ** 3;
      pose(d, x0 + (dx - x0) * e, y0 + (dy - y0) * e);
      if (k < 1 && !gone) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  }

  function back(d, why) {
    glide(d, 0, 0, 200, () => {
      if (d.sent) send({ id: d.id, end: true }, true);
      d.el.classList.remove("sling-drag", "sling-armed");
      area.classList.remove("sling-armed");
      d.el.style.transform = "";
      d.el.style.visibility = "";
      drag = null;
      if (typeof why === "string" && why) ctx.toast?.(why);
    });
  }

  const down = (e) => {
    const el = e.target.closest("[data-sling]");
    if (!el || drag || !area.contains(el)) return;
    e.preventDefault();
    el.setPointerCapture?.(e.pointerId);
    el.classList.add("sling-drag");
    const ok = o.canSling(el.dataset.sling);
    drag = { el, id: el.dataset.sling, pid: e.pointerId, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, a: 0, f: 0, h: el.offsetHeight, sent: false, blocked: ok !== true, why: ok, samples: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }] };
    ctx.vibrate?.(8);
  };
  const move = (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    drag.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 90) drag.samples.shift();
    pose(drag, e.clientX - drag.sx, e.clientY - drag.sy);
  };
  const up = (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag;
    const s = d.samples, a = s[0], b = s.at(-1), dt = Math.max(1, b.t - a.t);
    const vy = (b.y - a.y) / dt, vx = (b.x - a.x) / dt;
    const pushed = d.f >= o.threshold || (vy < -o.flick && d.f > 0.02);
    // Let go above the line (D-193): played toward the middle.
    const out = pushed || !!d.armed;
    if (!out || d.blocked) return back(d, d.blocked ? d.why : "");
    area.classList.remove("sling-armed");
    const { x } = measure(d);
    const lean = x + vx * 0.6;
    const direction = !pushed ? "middle" : lean < -0.35 ? "left" : lean > 0.35 ? "right" : "middle";
    // Out it goes: off the top while its last poses reach the board, then the move.
    const box = area.getBoundingClientRect(), r = d.el.getBoundingClientRect();
    // From above the line it goes straight up and off; pushed out, it keeps its sideways drift.
    glide(d, pushed ? d.dx + vx * 40 : d.dx * 0.5, d.dy - (r.bottom - box.top) - 6, pushed ? Math.max(70, 160 * (1 - d.f)) : 220, async () => {
      send({ id: d.id, f: 1, x: measure(d).x, a: d.a, ...(o.reveal === "drag" && o.item ? { item: o.item(d.id) } : {}) }, true);
      d.el.style.visibility = "hidden";
      ctx.vibrate?.(20);
      let ok = false;
      try {
        ok = !!(await o.onSling?.(d.id, { direction }));
      } catch {}
      if (gone) return;
      if (ok) {
        drag = null; // the game re-renders without it
      } else {
        d.el.style.visibility = "";
        back(d);
      }
    });
  };
  area.addEventListener("pointerdown", down);
  area.addEventListener("pointermove", move);
  area.addEventListener("pointerup", up);
  area.addEventListener("pointercancel", up);

  return {
    /** True while something is being dragged or slung: re-render the hand after it (`whenFree`). */
    busy: () => !!drag,
    /**
     * Let `el` (just drawn, already in place) come in at the top of the area, after the board has thrown it this
     * way. Call it after rendering the new element.
     */
    receive(el, { delay } = {}) {
      if (!el) return;
      const k = o.speed() || 1;
      const box = area.getBoundingClientRect(), r = el.getBoundingClientRect();
      el.animate(
        [{ transform: `translateY(${box.top - r.bottom - 10}px) rotate(-8deg)` }, { transform: "none" }],
        { duration: SLING_MS.receive * k, delay: delay ?? SLING_MS.receiveDelay * k, easing: "cubic-bezier(.2,.8,.3,1)", fill: "backwards" },
      );
    },
    destroy() {
      gone = true;
      cancelAnimationFrame(raf);
      area.removeEventListener("pointerdown", down);
      area.removeEventListener("pointermove", move);
      area.removeEventListener("pointerup", up);
      area.removeEventListener("pointercancel", up);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------------------------------------------

/**
 * The board's side: things coming in at each seat's edge of the board (above the seat plates), and flights.
 *
 * opts:
 * - `render(item, { back })`: the thing's markup, `size.w` × `size.h` board pixels; `item` is null for the back.
 * - `size`: `{ w, h }` on the board (default 120 × 180, a playing card).
 * - `speed()`: 1 = normal; 1.5 is half as fast again.
 * - `spread` (160): how far the phone's left-right position moves the thing along the edge.
 */
export function slingBoard(root, opts = {}) {
  const o = { size: { w: 120, h: 180 }, speed: () => 1, spread: 160, ...opts };
  const { w: CW, h: CH } = o.size;
  const layer = document.createElement("div");
  layer.className = "sling-layer";
  layer.style.cssText = "position:absolute;inset:0;z-index:30;pointer-events:none;overflow:hidden";
  root.appendChild(layer);
  const slots = new Map();
  let info = null, raf = 0, gone = false;
  const k = () => o.speed() || 1;

  /** Where a seat's edge is: the point on the board's edge in front of the seat, turned to face it. */
  function edgeAt(seat) {
    const at = info?.seatPositions?.[seat];
    if (!at) return null;
    const W = 1920, H = 1080;
    const p = at.edge === "south" ? { x: at.x, y: H } : at.edge === "north" ? { x: at.x, y: 0 } : at.edge === "east" ? { x: W, y: at.y } : { x: 0, y: at.y };
    return { ...p, rot: at.rot };
  }

  /** The thing's centre and angle on the board for a slot pose (f: share out, x: −1…1 along the edge, a: tilt). */
  function pose(seat, f, x, a = 0) {
    const e = edgeAt(seat);
    const lx = x * o.spread, ly = -f * CH + CH / 2;
    const r = (e.rot * Math.PI) / 180;
    return { x: e.x + lx * Math.cos(r) - ly * Math.sin(r), y: e.y + lx * Math.sin(r) + ly * Math.cos(r), angle: e.rot + a };
  }

  function slot(seat) {
    let s = slots.get(seat);
    if (s) return s;
    const e = edgeAt(seat);
    if (!e) return null;
    const el = document.createElement("div");
    el.style.cssText = `position:absolute;left:${e.x}px;top:${e.y}px;width:0;height:0;transform:rotate(${e.rot}deg);transform-origin:0 0`;
    el.innerHTML = `<div style="position:absolute;left:${-o.spread - CW}px;width:${2 * (o.spread + CW)}px;top:${-CH * 1.2}px;height:${CH * 1.2}px;overflow:hidden">
      <div class="sling-item" style="position:absolute;left:0;top:0;width:${CW}px;height:${CH}px;visibility:hidden;will-change:transform;filter:drop-shadow(0 6px 10px rgba(0,0,0,.45))"></div></div>`;
    layer.appendChild(el);
    s = { el, item: el.querySelector(".sling-item"), f: 0, x: 0, a: 0, tf: 0, tx: 0, ta: 0, key: "", id: null };
    slots.set(seat, s);
    return s;
  }
  const show = (s, key, markup) => s.key !== key && ((s.key = key), (s.item.innerHTML = markup));

  // One loop eases every slot toward its latest gesture, so 30–60 messages a second look smooth.
  function tick() {
    raf = 0;
    let moving = false;
    for (const s of slots.values()) {
      for (const [v, t] of [["f", "tf"], ["x", "tx"], ["a", "ta"]]) {
        s[v] += (s[t] - s[v]) * 0.5;
        if (Math.abs(s[t] - s[v]) < 0.002) s[v] = s[t];
        else moving = true;
      }
      s.item.style.transform = `translate(${o.spread + s.x * o.spread}px, ${CH * 0.2 + (1 - s.f) * CH}px) rotate(${s.a}deg)`;
      s.item.style.visibility = s.f > 0.001 ? "visible" : "hidden";
    }
    if (moving && !gone) raf = requestAnimationFrame(tick);
  }
  const kick = () => (raf ||= requestAnimationFrame(tick));

  /** A flying element from one pose to another; resolves when it lands (and is removed). */
  function flight(markup, from, to, ms, { fadeIn = false } = {}) {
    const el = document.createElement("div");
    el.className = "sling-flight";
    el.style.cssText = `position:absolute;left:0;top:0;width:${CW}px;height:${CH}px;will-change:transform;filter:drop-shadow(0 8px 14px rgba(0,0,0,.5))`;
    el.innerHTML = markup;
    layer.appendChild(el);
    let turn = to.angle - from.angle;
    turn = ((((turn + 180) % 360) + 360) % 360) - 180;
    const t = (p, a, sc = 1) => `translate(${p.x - CW / 2}px,${p.y - CH / 2}px) rotate(${a}deg) scale(${sc})`;
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const anim = el.animate(
      [
        { transform: t(from, from.angle), opacity: fadeIn ? 0 : 1 },
        { transform: t(mid, from.angle + turn * 0.6, 1.12), opacity: 1, offset: 0.45 },
        { transform: t(to, from.angle + turn, to.scale ?? 1), opacity: 1 },
      ],
      { duration: ms, easing: "cubic-bezier(.25,.7,.3,1)", fill: "forwards" },
    );
    return new Promise((resolve) => (anim.onfinish = anim.oncancel = () => (el.remove(), resolve())));
  }
  const flyMs = (from, to) => k() * clamp(SLING_MS.flyMin + Math.hypot(to.x - from.x, to.y - from.y) * SLING_MS.flyPerPx, SLING_MS.flyMin, SLING_MS.flyMax);

  return {
    /** Call from the game's `update` so the seats' places are current. */
    info(i) {
      info = i;
    },
    /** Call from the game's `gesture(seat, data)` hook. */
    gesture(seat, d) {
      const s = slot(seat);
      if (!s || !d) return;
      if (d.end) s.tf = 0;
      else {
        if (s.id !== d.id) ((s.id = d.id), (s.f = 0));
        show(s, d.item ? `i:${JSON.stringify(d.item)}` : "back", o.render(d.item ?? null, { back: !d.item }));
        s.tf = clamp(Number(d.f) || 0, 0, 1);
        s.tx = clamp(Number(d.x) || 0, -1, 1);
        s.ta = clamp(Number(d.a) || 0, -15, 15);
      }
      kick();
    },
    /**
     * The move was made: fly `item` face up from the seat (from where the player's drag left it, when `id` matches)
     * to `to` = { x, y, angle, scale? }. Resolves when it lands, for the game to draw it in place.
     */
    fly(seat, { id = null, item, to }) {
      const s = slot(seat);
      if (!s) return Promise.resolve();
      const live = id !== null && String(s.id) === String(id) && s.f > 0.05;
      const from = live ? pose(seat, s.f, s.x, s.a) : pose(seat, 0.55, 0);
      s.f = s.tf = 0;
      s.id = null;
      s.item.style.visibility = "hidden";
      return flight(o.render(item, { back: false }), from, to, flyMs(from, to), { fadeIn: !live });
    },
    /** Throw an item (null: its back) from `from` = { x, y, angle } to a seat, where it slips off the board's edge. */
    async toSeat(seat, { item = null, from }) {
      const s = slot(seat);
      if (!s) return;
      const to = pose(seat, 1, 0);
      await flight(o.render(item, { back: !item }), from, to, SLING_MS.toSeat * k());
      show(s, item ? `i:${JSON.stringify(item)}` : "back", o.render(item, { back: !item }));
      s.id = null;
      s.x = s.tx = s.a = s.ta = 0;
      s.f = 1;
      s.tf = 0;
      kick();
    },
    /** A flight between any two poses on the board (a die rolling to its place, a card moving between piles). */
    flight: (markup, from, to, ms) => flight(markup, from, to, ms ?? flyMs(from, to)),
    /** Where a seat's edge is ({ x, y, rot }), for games that throw things there themselves. */
    edgeAt,
    destroy() {
      gone = true;
      cancelAnimationFrame(raf);
      layer.remove();
    },
  };
}
