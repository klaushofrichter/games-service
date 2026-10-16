// Pachisi board UI: the cross-shaped race track, tokens that glide between cells, and a big die. Sounds for rolling,
// moving, a six and a capture; the player whose turn it is may tap a token on the board instead of the phone (D-102).
import { esc, html, ping, playerColor, playSound, remainingMs, seatPlates, useStyles } from "/shared/board-kit.js";

/**
 * What a token shows (D-102, D-109): an icon per token (the default), or its number with the "Numbers" setting; the same set for
 * every player; the token keeps the player's colour. The deck imports this too, so both show the same pieces.
 */
export const PIECE_ICONS = [
  ["smiley", '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="8.8" cy="9.8" r="1.5" fill="currentColor"/><circle cx="15.2" cy="9.8" r="1.5" fill="currentColor"/><path d="M7.6 13.8a5 5 0 0 0 8.8 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'],
  ["star", '<path d="M12 2.6l2.8 6.1 6.6.7-5 4.5 1.4 6.5L12 17.1l-5.8 3.3 1.4-6.5-5-4.5 6.6-.7z" fill="currentColor"/>'],
  ["bullseye", '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="5.2" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="1.9" fill="currentColor"/>'],
  ["moon", '<path d="M15.2 3.2a9 9 0 1 0 5.6 15.2A7.4 7.4 0 0 1 15.2 3.2z" fill="currentColor"/>'],
];
export const iconsOn = (prefs) => prefs?.pieces !== "numbers"; // icons unless numbers were chosen (D-109)
/** The inside of token i (0-based): its number, or its icon at `size` px. */
export function pieceFace(i, prefs, size = 26) {
  if (!iconsOn(prefs)) return String(i + 1);
  const [name, svg] = PIECE_ICONS[i % PIECE_ICONS.length];
  return `<svg class="pc-icon" data-icon="${name}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${svg}</svg>`;
}
export const pieceName = (i, prefs) => (iconsOn(prefs) ? PIECE_ICONS[i % PIECE_ICONS.length][0] : `token ${i + 1}`);

// ---------- sounds (Web Audio, made here: no files to load) ----------
let noiseBuf = null;
function noise(ctx) {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
  return noiseBuf;
}
/** A short filtered noise burst: one die knocking on wood, or one footstep of a token. */
function knock(ctx, out, t, { freq = 1800, q = 3, gain = 0.5, decay = 0.05 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 0.4);
  src.stop(t + decay + 0.02);
}
function tone(ctx, out, t, { from, to = from, dur, gain = 0.3, type = "sine" }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}
/** The die rattling in a cup and tumbling out: knocks coming faster, then slowing to a stop (matches the 0.6 s spin). */
export const ROLL_MS = 600;
function rollSound(ctx, t, out) {
  const hits = [0, 0.05, 0.09, 0.14, 0.2, 0.27, 0.35, 0.44, 0.54];
  hits.forEach((at, k) => knock(ctx, out, t + at, { freq: 1400 + ((k * 397) % 900), gain: 0.55 - k * 0.04, decay: 0.045 }));
  knock(ctx, out, t + 0.58, { freq: 700, q: 1.5, gain: 0.5, decay: 0.09 }); // it lands
}
/** A six: a bright rising chime once the die has landed. */
function sixSound(ctx, t, out) {
  [1568, 1976, 2349, 3136].forEach((f, k) => ping(ctx, out, t + k * 0.07, { freq: f, partials: [1, 2.01], decay: 0.35 - k * 0.04, gain: 0.22 }));
}
/** A token hopping cell by cell: one soft wooden step per cell. */
function moveSound(steps) {
  return (ctx, t, out) => {
    const n = Math.max(1, Math.min(steps, 6));
    const gap = Math.min(0.09, 0.5 / n);
    for (let k = 0; k < n; k++) {
      knock(ctx, out, t + k * gap, { freq: 900, q: 4, gain: 0.35, decay: 0.035 });
      tone(ctx, out, t + k * gap, { from: 520 + k * 25, to: 330, dur: 0.06, gain: 0.12 });
    }
  };
}
/** A token sent back to its start: a falling slide and a bump. */
function captureSound(ctx, t, out) {
  tone(ctx, out, t, { from: 880, to: 140, dur: 0.55, gain: 0.28, type: "triangle" });
  tone(ctx, out, t + 0.02, { from: 660, to: 110, dur: 0.5, gain: 0.12, type: "square" });
  knock(ctx, out, t + 0.5, { freq: 260, q: 1, gain: 0.7, decay: 0.16 });
}

const CELL = 70; // grid cell size in px; the board is 11 × 11 cells
export const FINISH = 44;
const startCell = (side) => side * 10 + 6;
const cellOf = (side, p) => (p >= 0 && p < 40 ? (startCell(side) + p) % 40 : null);
function trackXY(idx) {
  if (idx < 10) return [idx, 0];
  if (idx < 20) return [10, idx - 10];
  if (idx < 30) return [30 - idx, 10];
  return [0, 40 - idx];
}
const homeXY = (side, j) => [[5, 1 + j], [9 - j, 5], [5, 9 - j], [1 + j, 5]][side];
const QUAD = [[6, 1], [6, 6], [1, 6], [1, 1]]; // base quadrant (top-left cell) per side
export const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

/** Pixel center of a token, in board coordinates. */
function tokenXY(side, p, i) {
  if (p === -1) {
    const [qx, qy] = QUAD[side];
    return [(qx + 1 + (i % 2) * 2) * CELL, (qy + 1 + Math.floor(i / 2) * 2) * CELL - 12];
  }
  if (p === FINISH) {
    const off = [[0, -14], [14, 0], [0, 14], [-14, 0]][side];
    return [5.5 * CELL + off[0] + (i - 1.5) * 4, 5.5 * CELL + off[1]];
  }
  const [x, y] = p < 40 ? trackXY(cellOf(side, p)) : homeXY(side, p - 40);
  return [(x + 0.5) * CELL, (y + 0.5) * CELL];
}

const canMove = (p, die) => (p === -1 ? die === 6 : p !== FINISH && p + die <= FINISH);

/** What Pachisi adds to the board's settings (D-088): the pieces, numbers or icons. Player colours are the table's (D-106). */
export function settings({ info, setPrefs }) {
  return [
    {
      type: "choice",
      label: "Pieces",
      value: iconsOn(info.prefs) ? "icons" : "numbers",
      options: [{ value: "numbers", label: "Numbers" }, { value: "icons", label: "Icons" }],
      onChange: (v) => setPrefs({ pieces: v }),
    },
  ];
}

export function mount(root, ctx = {}) {
  useStyles("/games/pachisi/board.css");
  const box = html(`<div class="pc-root"><div class="pc-wrap">
    <div class="pc-board"></div>
    <div class="pc-side left"><div class="pc-die">${"<i></i>".repeat(9)}</div><div class="pc-turn"></div><div class="pc-hint"></div><div class="pc-clock"></div></div>
    <div class="pc-side right"><div class="eyebrow" style="font-size:20px;margin-bottom:10px">Last moves</div><div class="pc-log"></div></div>
  </div></div>`);
  root.appendChild(box);
  const board = box.querySelector(".pc-board");
  const tokens = new Map(); // "seat:i" -> element
  const log = [];
  let built = "";
  let info = null;
  let view = null;
  let sent = false; // a tap is on its way; ignore more until the next update

  // Tapping a token moves it, for the player whose turn it is if this board may act for them (D-102).
  // The nearest movable token within reach of the finger wins, so a token sharing a cell with someone else's (drawn on
  // top of it) or bobbing away from the finger still answers.
  const REACH = 48; // screen px from the token's centre
  function tokenAt(x, y) {
    let best = null;
    let bestD = Infinity;
    for (const t of board.querySelectorAll(".pc-token.tap")) {
      const r = t.getBoundingClientRect();
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (d < bestD) [best, bestD] = [t, d];
    }
    const scale = best ? best.getBoundingClientRect().width / 46 : 1; // the board is scaled to the screen
    return bestD <= REACH * Math.max(scale, 0.5) ? best : null;
  }
  board.addEventListener("click", (e) => {
    const t = tokenAt(e.clientX, e.clientY);
    if (!t || sent || !ctx.act) return;
    sent = true;
    t.classList.add("sent");
    ctx.act(Number(t.dataset.seat), "move", { token: Number(t.dataset.token) }).then((r) => {
      if (!r.ok) {
        sent = false;
        t.classList.remove("sent");
      }
    });
  });

  const tick = setInterval(() => {
    const ms = view && !view.over ? remainingMs(info, "turn") : null;
    box.querySelector(".pc-clock").textContent = ms === null ? "" : `${Math.ceil(ms / 1000)} s`;
  }, 250);

  function build(players) {
    const key = players.map((p) => `${p.seat}:${p.side}:${p.tokens.length}:${playerColor(info, p.seat)}`).join("|") + (iconsOn(info.prefs) ? ":icons" : "");
    if (key === built) return;
    built = key;
    board.innerHTML = "";
    tokens.clear();
    const owner = Object.fromEntries(players.map((p) => [p.side, p]));
    for (let side = 0; side < 4; side++) {
      const p = owner[side];
      const [qx, qy] = QUAD[side];
      const base = html(`<div class="pc-base ${p ? "" : "empty"}" style="left:${qx * CELL}px;top:${qy * CELL}px;--c:${p ? playerColor(info, p.seat) : "#333"}">${p ? `<div class="pc-label">${esc(p.name)}</div>` : ""}</div>`);
      board.appendChild(base);
      for (let j = 0; j < 4; j++) {
        const [x, y] = homeXY(side, j);
        board.appendChild(html(`<div class="pc-cell home" style="left:${x * CELL}px;top:${y * CELL}px;--c:${p ? playerColor(info, p.seat) : "#777"}"></div>`));
      }
    }
    for (let idx = 0; idx < 40; idx++) {
      const [x, y] = trackXY(idx);
      const side = [6, 16, 26, 36].indexOf(idx);
      const p = side >= 0 ? owner[side] : null;
      board.appendChild(html(`<div class="pc-cell ${p ? "start" : ""} ${side >= 0 ? "safe" : ""}" style="left:${x * CELL}px;top:${y * CELL}px;--c:${p ? playerColor(info, p.seat) : ""}"></div>`));
    }
    board.appendChild(html(`<div class="pc-center"></div>`));
    for (const p of players) {
      p.tokens.forEach((_, i) => {
        const t = html(`<div class="pc-token" data-seat="${p.seat}" data-token="${i}" style="--c:${playerColor(info, p.seat)}" aria-label="${esc(p.name)}: ${pieceName(i, info.prefs)}">${pieceFace(i, info.prefs)}</div>`);
        board.appendChild(t);
        tokens.set(`${p.seat}:${i}`, t);
      });
    }
  }

  function place(v) {
    // Spread tokens that share a cell so all stay visible.
    const groups = {};
    for (const p of v.players) p.tokens.forEach((pos, i) => {
      const [x, y] = tokenXY(p.side, pos, i);
      const k = pos === -1 || pos === FINISH ? `${p.seat}:${i}` : `${Math.round(x)},${Math.round(y)}`;
      (groups[k] ??= []).push({ p, i, x, y });
    });
    for (const g of Object.values(groups)) {
      g.forEach(({ p, i, x, y }, k) => {
        const dx = g.length > 1 ? (k - (g.length - 1) / 2) * 16 : 0;
        const el = tokens.get(`${p.seat}:${i}`);
        el.style.transform = `translate(${x + dx}px, ${y - (g.length > 1 ? k * 4 : 0)}px)`;
        const can = v.phase === "move" && p.seat === v.turn && !v.over && canMove(p.tokens[i], v.die);
        el.classList.toggle("can", can);
        el.classList.toggle("tap", can && !!ctx.act && (info.controlSeats ?? []).includes(p.seat));
        el.classList.remove("sent");
      });
    }
  }

  // One sound per event, in the order things happen: the roll (and a six once it lands), then the move and a capture.
  function sounds(events) {
    let at = 0;
    for (const e of events) {
      if (e.name === "rolled") {
        playSound(info, "pachisi-roll", rollSound);
        if (e.data.die === 6) setTimeout(() => playSound(info, "pachisi-six", sixSound), ROLL_MS);
        at = ROLL_MS;
      } else if (e.name === "moved") {
        const { from, to, captured } = e.data;
        const steps = from === -1 ? 1 : to - from;
        setTimeout(() => playSound(info, "pachisi-move", moveSound(steps)), at);
        if (captured.length) setTimeout(() => playSound(info, "pachisi-capture", captureSound), at + 380);
      }
    }
  }

  let lastDie = null;
  function showDie(n, animate) {
    const die = box.querySelector(".pc-die");
    // Between turns keep the previous roll visible, dimmed.
    die.style.opacity = n ? 1 : 0.35;
    if (n) lastDie = n;
    n = n ?? lastDie;
    die.querySelectorAll("i").forEach((pip, k) => (pip.style.visibility = n && PIPS[n].includes(k) ? "visible" : "hidden"));
    if (animate) {
      die.classList.remove("rolling");
      void die.offsetWidth;
      die.classList.add("rolling");
    }
  }

  return {
    update(v, events, i) {
      view = v;
      info = i;
      box.querySelector(".pc-wrap").style.transform = `rotate(${i.rotation}deg)`;
      build(v.players);
      sent = false;
      place(v);
      const rolled = events.find((e) => e.name === "rolled");
      showDie(v.die ?? rolled?.data.die ?? null, !!rolled);
      sounds(events);

      const name = (seat) => v.players.find((p) => p.seat === seat)?.name ?? "?";
      for (const e of events) {
        if (e.name === "rolled") log.unshift(`${esc(name(e.data.seat))} rolled ${e.data.die}`);
        if (e.name === "noMove") log.unshift(`${esc(name(e.data.seat))} cannot move`);
        if (e.name === "threeSixes") log.unshift(`${esc(name(e.data.seat))}: three sixes, turn lost`);
        for (const c of e.name === "moved" ? e.data.captured : []) log.unshift(`<b>${esc(name(e.data.seat))}</b> sends ${esc(name(c.seat))} back to start`);
      }
      log.length = Math.min(log.length, 7);
      box.querySelector(".pc-log").innerHTML = log.map((l) => `<div>${l}</div>`).join("");

      const turnEl = box.querySelector(".pc-turn");
      if (v.over) {
        turnEl.innerHTML = v.winner === null ? "Game over" : `${esc(name(v.winner))} wins!`;
        box.querySelector(".pc-hint").textContent = "";
      } else {
        turnEl.innerHTML = `<span style="color:${playerColor(i, v.turn)}">${esc(name(v.turn))}</span>`;
        const tap = v.phase === "move" && !!ctx.act && (i.controlSeats ?? []).includes(v.turn);
        box.querySelector(".pc-hint").textContent = v.phase === "roll" ? "Roll the die on your phone" : `Rolled ${v.die} · ${tap ? "tap a token to move it" : "choose a token"}`;
      }
      seatPlates(root, i, (seat) => {
        const p = v.players.find((x) => x.seat === seat);
        if (!p) return "";
        const home = p.tokens.filter((x) => x === FINISH).length;
        return `${home} of ${p.tokens.length} home${seat === v.turn && !v.over ? " · your turn" : ""}`;
      }, { active: v.over ? v.winner : v.turn });
    },
    destroy() {
      clearInterval(tick);
    },
  };
}
