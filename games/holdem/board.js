// Hold'em board UI: an oval felt with the shared cards and pot, each player's bet and face-down cards
// toward the middle, the dealer button, and revealed hands at showdown.
import { esc, html, remainingMs, seatColor, seatPlates } from "/shared/board-kit.js";
import { card, injectCardStyles } from "/games/holdem/assets/cards.js";

const CX = 960, CY = 540;
const STYLE = `
.he-felt { position:absolute; left:${CX - 640}px; top:${CY - 300}px; width:1280px; height:600px; border-radius:300px;
  background: radial-gradient(ellipse at 50% 40%, #1d6b4b, #0e3d2c 70%); box-shadow: 0 0 0 16px #3a2512, 0 0 0 20px #a57c28, 0 30px 80px rgba(0,0,0,.6); }
.he-center { position:absolute; left:${CX}px; top:${CY}px; transform: translate(-50%,-50%); text-align:center; transition: transform .6s; }
.he-board { display:flex; gap:16px; justify-content:center; --w: 104px; }
.he-pot { margin-top: 22px; font-family: var(--display); font-size: 36px; color: var(--ink); }
.he-pot b { color: var(--brass); }
.he-street { font-size: 20px; letter-spacing: .2em; text-transform: uppercase; color: var(--brass); margin-bottom: 18px; }
.he-msg { font-size: 26px; color: var(--ink); min-height: 34px; margin-top: 8px; }
.he-spot { position:absolute; transform: translate(-50%,-50%); display:flex; flex-direction:column; align-items:center; gap:8px; transition: transform .5s; }
.he-hole { display:flex; gap:6px; --w: 62px; }
.he-hole.folded { opacity: .25; }
.he-bet { display:flex; align-items:center; gap:8px; font: 700 22px var(--text); color: var(--ink); min-height: 30px; }
.he-chip { width: 26px; height: 26px; border-radius: 50%; border: 3px dashed rgba(255,255,255,.7); }
.he-dealer { position:absolute; width: 46px; height: 46px; border-radius: 50%; background: #fbf8ef; color:#1b1a17; display:grid; place-items:center;
  font: 800 22px var(--text); box-shadow: 0 6px 14px rgba(0,0,0,.5); transform: translate(-50%,-50%); transition: left .6s, top .6s; }
.he-act { font-size: 20px; color: var(--ink-soft); }
.he-clock { font-family: var(--mono); font-size: 26px; color: var(--brass); }
`;

export function mount(root) {
  injectCardStyles();
  if (!document.getElementById("he-css")) document.head.appendChild(Object.assign(document.createElement("style"), { id: "he-css", textContent: STYLE }));
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
        msg = v.result.winners.map((w) => `<b style="color:${seatColor(w.seat)}">${esc(name(w.seat))}</b> wins ${w.amount}${w.hand ? ` with ${w.hand.toLowerCase()}` : ""}`).join(" · ");
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
            <div class="he-bet">${p.bet ? `<span class="he-chip" style="background:${seatColor(p.seat)}"></span>${p.bet}` : ""}${act}</div></div>`;
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
