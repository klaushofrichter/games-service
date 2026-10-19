// Coin Flip board UI (D-091): which round, the coin, everyone's pick once the coin is in the air, a countdown
// while people choose, and per-player statistics when all rounds are played. Plates at each seat show scores.
import { esc, html, ping, playerColor, playSound, remainingMs, seatPlates } from "/shared/board-kit.js";

const SPIN_MS = 1100;

// Sound effects (D-092), synthesised: no audio files to ship.
/** The coin in the air: a flick, then a ringing whirr whose rings slow down as it spins. */
function spinSound(ctx, t, out) {
  ping(ctx, out, t, { freq: 1700, decay: 0.06, gain: 0.35 });
  let at = t + 0.06;
  for (let k = 0; at < t + SPIN_MS / 1000 - 0.05; k++) {
    ping(ctx, out, at, { freq: k % 2 ? 3300 : 3550, partials: [1, 1.5], decay: 0.09, gain: 0.12 * (1 - k / 30) });
    at += 0.045 + k * 0.006;
  }
}
/** The coin lands: a clink and two smaller bounces, then it settles. */
function landSound(ctx, t, out) {
  ping(ctx, out, t, { freq: 2450, decay: 0.45, gain: 0.45 });
  ping(ctx, out, t + 0.13, { freq: 2500, decay: 0.25, gain: 0.22 });
  ping(ctx, out, t + 0.21, { freq: 2550, decay: 0.15, gain: 0.1 });
  for (let k = 0; k < 4; k++) ping(ctx, out, t + 0.26 + k * 0.035, { freq: 2600, partials: [1], decay: 0.05, gain: 0.05 });
}

export function mount(root) {
  // During play one column; once all rounds are played the table of results goes beside the coin, not under it, so
  // with eight players nothing runs into the seat plates at the top and bottom (D-149).
  const center = html(`<div class="cf-center" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;transition:transform .5s;display:flex;align-items:center;justify-content:center;gap:56px">
      <div class="cf-main" style="width:900px">
      <div class="eyebrow" style="font-size:20px">Coin Flip</div>
      <div class="cf-round" style="font-family:var(--display);font-size:60px;margin-top:4px"></div>
      <div class="cf-coin" style="width:220px;height:220px;margin:22px auto 14px;border-radius:50%;display:grid;place-items:center;font-family:var(--display);font-size:40px;color:#3a2a08;
        background:radial-gradient(circle at 35% 30%,#f6d98e,#c8962f 60%,#8a6216);box-shadow:0 18px 50px rgba(0,0,0,.5),inset 0 0 0 10px rgba(255,255,255,.15)">?</div>
      <div class="cf-caption muted" style="font-size:24px;min-height:34px"></div>
      <div class="cf-picks" style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:14px;min-height:44px"></div>
      <div class="cf-clock" style="margin:18px auto 0;width:420px;min-height:70px"></div></div>
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
    const color = s <= 5 ? "var(--ruby, #e8735f)" : "var(--brass)";
    el.innerHTML = `<div style="font-family:var(--mono);font-size:44px;color:${color}">${s}</div>
      <div style="height:8px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden"><div style="height:100%;width:${(frac * 100).toFixed(1)}%;background:${color};transition:width .25s linear"></div></div>
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
    const end = v.done && !spinning;
    center.querySelector(".cf-main").style.width = end ? "720px" : "900px";
    const coin = center.querySelector(".cf-coin").style;
    coin.width = coin.height = end ? "170px" : "220px";
    coin.fontSize = end ? "34px" : "40px";
    center.querySelector(".cf-clock").style.minHeight = end ? "0" : "70px";
    center.querySelector(".cf-stats").style.display = end ? "" : "none";
    center.querySelector(".cf-stats").innerHTML = end
      ? `<table class="cf-table" style="margin:0;font-size:22px;border-collapse:collapse">
          <tr class="faint" style="font-size:16px;letter-spacing:.12em;text-transform:uppercase"><th style="text-align:left;padding:4px 18px">Player</th><th style="padding:4px 18px">Correct</th><th style="padding:4px 18px">Heads</th></tr>
          ${[...v.seats].sort((a, b) => b.score - a.score).map((s) => `<tr><td style="text-align:left;padding:6px 18px;white-space:nowrap;color:${playerColor(info, s.seat)}">${esc(s.name)}</td>
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

  const idleWaiters = [];
  let spin = null; // the coin's spin animation
  return {
    update(v, events, i) {
      info = i;
      view = v;
      center.style.transform = `translate(-50%,-50%) rotate(${i.rotation}deg)`;
      if (events.some((e) => e.name === "coinFlipped")) {
        spinning = true;
        clearTimeout(spinTimer);
        playSound(info, "coin-spin", spinSound);
        spin = center.querySelector(".cf-coin").animate([{ transform: "rotateY(0)" }, { transform: "rotateY(1800deg)" }], { duration: SPIN_MS, easing: "cubic-bezier(.2,.7,.2,1)" });
        spinTimer = setTimeout(() => {
          spinning = false;
          playSound(info, "coin-land", landSound);
          if (view) draw();
          const landed = () => idleWaiters.splice(0).forEach((r) => r());
          spin ? spin.finished.then(landed, landed) : landed();
        }, SPIN_MS);
      }
      draw();
    },
    /** Resolves once the coin has landed: the platform shows Show result only then (D-134). */
    whenIdle() {
      return spinning ? new Promise((r) => idleWaiters.push(r)) : Promise.resolve();
    },
    destroy() {
      clearInterval(tick);
      clearTimeout(spinTimer);
      idleWaiters.splice(0).forEach((r) => r());
    },
  };
}

export { spinSound, landSound }; // for listening to them outside a game
