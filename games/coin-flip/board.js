// Coin Flip board UI (D-091): which round, the coin, everyone's pick once the coin is in the air, a countdown
// while people choose, and per-player statistics when all rounds are played. Plates at each seat show scores.
import { esc, html, playerColor, remainingMs, seatPlates } from "/shared/board-kit.js";

const SPIN_MS = 1100;

export function mount(root) {
  const center = html(`<div class="cf-center" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;transition:transform .5s;width:900px">
      <div class="eyebrow" style="font-size:20px">Coin Flip</div>
      <div class="cf-round" style="font-family:var(--display);font-size:60px;margin-top:4px"></div>
      <div class="cf-coin" style="width:220px;height:220px;margin:22px auto 14px;border-radius:50%;display:grid;place-items:center;font-family:var(--display);font-size:40px;color:#3a2a08;
        background:radial-gradient(circle at 35% 30%,#f6d98e,#c8962f 60%,#8a6216);box-shadow:0 18px 50px rgba(0,0,0,.5),inset 0 0 0 10px rgba(255,255,255,.15)">?</div>
      <div class="cf-caption muted" style="font-size:24px;min-height:34px"></div>
      <div class="cf-picks" style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:14px;min-height:44px"></div>
      <div class="cf-clock" style="margin:18px auto 0;width:420px;min-height:70px"></div>
      <div class="cf-stats"></div></div>`);
  root.appendChild(center);
  let info = null;
  let view = null;
  let spinning = false; // between a flip and showing its result
  let spinTimer = null;

  const clock = () => {
    const el = center.querySelector(".cf-clock");
    const ms = view && !view.done && !spinning ? remainingMs(info, "round") : null;
    if (ms === null) return void (el.innerHTML = "");
    const s = Math.ceil(ms / 1000);
    const frac = view.roundMs ? Math.max(0, Math.min(1, ms / view.roundMs)) : 0;
    el.innerHTML = `<div style="font-family:var(--mono);font-size:44px;color:${s <= 5 ? "var(--ruby, #e8735f)" : "var(--brass)"}">${s}</div>
      <div style="height:8px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden"><div style="height:100%;width:${(frac * 100).toFixed(1)}%;background:${s <= 5 ? "var(--ruby, #e8735f)" : "var(--brass)"};transition:width .25s linear"></div></div>
      <div class="muted" style="font-size:18px;margin-top:6px">seconds to pick</div>`;
  };
  const tick = setInterval(clock, 250);

  function draw() {
    const v = view;
    const shownRound = spinning ? v.flipped : v.round; // while the coin spins, the round being flipped
    center.querySelector(".cf-round").textContent = v.done && !spinning ? `All ${v.rounds} rounds played` : `Round ${shownRound} of ${v.rounds}`;
    center.querySelector(".cf-coin").textContent = spinning || !v.lastFlip ? "?" : v.lastFlip;
    center.querySelector(".cf-caption").textContent = spinning
      ? "The coin is in the air…"
      : v.flipped
        ? `Round ${v.flipped} came up ${v.lastFlip}`
        : "Pick heads or tails on your phone";
    // Everyone's pick for the round just flipped: visible while the coin is in the air, marked once it lands.
    center.querySelector(".cf-picks").innerHTML = v.flipped
      ? v.seats.map((s) => {
          const mark = spinning || !s.lastGuess ? "" : s.lastGuess === v.lastFlip ? " ✓" : " ✗";
          return `<span class="chip" style="font-size:20px;border-color:${playerColor(info, s.seat)}">${esc(s.name)} · ${s.lastGuess ?? "no pick"}${mark}</span>`;
        }).join("")
      : "";
    center.querySelector(".cf-stats").innerHTML = v.done && !spinning
      ? `<table class="cf-table" style="margin:22px auto 0;font-size:22px;border-collapse:collapse">
          <tr class="faint" style="font-size:16px;letter-spacing:.12em;text-transform:uppercase"><th style="text-align:left;padding:4px 18px">Player</th><th style="padding:4px 18px">Correct</th><th style="padding:4px 18px">Heads</th></tr>
          ${[...v.seats].sort((a, b) => b.score - a.score).map((s) => `<tr><td style="text-align:left;padding:6px 18px;color:${playerColor(info, s.seat)}">${esc(s.name)}</td>
            <td style="padding:6px 18px">${s.score} of ${v.rounds}</td><td style="padding:6px 18px">${s.headsPct === null ? "–" : `${s.headsPct}%`}</td></tr>`).join("")}</table>`
      : "";
    clock();
    const bySeat = Object.fromEntries(v.seats.map((s) => [s.seat, s]));
    seatPlates(root, info, (seat) => {
      const s = bySeat[seat];
      if (!s) return "watching";
      const picking = !v.done && !spinning ? (s.hasGuessed ? " · picked ✓" : " · picking…") : "";
      return `${s.score} correct${picking}`;
    });
  }

  return {
    update(v, events, i) {
      info = i;
      view = v;
      center.style.transform = `translate(-50%,-50%) rotate(${i.rotation}deg)`;
      if (events.some((e) => e.name === "coinFlipped")) {
        spinning = true;
        clearTimeout(spinTimer);
        center.querySelector(".cf-coin").animate([{ transform: "rotateY(0)" }, { transform: "rotateY(1800deg)" }], { duration: SPIN_MS, easing: "cubic-bezier(.2,.7,.2,1)" });
        spinTimer = setTimeout(() => ((spinning = false), view && draw()), SPIN_MS);
      }
      draw();
    },
    destroy() {
      clearInterval(tick);
      clearTimeout(spinTimer);
    },
  };
}
