// Coin Flip deck UI: two big buttons.
import { esc } from "/shared/board-kit.js";

export function mount(root, ctx) {
  root.innerHTML = `<div class="card"><div class="stat"><span class="eyebrow cf-round"></span><span class="n cf-score"></span></div>
      <div class="muted cf-last" style="font-size:.85em"></div></div>
    <div class="choices"><button data-guess="heads">Heads</button><button data-guess="tails">Tails</button></div>
    <div class="muted center cf-hint"></div>`;
  root.querySelectorAll("[data-guess]").forEach((b) =>
    b.addEventListener("click", () => ctx.send("guess", b.dataset.guess)),
  );
  return {
    update(v) {
      root.querySelector(".cf-round").textContent = `Round ${v.round} of ${v.rounds}`;
      root.querySelector(".cf-score").textContent = v.myScore;
      root.querySelector(".cf-last").innerHTML = v.lastFlip ? `Last flip: ${esc(v.lastFlip)}` : "Guess the first flip";
      root.querySelectorAll("[data-guess]").forEach((b) => {
        b.classList.toggle("picked", v.myGuess === b.dataset.guess);
        b.disabled = !!v.myGuess || v.done;
      });
      root.querySelector(".cf-hint").textContent = v.done ? "Game over" : v.myGuess ? "Waiting for the others…" : "Your call";
    },
  };
}
