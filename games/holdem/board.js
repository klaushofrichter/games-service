// Hold'em board UI: an oval felt with the shared cards and pot, each player's bet and face-down cards
// on the felt in front of each seat, the dealer button, and revealed hands at showdown.
import { esc, html, ping, playerColor, playSound, remainingMs, seatPlates, useStyles } from "/shared/board-kit.js";
import { card } from "/games/holdem/assets/cards.js";

const CX = 960, CY = 540; // board.css positions the felt and centre around this point

// ---------- sounds (Web Audio, made here: no files to load; they follow the table's sound setting) ----------
let noiseBuf = null;
function noise(ctx) {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
  return noiseBuf;
}
/** Filtered noise with a quick attack: `from`→`to` sweeps the filter (a card sliding), a fixed one knocks. */
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
/** One card flicked across the felt. */
const flick = (ctx, out, t, gain = 0.4) => burst(ctx, out, t, { from: 5200, to: 1800, q: 0.9, dur: 0.075, gain });
/** One clay chip landing on others: a dry click with a short ring. */
function clack(ctx, out, t, gain = 0.45) {
  burst(ctx, out, t, { from: 3300 + Math.random() * 600, q: 7, dur: 0.03, gain });
  ping(ctx, out, t, { freq: 4300 + Math.random() * 500, partials: [1, 1.71], decay: 0.06, gain: gain * 0.25 });
}
/** The riffle: two halves of quick card clicks, then the bridge settling. About 0.65 s. */
function shuffleSound(ctx, t, out) {
  for (const start of [0, 0.3]) for (let k = 0; k < 14; k++) burst(ctx, out, t + start + k * 0.016 + Math.random() * 0.005, { from: 5500, q: 2.5, dur: 0.022, gain: 0.16 });
  burst(ctx, out, t + 0.58, { from: 2600, to: 900, q: 0.7, dur: 0.12, gain: 0.22 });
}
const SHUFFLE_S = 0.7;
/** Dealing: two cards to each player in turn, then the blinds' chips. */
function dealSound(cards) {
  return (ctx, t, out) => {
    const n = Math.min(cards, 16);
    for (let k = 0; k < n; k++) flick(ctx, out, t + k * 0.075, 0.32);
    clack(ctx, out, t + n * 0.075 + 0.1, 0.35);
    clack(ctx, out, t + n * 0.075 + 0.16, 0.3);
  };
}
/** Shared cards turned onto the felt: a snap per card (three on the flop). */
function streetSound(cards) {
  return (ctx, t, out) => {
    for (let k = 0; k < cards; k++) {
      flick(ctx, out, t + k * 0.13, 0.42);
      burst(ctx, out, t + k * 0.13 + 0.06, { from: 900, q: 1.2, dur: 0.05, gain: 0.3 }); // it lands
    }
  };
}
/** Check: two knuckle taps on the felt. */
function checkSound(ctx, t, out) {
  for (const at of [0, 0.11]) burst(ctx, out, t + at, { from: 260, q: 2, type: "lowpass", dur: 0.07, gain: 0.7 });
}
/** Fold: the two cards pushed away, softly. */
function foldSound(ctx, t, out) {
  burst(ctx, out, t, { from: 3000, to: 900, q: 0.6, dur: 0.22, gain: 0.22 });
}
/** Chips pushed in: a few for a call, more for a bet or raise, a cascade for all-in. */
function chipsSound(n) {
  return (ctx, t, out) => {
    for (let k = 0; k < n; k++) clack(ctx, out, t + k * (0.045 + Math.random() * 0.02), 0.42 - Math.min(k, 6) * 0.03);
  };
}
/** The pot raked to the winner, then a small bright chime. */
function winSound(ctx, t, out) {
  burst(ctx, out, t, { from: 2400, to: 3800, q: 1.5, dur: 0.35, gain: 0.18 });
  for (let k = 0; k < 9; k++) clack(ctx, out, t + 0.05 + k * 0.035 + Math.random() * 0.015, 0.3);
  [1568, 2093, 2637].forEach((f, k) => ping(ctx, out, t + 0.45 + k * 0.08, { freq: f, partials: [1, 2.01], decay: 0.4, gain: 0.18 }));
}

export function mount(root, ctx = {}) {
  useStyles("/games/holdem/assets/cards.css");
  useStyles("/games/holdem/board.css");
  const box = html(`<div style="position:absolute;inset:0"><div class="he-felt"></div><div class="he-spots"></div>
    <div class="he-dealer">D</div><div class="he-center"><div class="he-street"></div><div class="he-board"></div><div class="he-pot"></div><div class="he-msg"></div>
    <button class="primary he-next" hidden></button></div>
    <div class="he-count he-count-north" hidden></div><div class="he-count he-count-south" hidden></div></div>`);
  root.appendChild(box);
  let info = null;
  let view = null;
  let lastBoardLen = 0;
  const next = box.querySelector(".he-next");
  // The label of "Next hand" (D-136), with the seconds left until the hand starts by itself.
  const nextLabel = () => {
    const ms = remainingMs(info, "next");
    const what = view && view.hand >= view.hands ? "Finish" : "Next hand";
    return ms === null ? what : `${what} · ${Math.ceil(ms / 1000)} s`;
  };
  next.addEventListener("click", async () => {
    if (next.disabled || !ctx.skipTimer) return;
    next.disabled = true; // until the next view: one tap is one skip
    const r = await ctx.skipTimer("next");
    if (!r.ok) next.disabled = false;
  });
  const tick = setInterval(() => {
    const el = box.querySelector(`.he-clock`);
    const ms = view?.phase === "betting" ? remainingMs(info, "turn") : null;
    if (el) el.textContent = ms === null ? "" : `${Math.ceil(ms / 1000)} s`;
    if (!next.hidden) next.textContent = nextLabel();
  }, 250);

  // Where a seat's cards and bet go: straight in from the seat, a fixed distance inside the felt's edge, so they lie on
  // the felt on every edge. (A fraction of the way to the middle put north and south, whose plates are closer to the
  // middle, on the rail and their bets off the table.) FELT matches .he-felt in board.css: a stadium shape.
  const FELT = { left: 320, right: 1600, rad: 300 };
  const INSET = 85; // felt edge to the spot's centre: room for the cards (87 px) and the bet line below them
  const spotAt = (pos, inset = INSET) => {
    const half = (d) => Math.sqrt(FELT.rad ** 2 - Math.min(Math.max(d, 0), FELT.rad - 1) ** 2);
    if (pos.edge === "east" || pos.edge === "west") {
      const reach = FELT.right - FELT.rad - CX + half(Math.abs(pos.y - CY)); // centre to the felt's edge at this height
      return [CX + (pos.edge === "east" ? 1 : -1) * (reach - inset), pos.y];
    }
    const x = Math.min(Math.max(pos.x, FELT.left + inset), FELT.right - inset);
    const reach = half(Math.max(FELT.left + FELT.rad - x, x - (FELT.right - FELT.rad))); // centre to the edge here
    return [x, CY + (pos.edge === "north" ? -1 : 1) * (reach - inset)];
  };

  // One sound per event, in the order they happen within a step: a move, the cards it brings, the pot going out.
  let heard = false; // the first update: a board that comes up as the game starts missed its handStarted event
  function sounds(events, v) {
    let at = 0;
    if (!heard && !events.length && v.hand === 1 && v.phase === "betting" && !v.lastAction && !v.board.length) {
      events = [{ name: "handStarted" }];
    }
    heard = true;
    const later = (ms, name, make) => (ms ? setTimeout(() => playSound(info, name, make), ms) : playSound(info, name, make));
    for (const e of events) {
      if (e.name === "handStarted") {
        later(at, "holdem-shuffle", shuffleSound);
        later(at + SHUFFLE_S * 1000, "holdem-deal", dealSound(2 * v.players.filter((p) => p.dealt).length));
        at += 1500;
      } else if (e.name === "action") {
        const a = e.data?.action;
        const allIn = v.players.find((p) => p.seat === e.data?.seat)?.allIn;
        if (a === "fold") later(at, "holdem-fold", foldSound);
        else if (a === "check") later(at, "holdem-check", checkSound);
        else later(at, "holdem-chips", chipsSound(allIn ? 9 : a === "call" ? 2 : 4));
        at += 350;
      } else if (e.name === "street") {
        const n = { flop: 3, turn: 1, river: 1 }[e.data?.street] ?? 0;
        if (n) later(at, "holdem-street", streetSound(n));
        at += 150 + n * 130;
      } else if (e.name === "showdown" || e.name === "wonByFold") {
        later(at, "holdem-win", winSound);
        at += 900;
      }
    }
  }

  return {
    update(v, events, i) {
      view = v;
      info = i;
      sounds(events, v);
      const rot = i.rotation;
      const center = box.querySelector(".he-center");
      center.style.transform = `translate(-50%,-50%) rotate(${rot}deg)`;
      const name = (seat) => v.players.find((p) => p.seat === seat)?.name ?? "?";
      // The street, which hand this is and how many follow, in two corners: upper left facing north, lower right facing south.
      const left = v.hands - v.hand;
      const more = left === 0 ? "last hand" : `${left} more to play`;
      for (const el of box.querySelectorAll(".he-count")) {
        el.hidden = v.over || !v.hand;
        el.innerHTML = `<div class="he-count-k">${v.phase === "handOver" ? "result" : esc(v.street)}</div><div class="he-count-v">Hand ${v.hand}<span> of ${v.hands}</span></div><div class="he-count-r">${more}</div>`;
      }
      // The hand and the street are in the corners, facing both sides; the middle says only "Game over" at the end.
      center.querySelector(".he-street").textContent = v.over ? "Game over" : "";

      const winners = new Set((v.result?.winners ?? []).map((w) => w.seat));
      const newCards = v.board.length > lastBoardLen;
      center.querySelector(".he-board").innerHTML = Array.from({ length: 5 }, (_, k) =>
        card(v.board[k], { cls: newCards && k >= lastBoardLen ? "deal" : "" }),
      ).join("");
      lastBoardLen = v.phase === "handOver" ? 0 : v.board.length;
      center.querySelector(".he-pot").innerHTML = v.phase === "handOver" && v.result ? "" : `Pot <b>${v.pot}</b>`;
      let msg = "";
      if (v.phase === "handOver" && v.result) {
        msg = v.result.winners.map((w) => `<b style="color:${playerColor(i, w.seat)}">${esc(name(w.seat))}</b> wins ${w.amount}${w.hand ? ` with ${w.hand.toLowerCase()}` : ""}`).join(" · ");
      } else if (v.toAct !== null) {
        msg = `${esc(name(v.toAct))} to act <span class="he-clock"></span>`;
      }
      center.querySelector(".he-msg").innerHTML = msg;
      // Skip the rest of the result's pause (D-136): the table's board, and remote boards with board control.
      const canSkip = v.phase === "handOver" && !v.over && !!ctx.skipTimer && i.boardControl !== false && remainingMs(i, "next") !== null;
      if (canSkip && next.hidden) next.disabled = false;
      next.hidden = !canSkip;
      if (canSkip) next.textContent = nextLabel();

      const spots = box.querySelector(".he-spots");
      spots.innerHTML = v.players
        .map((p) => {
          const pos = i.seatPositions[p.seat];
          if (!pos) return "";
          const [x, y] = spotAt(pos);
          const shown = v.result?.shown?.[p.seat];
          const hole = !p.dealt ? "" : shown ? shown.map((c) => card(c, { cls: winners.has(p.seat) ? "win" : "" })).join("") : card("back") + card("back");
          const act = v.lastAction?.seat === p.seat && v.phase === "betting" ? `<span class="he-act">${esc(v.lastAction.action)}</span>` : "";
          return `<div class="he-spot" style="left:${x}px;top:${y}px;transform:translate(-50%,-50%) rotate(${pos.rot}deg)">
            <div class="he-hole ${p.folded ? "folded" : ""}">${hole}</div>
            <div class="he-bet">${p.bet ? `<span class="he-chip" style="background:${playerColor(i, p.seat)}"></span>${p.bet}` : ""}${act}</div></div>`;
        })
        .join("");

      const dpos = i.seatPositions[v.dealer];
      if (dpos) {
        // On the felt, beside the dealer's cards (to their right, as the dealer sees them).
        const [sx, sy] = spotAt(dpos);
        const a = (dpos.rot * Math.PI) / 180;
        const d = box.querySelector(".he-dealer");
        d.style.left = `${sx + 115 * Math.cos(a)}px`;
        d.style.top = `${sy + 115 * Math.sin(a)}px`;
      }
      seatPlates(root, i, (seat) => {
        const p = v.players.find((x) => x.seat === seat);
        if (!p) return "";
        const status = p.stack === 0 && !p.dealt ? "out" : p.allIn ? "all-in" : p.folded ? "folded" : "";
        return `${p.stack} pts${status ? ` · ${status}` : ""}`;
      }, { active: v.phase === "betting" ? v.toAct : null });
    },
    destroy() {
      clearInterval(tick);
    },
  };
}
