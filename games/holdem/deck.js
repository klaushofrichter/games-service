// Hold'em deck UI: your two cards (only here), the shared cards, and fold / check / call / raise.
import { esc, remainingMs } from "/shared/board-kit.js";
import { card, injectCardStyles } from "/games/holdem/assets/cards.js";

export function mount(root, ctx) {
  injectCardStyles();
  let view = null;
  let info = null;
  root.innerHTML = `
    <div class="card" style="text-align:center"><div class="eyebrow he-head"></div>
      <div class="he-mine" style="display:flex;gap:14px;justify-content:center;margin:14px 0 8px;--w:clamp(60px, 14dvh, 118px)"></div>
      <div class="display he-hand" style="font-size:1.2em;min-height:1.4em"></div></div>
    <div class="card"><div style="display:flex;gap:6px;justify-content:center;container-type:inline-size;--w:min(52px, calc((100cqi - 24px) / 5))" class="he-board"></div>
      <div style="display:flex;justify-content:space-between;margin-top:12px"><span class="muted he-pot"></span><span class="muted he-stack"></span></div></div>
    <div class="he-status muted center" style="min-height:1.3em"></div>
    <div class="he-actions" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;position:sticky;bottom:10px;z-index:2;padding:8px;margin:0 -8px;border-radius:16px;background:rgba(10,29,25,.88);backdrop-filter:blur(6px)">
      <button class="danger he-fold" data-a="fold">Fold</button><button class="he-call"></button><button class="primary he-raise"></button></div>
    <div class="card he-result" hidden></div>`;
  root.querySelector(".he-actions").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-a]");
    if (!b || b.disabled) return;
    ctx.vibrate?.(20);
    const r = await ctx.send(b.dataset.a);
    if (!r.ok) ctx.toast(r.reason);
  });
  const tick = setInterval(() => {
    const ms = view?.myTurn ? remainingMs(info, "turn") : null;
    const st = root.querySelector(".he-status");
    if (view?.myTurn) st.textContent = ms === null ? "Your turn" : `Your turn · ${Math.ceil(ms / 1000)} s`;
  }, 250);

  return {
    update(v, _events, i) {
      const wasMine = view?.myTurn;
      view = v;
      info = i;
      if (v.myTurn && !wasMine) ctx.vibrate?.(70);
      const me = v.players.find((p) => p.seat === i.seat);
      root.querySelector(".he-head").textContent = v.over ? "Game over" : `Hand ${v.hand} of ${v.hands} · ${v.phase === "handOver" ? "result" : v.street}`;
      root.querySelector(".he-mine").innerHTML = v.myCards.length ? v.myCards.map((c) => card(c)).join("") : card(null) + card(null);
      root.querySelector(".he-mine").style.opacity = me?.folded ? 0.35 : 1;
      root.querySelector(".he-hand").textContent = me?.folded ? "Folded" : v.strength ?? "";
      root.querySelector(".he-board").innerHTML = Array.from({ length: 5 }, (_, k) => card(v.board[k])).join("");
      root.querySelector(".he-pot").textContent = `Pot ${v.pot}`;
      root.querySelector(".he-stack").textContent = `You have ${me?.stack ?? 0}`;
      const l = v.legal;
      const actions = root.querySelector(".he-actions");
      actions.hidden = !l;
      if (l) {
        root.querySelector(".he-fold").disabled = !l.fold;
        const call = root.querySelector(".he-call");
        call.dataset.a = l.check ? "check" : "call";
        call.textContent = l.check ? "Check" : `Call ${l.call}`;
        const raise = root.querySelector(".he-raise");
        raise.dataset.a = l.raiseKind;
        raise.disabled = l.raise === null;
        raise.textContent = l.raise === null ? "Capped" : `${l.raiseKind === "bet" ? "Bet" : "Raise"} ${l.raise}`;
      }
      const name = (seat) => v.players.find((p) => p.seat === seat)?.name ?? "?";
      if (!v.myTurn) {
        root.querySelector(".he-status").textContent =
          v.phase === "handOver" ? "Next hand coming up" : v.toAct !== null ? `Waiting for ${name(v.toAct)}` : "";
      }
      const res = root.querySelector(".he-result");
      if (v.phase === "handOver" && v.result) {
        res.hidden = false;
        res.innerHTML = v.result.winners
          .map((w) => {
            const cards = v.result.shown[w.seat];
            return `<div style="display:flex;align-items:center;gap:12px;margin:4px 0">${cards ? `<div style="display:flex;gap:4px;--w:44px">${cards.map((c) => card(c)).join("")}</div>` : ""}
              <div><b>${esc(name(w.seat))}${w.seat === i.seat ? " (you)" : ""}</b> wins ${w.amount}<div class="muted" style="font-size:.85em">${w.hand ?? "everyone else folded"}</div></div></div>`;
          })
          .join("");
      } else res.hidden = true;
    },
    destroy() {
      clearInterval(tick);
    },
  };
}
