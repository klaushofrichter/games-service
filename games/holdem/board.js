// Hold'em board UI: an oval felt with the shared cards and pot, each player's bet and face-down cards
// on the felt in front of each seat, the dealer button, and revealed hands at showdown.
import { esc, html, playerColor, remainingMs, seatPlates, useStyles } from "/shared/board-kit.js";
import { card } from "/games/holdem/assets/cards.js";

const CX = 960, CY = 540; // board.css positions the felt and centre around this point

export function mount(root, ctx = {}) {
  useStyles("/games/holdem/assets/cards.css");
  useStyles("/games/holdem/board.css");
  const box = html(`<div style="position:absolute;inset:0"><div class="he-felt"></div><div class="he-spots"></div>
    <div class="he-dealer">D</div><div class="he-center"><div class="he-street"></div><div class="he-board"></div><div class="he-pot"></div><div class="he-msg"></div>
    <button class="primary he-next" hidden></button></div></div>`);
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

  return {
    update(v, events, i) {
      view = v;
      info = i;
      const rot = i.rotation;
      const center = box.querySelector(".he-center");
      center.style.transform = `translate(-50%,-50%) rotate(${rot}deg)`;
      const name = (seat) => v.players.find((p) => p.seat === seat)?.name ?? "?";
      center.querySelector(".he-street").textContent = v.over ? "Game over" : `Hand ${v.hand} of ${v.hands} · ${v.phase === "handOver" ? "result" : v.street}`;

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
