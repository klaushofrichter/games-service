// Hold'em board UI: an oval felt with the shared cards and pot, each player's bet and face-down cards
// toward the middle, the dealer button, and revealed hands at showdown.
import { esc, html, playerColor, remainingMs, seatPlates, useStyles } from "/shared/board-kit.js";
import { card } from "/games/holdem/assets/cards.js";

const CX = 960, CY = 540; // board.css positions the felt and centre around this point

export function mount(root) {
  useStyles("/games/holdem/assets/cards.css");
  useStyles("/games/holdem/board.css");
  const box = html(`<div style="position:absolute;inset:0"><div class="he-felt"></div><div class="he-spots"></div>
    <div class="he-dealer">D</div><div class="he-center"><div class="he-street"></div><div class="he-board"></div><div class="he-pot"></div><div class="he-msg"></div></div></div>`);
  root.appendChild(box);
  let info = null;
  let view = null;
  let lastBoardLen = 0;
  const tick = setInterval(() => {
    const el = box.querySelector(`.he-clock`);
    const ms = view?.phase === "betting" ? remainingMs(info, "turn") : null;
    if (el) el.textContent = ms === null ? "" : `${Math.ceil(ms / 1000)} s`;
  }, 250);

  // A point between a seat and the middle of the table, where its cards and bet go.
  const toward = (pos, f) => [pos.x + (CX - pos.x) * f, pos.y + (CY - pos.y) * f];

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

      const spots = box.querySelector(".he-spots");
      spots.innerHTML = v.players
        .map((p) => {
          const pos = i.seatPositions[p.seat];
          if (!pos) return "";
          const [x, y] = toward(pos, 0.36);
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
        const [dx, dy] = toward(dpos, 0.2);
        const d = box.querySelector(".he-dealer");
        d.style.left = `${dx + (dpos.edge === "south" || dpos.edge === "north" ? 190 : 0)}px`;
        d.style.top = `${dy}px`;
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
