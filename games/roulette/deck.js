// Roulette deck UI: balance, chip size, outside bets, number pad, and the result of each spin.
import { esc, remainingMs, useStyles } from "/shared/board-kit.js";

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const color = (n) => (n === 0 ? "green" : RED.has(n) ? "red" : "black");
const CHIPS = [10, 25, 50, 100, 250, 500];
const OUTSIDE = [
  ["red", null, "Red"], ["black", null, "Black"], ["even", null, "Even"],
  ["odd", null, "Odd"], ["low", null, "1–18"], ["high", null, "19–36"],
  ["dozen", 1, "1st 12"], ["dozen", 2, "2nd 12"], ["dozen", 3, "3rd 12"],
  ["column", 1, "Col 1"], ["column", 2, "Col 2"], ["column", 3, "Col 3"],
];
const keyOf = (type, target) => (target === null || target === undefined ? type : `${type}:${target}`);

export function mount(root, ctx) {
  useStyles("/games/roulette/deck.css");
  let chip = 10;
  let view = null;
  let info = null;
  let revealAt = 0; // keep the result hidden until the wheel on the board has stopped
  let shownPhase = null;

  root.innerHTML = `
    <div class="card"><div class="rd-top"><div><div class="eyebrow rd-round"></div><div class="rd-balance"></div><div class="rd-sub rd-staked"></div></div>
      <div class="rd-clock"></div></div></div>
    <div class="card rd-resultcard" hidden></div>
    <div class="rd-play">
      <div class="rd-section">Chip</div>
      <div class="rd-chips">${CHIPS.map((c) => `<button data-chip="${c}">${c}</button>`).join("")}</div>
      <div class="rd-section" style="margin-top:14px">Outside bets</div>
      <div class="rd-out">${OUTSIDE.map(([t, n, l]) => `<button data-type="${t}" ${n ? `data-target="${n}"` : ""} class="${t === "red" || t === "black" ? t : ""}">${l}</button>`).join("")}</div>
      <div class="rd-section" style="margin-top:14px">Numbers · pays 35 to 1</div>
      <div class="rd-nums"><button data-type="straight" data-target="0" class="green">0</button>${Array.from({ length: 36 }, (_, i) => i + 1)
        .map((n) => `<button data-type="straight" data-target="${n}" class="${color(n)}">${n}</button>`)
        .join("")}</div>
    </div>
    <div class="rd-actions"><button class="rd-clear">Clear</button><button class="primary rd-done">Done betting</button></div>`;

  root.querySelectorAll("[data-chip]").forEach((b) =>
    b.addEventListener("click", () => {
      chip = Number(b.dataset.chip);
      paint();
    }),
  );
  root.querySelectorAll("[data-type]").forEach((b) =>
    b.addEventListener("click", async () => {
      const payload = { type: b.dataset.type, amount: chip };
      if (b.dataset.target !== undefined) payload.target = Number(b.dataset.target);
      ctx.vibrate?.(15);
      const r = await ctx.send("placeBet", payload);
      if (!r.ok) ctx.toast(r.reason);
    }),
  );
  root.querySelector(".rd-clear").addEventListener("click", async () => {
    const r = await ctx.send("clearBets");
    if (!r.ok) ctx.toast(r.reason);
  });
  root.querySelector(".rd-done").addEventListener("click", async () => {
    const r = await ctx.send("done");
    if (!r.ok) ctx.toast(r.reason);
  });

  const clock = root.querySelector(".rd-clock");
  const tick = setInterval(() => {
    const ms = view?.phase === "betting" && !view.myDone ? remainingMs(info, "betting") : null;
    clock.textContent = ms === null ? "" : `${Math.ceil(ms / 1000)}s`;
    const next = view?.phase === "result" && !view.over && Date.now() >= revealAt ? remainingMs(info, "next") : null;
    const nx = root.querySelector(".rd-next");
    if (nx) nx.textContent = next === null ? "" : `Next spin in ${Math.ceil(next / 1000)}s`;
    clock.classList.toggle("hurry", ms !== null && ms < 6000);
  }, 200);

  function paint() {
    if (!view) return;
    const v = view;
    root.querySelector(".rd-round").textContent = v.over ? "Game over" : `Spin ${v.round} of ${v.rounds}`;
    root.querySelector(".rd-balance").textContent = `${v.balance} pts`;
    root.querySelector(".rd-staked").textContent = v.phase !== "betting" ? "" : v.staked ? `${v.staked} on the table` : "Place your bets";
    root.querySelectorAll("[data-chip]").forEach((b) => {
      const c = Number(b.dataset.chip);
      b.hidden = c > v.maxBet || c < v.minBet;
      b.classList.toggle("on", c === chip);
    });
    if (chip < v.minBet) chip = CHIPS.find((c) => c >= v.minBet) ?? v.minBet;

    const mine = Object.fromEntries(v.myBets.map((b) => [keyOf(b.type, b.target), b.amount]));
    root.querySelectorAll("[data-type]").forEach((b) => {
      const amt = mine[keyOf(b.dataset.type, b.dataset.target === undefined ? null : Number(b.dataset.target))];
      b.querySelector(".rd-badge")?.remove();
      if (amt) b.insertAdjacentHTML("beforeend", `<span class="rd-badge">${amt}</span>`);
    });

    const betting = v.phase === "betting" && !v.myDone;
    const play = root.querySelector(".rd-play");
    play.hidden = v.phase !== "betting" || v.over;
    play.classList.toggle("rd-locked", !v.canBet);
    root.querySelector(".rd-actions").hidden = v.phase !== "betting" || v.over;
    if (v.phase !== shownPhase) {
      if (v.phase === "result") window.scrollTo({ top: 0, behavior: "smooth" });
      shownPhase = v.phase;
    }
    root.querySelector(".rd-clear").disabled = !betting || !v.myBets.length;
    const done = root.querySelector(".rd-done");
    done.disabled = !betting;
    done.textContent = v.phase !== "betting" ? "Wheel is spinning" : v.myDone ? "Waiting for the others" : v.myBets.length ? "Done betting" : "Skip this spin";

    const rc = root.querySelector(".rd-resultcard");
    if (v.phase === "result" && Date.now() < revealAt) {
      rc.hidden = false;
      rc.innerHTML = `<div class="rd-result"><div class="rd-ball green rd-spinning">?</div><div class="display" style="font-size:1.4em">The wheel is spinning…</div></div>`;
    } else if (v.last && (v.phase === "result" || v.over)) {
      const m = v.last.mine;
      const net = m && m.staked ? m.net : null;
      rc.hidden = false;
      rc.innerHTML = `<div class="rd-result"><div class="rd-ball ${v.last.color}">${v.last.number}</div>
        <div><div class="eyebrow">${esc(v.last.color)}</div>${net === null ? `<div class="muted">You sat this one out</div>`
          : `<div class="rd-net ${net >= 0 ? "up" : "down"}">${net >= 0 ? "+" : "−"}${Math.abs(net)}</div>`}
          <div class="muted rd-next" style="font-size:.85em"></div></div></div>`;
    } else rc.hidden = true;
  }

  let lastRound = 0;
  return {
    update(v, events, i) {
      view = v;
      info = i;
      if (events.some((e) => e.name === "wheelSpun") && v.last?.round !== lastRound) {
        lastRound = v.last.round;
        revealAt = Date.now() + 5200;
        setTimeout(() => {
          paint();
          if (view?.last?.mine?.net > 0) ctx.vibrate?.([60, 40, 60]);
        }, 5250);
      }
      paint();
    },
    destroy() {
      clearInterval(tick);
    },
  };
}
