// Card Sling phone: the platform's sling (D-189, /shared/sling.js). Push a card up and off the top of the phone to
// play it; Draw a card brings one in at the top once the board has thrown it this way.
import { useStyles } from "/shared/board-kit.js";
import { slingDeck } from "/shared/sling.js";
import { cardFace } from "/games/card-sling/assets/cards.js";

const CW = 88, CH = 132;

export function mount(root, ctx) {
  useStyles("/games/card-sling/deck.css");
  root.innerHTML = `<div class="csd">
    <div class="csd-top"><div class="csd-hint">Push a card up and off the top to play it</div><div class="csd-arrow" aria-hidden="true">↑</div></div>
    <div class="csd-bar"><span class="csd-count"></span><button type="button" class="primary csd-draw">Draw a card</button></div>
    <div class="csd-hand"></div></div>`;
  const $ = (s) => root.querySelector(s);
  let view = null, pending = null;
  const sling = slingDeck($(".csd"), ctx, {
    onSling: async (id) => (await ctx.send("play", { id: Number(id) }))?.ok,
    speed: () => 1.5,
  });

  function render(entering = null) {
    const hand = view?.hand ?? [];
    const w = $(".csd-hand").clientWidth - 24;
    const step = hand.length > 1 ? Math.min(CW + 8, (w - CW) / (hand.length - 1)) : 0;
    const start = 12 + Math.max(0, (w - CW - step * (hand.length - 1)) / 2);
    $(".csd-hand").innerHTML = hand
      .map((c, i) => `<div class="csd-card" data-sling="${c.id}" style="left:${start + i * step}px;z-index:${i + 1}">${cardFace(c, CW, CH)}</div>`)
      .join("");
    $(".csd-count").textContent = `${hand.length} cards · ${view?.played ?? 0} of ${view?.plays ?? 0} played`;
    $(".csd-draw").disabled = !view?.canDraw;
    if (entering !== null) sling.receive($(`[data-sling="${entering}"]`));
  }
  // The hand changes while a card is under a finger: show it once the card is gone or back.
  const flush = () => {
    if (!pending) return;
    if (sling.busy()) return void setTimeout(flush, 60);
    const p = pending;
    pending = null;
    view = p.v;
    render(p.entering);
  };

  root.addEventListener("click", (e) => e.target.closest(".csd-draw") && ctx.send("draw"));

  return {
    update(v, events, info) {
      const before = new Set((pending?.v ?? view)?.hand.map((c) => c.id) ?? []);
      const drew = events.some((e) => e.name === "drew" && e.data.seat === info.seat);
      pending = { v, entering: drew ? (v.hand.find((c) => !before.has(c.id))?.id ?? null) : (pending?.entering ?? null) };
      flush();
    },
    destroy: () => sling.destroy(),
  };
}
