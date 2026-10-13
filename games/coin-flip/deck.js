// Coin Flip deck UI: two big buttons, the countdown while choosing, and how the last round went for you (D-091).
import { esc, remainingMs } from "/shared/board-kit.js";

export function mount(root, ctx) {
  root.innerHTML = `<div class="card"><div class="stat"><span class="eyebrow cf-round"></span><span class="n cf-score"></span></div>
      <div class="muted cf-last" style="font-size:.85em"></div></div>
    <div class="cf-clock" style="min-height:44px"></div>
    <div class="choices"><button data-guess="heads">Heads</button><button data-guess="tails">Tails</button></div>
    <div class="muted center cf-hint"></div>`;
  root.querySelectorAll("[data-guess]").forEach((b) =>
    b.addEventListener("click", () => ctx.send("guess", b.dataset.guess)),
  );
  let view = null;
  let info = null;
  const clock = () => {
    const el = root.querySelector(".cf-clock");
    const ms = view && !view.done ? remainingMs(info, "round") : null;
    if (ms === null) return void (el.innerHTML = "");
    const s = Math.ceil(ms / 1000);
    const frac = view.roundMs ? Math.max(0, Math.min(1, ms / view.roundMs)) : 0;
    const color = s <= 5 ? "var(--ruby, #e8735f)" : "var(--brass)";
    el.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:.85em" class="muted"><span>${view.myGuess ? "Waiting for the others" : "Time to pick"}</span><span style="color:${color};font-family:var(--mono)">${s} s</span></div>
      <div style="height:6px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden;margin-top:6px"><div style="height:100%;width:${(frac * 100).toFixed(1)}%;background:${color};transition:width .25s linear"></div></div>`;
  };
  const tick = setInterval(clock, 250);
  return {
    update(v, _events, i) {
      view = v;
      info = i;
      root.querySelector(".cf-round").textContent = v.done ? `All ${v.rounds} rounds played` : `Round ${v.round} of ${v.rounds}`;
      root.querySelector(".cf-score").textContent = v.myScore;
      const mine = v.myLastGuess ? `you picked ${esc(v.myLastGuess)} ${v.myLastGuess === v.lastFlip ? "✓" : "✗"}` : "you didn't pick";
      root.querySelector(".cf-last").innerHTML = v.flipped ? `Round ${v.flipped} came up ${esc(v.lastFlip)} · ${mine}` : "Guess the first flip";
      root.querySelectorAll("[data-guess]").forEach((b) => {
        b.classList.toggle("picked", v.myGuess === b.dataset.guess);
        b.disabled = !!v.myGuess || v.done;
      });
      root.querySelector(".cf-hint").textContent = v.done ? "Game over" : v.myGuess ? "Waiting for the others…" : "Your call";
      clock();
    },
    destroy() {
      clearInterval(tick);
    },
  };
}
