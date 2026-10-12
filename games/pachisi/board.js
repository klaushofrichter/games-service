// Pachisi board UI: the cross-shaped race track, tokens that glide between cells, and a big die.
import { esc, html, remainingMs, seatColor, seatPlates, useStyles } from "/shared/board-kit.js";

const CELL = 70; // grid cell size in px; the board is 11 × 11 cells
const FINISH = 44;
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
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

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

export function mount(root) {
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

  const tick = setInterval(() => {
    const ms = view && !view.over ? remainingMs(info, "turn") : null;
    box.querySelector(".pc-clock").textContent = ms === null ? "" : `${Math.ceil(ms / 1000)} s`;
  }, 250);

  function build(players) {
    const key = players.map((p) => `${p.seat}:${p.side}:${p.tokens.length}`).join("|");
    if (key === built) return;
    built = key;
    board.innerHTML = "";
    tokens.clear();
    const owner = Object.fromEntries(players.map((p) => [p.side, p]));
    for (let side = 0; side < 4; side++) {
      const p = owner[side];
      const [qx, qy] = QUAD[side];
      const base = html(`<div class="pc-base ${p ? "" : "empty"}" style="left:${qx * CELL}px;top:${qy * CELL}px;--c:${p ? seatColor(p.seat) : "#333"}">${p ? `<div class="pc-label">${esc(p.name)}</div>` : ""}</div>`);
      board.appendChild(base);
      for (let j = 0; j < 4; j++) {
        const [x, y] = homeXY(side, j);
        board.appendChild(html(`<div class="pc-cell home" style="left:${x * CELL}px;top:${y * CELL}px;--c:${p ? seatColor(p.seat) : "#777"}"></div>`));
      }
    }
    for (let idx = 0; idx < 40; idx++) {
      const [x, y] = trackXY(idx);
      const side = [6, 16, 26, 36].indexOf(idx);
      const p = side >= 0 ? owner[side] : null;
      board.appendChild(html(`<div class="pc-cell ${p ? "start" : ""} ${side >= 0 ? "safe" : ""}" style="left:${x * CELL}px;top:${y * CELL}px;--c:${p ? seatColor(p.seat) : ""}"></div>`));
    }
    board.appendChild(html(`<div class="pc-center"></div>`));
    for (const p of players) {
      p.tokens.forEach((_, i) => {
        const t = html(`<div class="pc-token" style="--c:${seatColor(p.seat)}">${i + 1}</div>`);
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
        el.classList.toggle("can", v.phase === "move" && p.seat === v.turn && !v.over && canMove(p.tokens[i], v.die));
      });
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
      place(v);
      const rolled = events.find((e) => e.name === "rolled");
      showDie(v.die ?? rolled?.data.die ?? null, !!rolled);

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
        turnEl.innerHTML = `<span style="color:${seatColor(v.turn)}">${esc(name(v.turn))}</span>`;
        box.querySelector(".pc-hint").textContent = v.phase === "roll" ? "Roll the die on your phone" : `Rolled ${v.die} · choose a token`;
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
