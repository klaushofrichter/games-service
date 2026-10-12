// Coin Flip board UI: a coin in the middle, plates with scores at each seat.
import { html, remainingMs, seatPlates } from "/shared/board-kit.js";

export function mount(root) {
  const center = html(`<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;transition:transform .5s">
      <div class="cf-round eyebrow" style="font-size:22px"></div>
      <div class="cf-coin" style="width:260px;height:260px;margin:24px auto;border-radius:50%;display:grid;place-items:center;font-family:var(--display);font-size:44px;color:#3a2a08;
        background:radial-gradient(circle at 35% 30%,#f6d98e,#c8962f 60%,#8a6216);box-shadow:0 18px 50px rgba(0,0,0,.5),inset 0 0 0 10px rgba(255,255,255,.15)">?</div>
      <div class="cf-clock muted" style="font-size:22px;min-height:30px"></div></div>`);
  root.appendChild(center);
  let info = null;
  let lastRound = 0;
  const tick = setInterval(() => {
    const ms = remainingMs(info, "round");
    center.querySelector(".cf-clock").textContent = ms === null ? "" : `${Math.ceil(ms / 1000)} s to guess`;
  }, 250);

  return {
    update(view, events, i) {
      info = i;
      center.style.transform = `translate(-50%,-50%) rotate(${i.rotation}deg)`;
      center.querySelector(".cf-round").textContent = view.done ? "Final flip" : `Round ${view.round} of ${view.rounds}`;
      const coin = center.querySelector(".cf-coin");
      coin.textContent = view.lastFlip ?? "?";
      if (events.some((e) => e.name === "coinFlipped") && view.round !== lastRound) {
        coin.animate([{ transform: "rotateY(0)" }, { transform: "rotateY(1440deg)" }], { duration: 900, easing: "cubic-bezier(.2,.7,.2,1)" });
      }
      lastRound = view.round;
      const bySeat = Object.fromEntries(view.seats.map((s) => [s.seat, s]));
      seatPlates(root, i, (seat) => {
        const s = bySeat[seat];
        return s ? `${s.score} correct ${s.hasGuessed ? "· guessed ✓" : ""}` : "watching";
      });
    },
    destroy() {
      clearInterval(tick);
    },
  };
}
