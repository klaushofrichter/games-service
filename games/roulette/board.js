// Roulette board UI: a spinning European wheel and the betting layout with everyone's chips.
import { html, ping, playerColor, playSound, remainingMs, seatPlates, svg, useStyles } from "/shared/board-kit.js";

const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const color = (n) => (n === 0 ? "green" : RED.has(n) ? "red" : "black");
const STEP = 360 / 37;
const short = (n) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));

// ---------- sounds (Web Audio, made here: no files to load; they follow the table's sound setting, D-092) ----------
let noiseBuf = null;
function noise(ctx) {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
  return noiseBuf;
}
/** Filtered noise with a quick attack: `from`→`to` sweeps the filter, a fixed one knocks. */
function burst(ctx, out, t, { from, to = from, q = 1, type = "bandpass", dur, gain }) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  if (to !== from) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 0.4);
  src.stop(t + dur + 0.02);
}
/** One clay chip set down on the felt: a dry click with a short ring. */
function clack(ctx, out, t, gain = 0.45) {
  burst(ctx, out, t, { from: 3300 + Math.random() * 600, q: 7, dur: 0.03, gain });
  ping(ctx, out, t, { freq: 4300 + Math.random() * 500, partials: [1, 1.71], decay: 0.06, gain: gain * 0.25 });
}
/** A bet: the chip lands, then a second one taps it. */
const betSound = (ctx, t, out) => {
  clack(ctx, out, t, 0.42);
  clack(ctx, out, t + 0.055, 0.22);
};
/** A player takes their chips back: a soft slide and a click as the stack is picked up. */
const clearSound = (ctx, t, out) => {
  burst(ctx, out, t, { from: 1800, to: 700, q: 0.8, dur: 0.22, gain: 0.2 });
  clack(ctx, out, t + 0.2, 0.25);
};
/** "Place your bets": two soft bell tones. */
const openSound = (ctx, t, out) => {
  ping(ctx, out, t, { freq: 1046, partials: [1, 2.01, 3.0], decay: 0.9, gain: 0.22 });
  ping(ctx, out, t + 0.18, { freq: 1318, partials: [1, 2.01, 3.0], decay: 1.1, gain: 0.22 });
};
/** The last seconds to bet: a quiet tick per second. */
const tickSound = (ctx, t, out) => burst(ctx, out, t, { from: 2400, q: 9, dur: 0.025, gain: 0.18 });
const SPIN_S = 5.2; // as .rl-spin's transition in board.css
/**
 * The spin, timed to the wheel's 5.2 s ease-out: the wheel's rumble dying away, the ball running fast round the rim
 * and slowing, dropping onto the frets and bouncing pocket to pocket, then settling as the number is revealed.
 */
const spinSound = (ctx, t, out) => {
  // The wheel turning on its bearing: low, looping noise that fades as it slows.
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(900, t);
  f.frequency.exponentialRampToValueAtTime(160, t + SPIN_S);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t + SPIN_S);
  src.connect(f).connect(g).connect(out);
  src.start(t);
  src.stop(t + SPIN_S + 0.05);
  // The ball rolling round the rim: a fine rattle, ever slower.
  for (let at = 0.05, gap = 0.03; at < 3.6; at += gap, gap *= 1.045) {
    burst(ctx, out, t + at, { from: 5200 + Math.random() * 800, q: 4, dur: 0.012, gain: 0.05 + 0.06 * (at / 3.6) });
  }
  // It drops onto the deflectors and bounces from pocket to pocket.
  [[3.75, 0.5], [4.05, 0.38], [4.32, 0.3], [4.55, 0.22], [4.74, 0.16], [4.9, 0.11], [5.02, 0.08]].forEach(([at, gain]) =>
    clack(ctx, out, t + at + Math.random() * 0.03, gain));
};
/** The number shown: a bright chime, a little fanfare when someone won. */
function revealSound(anyWin) {
  return (ctx, t, out) => {
    const notes = anyWin ? [784, 988, 1175, 1568] : [880];
    notes.forEach((freq, k) => ping(ctx, out, t + k * 0.11, { freq, partials: [1, 2.01, 3.0], decay: 0.8, gain: 0.2 }));
  };
}

// Betting layout geometry (SVG units).
const CW = 66, CH = 82, ZW = 70, TOP = 10, LEFT = 10;
const ROWS_Y = (r) => TOP + r * CH; // r = 0 top row (3,6,…) … 2 bottom row (1,4,…)
const numberCell = (n) => {
  const col = Math.ceil(n / 3) - 1;
  const row = 2 - ((n - 1) % 3);
  return { x: LEFT + ZW + col * CW, y: ROWS_Y(row), w: CW, h: CH };
};
/** The layout cell a bet sits on, as the rect's data-key: "straight:17", "dozen:2", "red". */
const cellKey = (bet) => (bet.type === "straight" || bet.target ? `${bet.type}:${bet.target}` : bet.type);
const DOZ_Y = TOP + 3 * CH, DOZ_H = 70, EVEN_Y = DOZ_Y + DOZ_H, EVEN_H = 70;
function cellFor(bet) {
  switch (bet.type) {
    case "straight":
      return bet.target === 0 ? { x: LEFT, y: TOP, w: ZW, h: 3 * CH } : numberCell(bet.target);
    case "column":
      return { x: LEFT + ZW + 12 * CW, y: ROWS_Y(3 - bet.target), w: CW, h: CH };
    case "dozen":
      return { x: LEFT + ZW + (bet.target - 1) * 4 * CW, y: DOZ_Y, w: 4 * CW, h: DOZ_H };
    default: {
      const i = ["low", "even", "red", "black", "odd", "high"].indexOf(bet.type);
      return { x: LEFT + ZW + i * 2 * CW, y: EVEN_Y, w: 2 * CW, h: EVEN_H };
    }
  }
}
const OUTSIDE = [
  { type: "low", label: "1 to 18" },
  { type: "even", label: "EVEN" },
  { type: "red", label: "" },
  { type: "black", label: "" },
  { type: "odd", label: "ODD" },
  { type: "high", label: "19 to 36" },
];

function wins(bet, n) {
  switch (bet.type) {
    case "straight": return bet.target === n;
    case "red": return color(n) === "red";
    case "black": return color(n) === "black";
    case "odd": return n !== 0 && n % 2 === 1;
    case "even": return n !== 0 && n % 2 === 0;
    case "low": return n >= 1 && n <= 18;
    case "high": return n >= 19;
    case "dozen": return n !== 0 && Math.ceil(n / 12) === bet.target;
    case "column": return n !== 0 && ((n - 1) % 3) + 1 === bet.target;
  }
}

function buildWheel() {
  const s = svg("svg", { viewBox: "0 0 600 600", class: "rl-wheel" });
  const defs = svg("defs", {}, s);
  const wood = svg("radialGradient", { id: "rl-wood" }, defs);
  svg("stop", { offset: "70%", "stop-color": "#5a3417" }, wood);
  svg("stop", { offset: "100%", "stop-color": "#2b170a" }, wood);
  const cone = svg("radialGradient", { id: "rl-cone", cx: "40%", cy: "35%" }, defs);
  svg("stop", { offset: "0%", "stop-color": "#f3d48a" }, cone);
  svg("stop", { offset: "100%", "stop-color": "#7a5414" }, cone);
  svg("circle", { cx: 300, cy: 300, r: 298, fill: "url(#rl-wood)" }, s);
  const spin = svg("g", { class: "rl-spin" }, s);
  const R1 = 268, R0 = 205;
  ORDER.forEach((n, i) => {
    const a0 = ((i - 0.5) * STEP - 90) * (Math.PI / 180);
    const a1 = ((i + 0.5) * STEP - 90) * (Math.PI / 180);
    const p = (r, a) => `${300 + r * Math.cos(a)} ${300 + r * Math.sin(a)}`;
    svg("path", {
      d: `M ${p(R0, a0)} L ${p(R1, a0)} A ${R1} ${R1} 0 0 1 ${p(R1, a1)} L ${p(R0, a1)} A ${R0} ${R0} 0 0 0 ${p(R0, a0)} Z`,
      fill: n === 0 ? "#1f7a4d" : RED.has(n) ? "#a8322a" : "#141516",
      stroke: "#d6a94a",
      "stroke-width": 1.5,
    }, spin);
    const t = svg("text", {
      x: 300, y: 300 - (R1 - 22), "text-anchor": "middle", "dominant-baseline": "middle",
      transform: `rotate(${i * STEP} 300 300)`, fill: "#f3eee2", "font-size": 19, "font-weight": 700, "font-family": "var(--text)",
    }, spin);
    t.textContent = n;
  });
  svg("circle", { cx: 300, cy: 300, r: R0, fill: "#3b2410", stroke: "#d6a94a", "stroke-width": 3 }, spin);
  svg("circle", { cx: 300, cy: 300, r: 150, fill: "url(#rl-cone)" }, spin);
  for (let k = 0; k < 4; k++) svg("rect", { x: 294, y: 168, width: 12, height: 264, rx: 6, fill: "#d9b25a", transform: `rotate(${k * 45} 300 300)` }, spin);
  svg("circle", { cx: 300, cy: 300, r: 26, fill: "#f6dc98", stroke: "#7a5414", "stroke-width": 3 }, spin);
  // Fixed pointer and ball at the top of the pocket ring.
  svg("path", { d: "M 300 34 L 286 6 L 314 6 Z", fill: "#d6a94a" }, s);
  const ball = svg("circle", { cx: 300, cy: 300 - (R1 - 48), r: 11, fill: "#fbfaf6", stroke: "#999", class: "rl-ball", opacity: 0 }, s);
  return { el: s, spin, ball };
}

function buildLayout() {
  const s = svg("svg", { viewBox: `0 0 ${LEFT * 2 + ZW + 13 * CW} ${EVEN_Y + EVEN_H + 10}`, class: "rl-layout", width: "100%" });
  const cells = svg("g", {}, s);
  const add = (bet, cls, label, labelCls = "lbl") => {
    const c = cellFor(bet);
    const r = svg("rect", { x: c.x, y: c.y, width: c.w, height: c.h, rx: 6, class: `rl-cell ${cls}` }, cells);
    r.dataset.key = cellKey(bet);
    if (label) {
      const y = labelCls === "num" ? c.y + c.h / 2 : c.y + 24; // outside labels sit high so chips can sit below
      const t = svg("text", { x: c.x + c.w / 2, y, "text-anchor": "middle", "dominant-baseline": "middle", class: labelCls }, s);
      t.textContent = label;
    }
    return r;
  };
  add({ type: "straight", target: 0 }, "green", "0", "num");
  for (let n = 1; n <= 36; n++) add({ type: "straight", target: n }, color(n), String(n), "num");
  for (let c = 1; c <= 3; c++) add({ type: "column", target: c }, "out", "2 to 1");
  ["1st 12", "2nd 12", "3rd 12"].forEach((l, i) => add({ type: "dozen", target: i + 1 }, "out", l));
  for (const o of OUTSIDE) {
    const r = add({ type: o.type }, "out", o.label);
    if (o.type === "red" || o.type === "black") {
      const c = cellFor({ type: o.type });
      svg("path", { d: `M ${c.x + c.w / 2} ${c.y + 12} l 30 23 l -30 23 l -30 -23 Z`, fill: o.type === "red" ? "#a8322a" : "#141516", stroke: "#f3eee2", "stroke-width": 2 }, s);
      r.dataset.diamond = "1";
    }
  }
  const chips = svg("g", {}, s);
  return { el: s, cells, chips };
}

// The betting countdown: a ring that empties with the seconds left in its middle. Always in the status row, hidden
// when nobody can bet, so the row never changes width or height.
const CLOCK_R = 31, CLOCK_C = 2 * Math.PI * CLOCK_R;
const CLOCK = `<div class="rl-clock" ><svg viewBox="0 0 76 76" width="76" height="76">
  <circle class="track" cx="38" cy="38" r="${CLOCK_R}"/>
  <circle class="left" cx="38" cy="38" r="${CLOCK_R}" stroke-dasharray="${CLOCK_C}" stroke-dashoffset="0" transform="rotate(-90 38 38)"/>
  </svg><span class="secs"></span></div>`;

export function mount(root) {
  useStyles("/games/roulette/board.css");
  const box = html(`<div class="rl-root"><div class="rl-table">
      <div><div class="rl-wheelbox"></div><div class="rl-history"></div></div>
      <div class="rl-side"><div class="rl-status"><span class="eyebrow rl-round"></span><span class="big rl-msg"></span>${CLOCK}</div>
        <div class="rl-layoutbox"></div><div class="rl-legend"></div></div></div></div>`);
  root.appendChild(box);
  const wheel = buildWheel();
  box.querySelector(".rl-wheelbox").appendChild(wheel.el);
  const layout = buildLayout();
  box.querySelector(".rl-layoutbox").appendChild(layout.el);

  let rotation = 0;
  let shownRound = 0;
  let info = null;
  let view = null;
  let revealTimer = null;
  /** The pending reveal of the last spin (ball, number, winners), or null; and who waits for it (whenIdle, D-149). */
  let pendingReveal = null;
  const idleWaiters = [];
  function revealNow() {
    clearTimeout(revealTimer);
    const r = pendingReveal;
    pendingReveal = null;
    if (r) r();
    idleWaiters.splice(0).forEach((w) => w());
  }

  const clock = box.querySelector(".rl-clock");
  const clockLeft = clock.querySelector(".left");
  const clockSecs = clock.querySelector(".secs");
  let lastSecs = null;
  const tick = setInterval(() => {
    const ms = view?.phase === "betting" && !view.over ? remainingMs(info, "betting") : null;
    clock.classList.toggle("off", ms === null);
    if (ms === null) {
      lastSecs = null;
      return;
    }
    const total = Math.max(1000, (Number(info?.settings?.bettingSeconds) || 25) * 1000);
    const secs = Math.ceil(ms / 1000);
    clockSecs.textContent = secs;
    clockLeft.setAttribute("stroke-dashoffset", String(CLOCK_C * (1 - Math.min(1, ms / total))));
    clock.classList.toggle("hurry", ms < 6000);
    // The last five seconds tick, once each.
    if (lastSecs !== null && secs !== lastSecs && secs >= 1 && secs <= 5) playSound(info, "roulette-tick", tickSound);
    lastSecs = secs;
  }, 200);

  function spinTo(n) {
    const i = ORDER.indexOf(n);
    const target = -i * STEP;
    const delta = (((target - rotation) % 360) + 360) % 360;
    rotation += 360 * 5 + delta;
    wheel.ball.setAttribute("opacity", 0);
    wheel.spin.style.transform = `rotate(${rotation}deg)`;
  }

  /** Chips already on the layout, so a redraw drops in only the new ones. */
  let shownChips = new Set();
  function drawChips(v) {
    layout.chips.innerHTML = "";
    const perCell = {};
    for (const b of v.bets) {
      (perCell[cellKey(b)] ??= []).push(b);
    }
    const shown = new Set();
    for (const list of Object.values(perCell)) {
      list.forEach((b, k) => {
        const c = cellFor(b);
        const cols = Math.max(1, Math.floor(c.w / 34));
        const cx = c.x + c.w / 2 + ((k % cols) - (Math.min(list.length, cols) - 1) / 2) * 30;
        const inside = b.type === "straight" || b.type === "red" || b.type === "black";
        const baseY = inside ? c.y + c.h / 2 : c.y + c.h - 22;
        const cy = baseY + (Math.floor(k / cols) - (Math.ceil(list.length / cols) - 1) / 2) * 28;
        // The outer group places the chip; the inner one drops in. A CSS animation of `transform` on the placed group
        // would replace its position, and every chip would sit in the layout's corner.
        const id = `${b.seat}:${cellKey(b)}:${b.amount}:${k}`;
        shown.add(id);
        const at = svg("g", { transform: `translate(${cx} ${cy})` }, layout.chips);
        const g = svg("g", { class: `rl-chip${shownChips.has(id) ? "" : " new"}` }, at);
        // Each player's chips in their lobby colour (D-106), as on their seat plate.
        svg("circle", { r: 17, class: "face", fill: playerColor(info, b.seat) }, g);
        svg("circle", { r: 13, class: "ring" }, g);
        const t = svg("text", { "text-anchor": "middle", "dominant-baseline": "central" }, g);
        t.textContent = short(b.amount);
      });
    }
    shownChips = shown;
  }

  function markWinners(n) {
    layout.cells.querySelectorAll("rect").forEach((r) => {
      const [type, target] = r.dataset.key.split(":");
      r.classList.toggle("win", n !== null && wins({ type, target: target === undefined ? undefined : Number(target) }, n));
    });
  }

  // One sound per rules event. A burst of AI bets in one step is spread out a little, as chips are set down in turn.
  function sounds(events) {
    let at = 0;
    const later = (ms, name, make) => (ms ? setTimeout(() => playSound(info, name, make), ms) : playSound(info, name, make));
    let bets = 0;
    for (const e of events) {
      if (e.name === "betPlaced" && bets++ < 8) {
        later(at, "roulette-bet", betSound);
        at += 90;
      } else if (e.name === "betsCleared") {
        later(at, "roulette-clear", clearSound);
        at += 250;
      } else if (e.name === "bettingOpen") {
        later(at, "roulette-open", openSound);
      } else if (e.name === "wheelSpun") {
        later(at, "roulette-spin", spinSound);
      }
    }
  }

  return {
    update(v, events, i) {
      view = v;
      info = i;
      sounds(events);
      box.querySelector(".rl-table").style.transform = `rotate(${i.rotation}deg)`;
      box.querySelector(".rl-round").textContent = `Spin ${v.round} of ${v.rounds}`;
      drawChips(v);

      const spunNow = v.phase === "result" && v.last && v.last.round !== shownRound;
      if (spunNow) {
        shownRound = v.last.round;
        spinTo(v.last.number);
        markWinners(null);
        box.querySelector(".rl-msg").textContent = "No more bets";
        revealNow(); // an earlier spin still waiting: show it before this one
        const last = v.last;
        const history = v.history;
        const live = events.some((e) => e.name === "wheelSpun");
        pendingReveal = () => {
          if (live) playSound(info, "roulette-reveal", revealSound(Object.values(last.results ?? {}).some((r) => r.net > 0)));
          wheel.ball.setAttribute("opacity", 1);
          box.querySelector(".rl-msg").innerHTML = `${last.number} <span style="color:${last.color === "red" ? "#e0544a" : last.color === "green" ? "#3fbf7f" : "#cfcfcf"}">${last.color}</span>`;
          markWinners(last.number);
          renderHistory(history);
        };
        revealTimer = setTimeout(revealNow, events.some((e) => e.name === "wheelSpun") ? 5200 : 0);
      } else if (v.phase === "betting") {
        // A short result time: the next round's betting can arrive before the wheel stops. Reveal the spin at once,
        // so the reveal can't later overwrite "Place your bets".
        revealNow();
        markWinners(null);
        box.querySelector(".rl-msg").textContent = v.over ? "Game over" : "Place your bets";
        renderHistory(v.history);
      }

      const players = Object.fromEntries(v.seats.map((s) => [s.seat, s]));
      seatPlates(root, i, (seat) => {
        const s = players[seat];
        if (!s) return "joins next spin";
        const res = v.phase === "result" && v.last?.results?.[seat];
        const net = res && res.staked ? ` · <b style="color:${res.net >= 0 ? "#7fd18b" : "#e8735f"}">${res.net >= 0 ? "+" : ""}${res.net}</b>` : "";
        return `${s.balance} pts${s.staked && v.phase === "betting" ? ` · ${s.staked} on the table` : ""}${s.done && v.phase === "betting" ? " · done ✓" : ""}${net}`;
      });
      // The hint is for people: an all-AI table (a test or simulation run) has nobody to tell. Its line keeps its
      // height either way, so the layout does not move when it comes and goes.
      const people = (i.players ?? []).some((p) => p.kind === "human" && p.seat !== null);
      box.querySelector(".rl-legend").textContent = people && v.phase === "betting" && !v.over ? "Bet from your phone. Tap Done when you're finished." : "";
    },
    /** Resolves once the last spin is revealed: the platform shows Show result only then (D-134), so the final
     *  board shows the number, not "No more bets". */
    whenIdle() {
      return pendingReveal ? new Promise((r) => idleWaiters.push(r)) : Promise.resolve();
    },
    destroy() {
      clearInterval(tick);
      clearTimeout(revealTimer);
      pendingReveal = null;
      idleWaiters.splice(0).forEach((w) => w());
    },
  };

  function renderHistory(h) {
    box.querySelector(".rl-history").innerHTML = h.map((n) => `<span class="${color(n)}">${n}</span>`).join("");
  }
}
