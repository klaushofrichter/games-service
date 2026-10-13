// Pachisi deck UI: roll the die, then pick which token to move.
import { esc, playerColor, remainingMs } from "/shared/board-kit.js";

const FINISH = 44;
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const dieFace = (n) =>
  `<div style="width:84px;height:84px;border-radius:16px;background:#fbf8ef;display:grid;grid-template:repeat(3,1fr)/repeat(3,1fr);padding:12px;flex:none;box-shadow:0 8px 20px rgba(0,0,0,.4)">${Array.from({ length: 9 }, (_, k) => `<i style="width:14px;height:14px;border-radius:50%;background:#1b1a17;place-self:center;visibility:${n && PIPS[n].includes(k) ? "visible" : "hidden"}"></i>`).join("")}</div>`;
const after = (p, die) => {
  const to = p === -1 ? 0 : p + die;
  return to === FINISH ? "home!" : to >= 40 ? `home column ${to - 39}` : `step ${to + 1}`;
};

export function mount(root, ctx) {
  let view = null;
  let info = null;
  root.innerHTML = `<div class="card" style="display:flex;gap:16px;align-items:center"><div class="pc-die"></div>
      <div style="flex:1"><div class="eyebrow pc-who"></div><div class="display pc-what" style="font-size:1.4em;margin-top:2px"></div>
      <div class="muted pc-clock" style="font-size:.85em;margin-top:4px"></div></div></div>
    <button class="primary big pc-roll">Roll the die</button>
    <div class="pc-tokens" style="display:flex;flex-direction:column;gap:10px"></div>`;
  root.querySelector(".pc-roll").addEventListener("click", () => {
    ctx.vibrate?.(30);
    ctx.send("roll");
  });
  root.querySelector(".pc-tokens").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-token]");
    if (!b) return;
    ctx.send("move", { token: Number(b.dataset.token) });
  });
  const tick = setInterval(() => {
    const ms = view?.myTurn ? remainingMs(info, "turn") : null;
    root.querySelector(".pc-clock").textContent = ms === null ? "" : `${Math.ceil(ms / 1000)} s left, then the table moves for you`;
  }, 250);

  return {
    update(v, events, i) {
      const wasMyTurn = view?.myTurn;
      view = v;
      info = i;
      if (v.myTurn && !wasMyTurn) ctx.vibrate?.(80);
      const color = playerColor(i, i.seat ?? 0);
      root.querySelector(".pc-die").innerHTML = dieFace(v.die);
      root.querySelector(".pc-who").innerHTML = v.over ? "Game over" : v.myTurn ? `<span style="color:${color}">Your turn</span>` : `${esc(v.turnName)}'s turn`;
      root.querySelector(".pc-what").textContent = v.over
        ? v.winner ? `${v.winner} wins` : "No winner"
        : v.myTurn ? (v.phase === "roll" ? "Roll the die" : `You rolled ${v.die}. Pick a token.`) : v.phase === "move" ? `${v.turnName} rolled ${v.die}` : "Waiting…";
      const roll = root.querySelector(".pc-roll");
      roll.hidden = !(v.myTurn && v.phase === "roll");
      root.querySelector(".pc-tokens").innerHTML = v.tokens
        .map((p, k) => {
          const legal = v.legal.includes(k);
          return `<div class="card" style="display:flex;align-items:center;gap:14px;padding:12px 14px;${legal ? `border-color:${color}` : ""}">
            <div style="width:40px;height:40px;border-radius:50%;background:${color};display:grid;place-items:center;font-weight:700;color:rgba(0,0,0,.6);flex:none">${k + 1}</div>
            <div style="flex:1"><div>${p === FINISH ? "Home ✓" : esc(v.where[k])}</div>${legal ? `<div class="muted" style="font-size:.8em">moves to ${after(p, v.die)}</div>` : ""}</div>
            ${legal ? `<button class="primary" data-token="${k}">Move</button>` : ""}</div>`;
        })
        .join("");
      if (events.some((e) => e.name === "moved" && e.data.captured.some((c) => c.seat === i.seat))) {
        ctx.vibrate?.([100, 60, 100]);
        ctx.toast("One of your tokens was sent back to start");
      }
    },
    destroy() {
      clearInterval(tick);
    },
  };
}
