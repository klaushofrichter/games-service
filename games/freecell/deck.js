// FreeCell on the phone (D-308, D-310): the game is played on the board; the phone chooses how the cards look. The
// design is kept on the table (`design` in the game's data), so it is there for the next game, and the board changes
// at once, also in the middle of a game.
import { esc, useStyles } from "/shared/board-kit.js";
import { DEFAULT_DESIGN, DESIGNS, cardHtml, isDesign } from "/games/freecell/assets/cards.js";

// the cards each design is shown with: a king, a queen, an ace and a number
const SHOW = [12 * 4 + 0, 11 * 4 + 1, 0 * 4 + 2, 6 * 4 + 3];

export function mount(root, ctx) {
  useStyles("/games/freecell/assets/cards.css");
  useStyles("/games/freecell/deck.css");
  root.innerHTML = `<div class="card center fcd-where"><div class="eyebrow">FreeCell</div>
      <p class="fcd-on-board">This game is played on the board.</p>
      <p class="muted fcd-state"></p></div>
    <div class="card fcd-designs"><div class="eyebrow">The cards</div>
      <p class="muted fcd-lede">Choose how the cards look on the board. You can change it at any time.</p>
      <div class="fcd-list" role="radiogroup" aria-label="Card design">${DESIGNS.map(
        (d) => `<button type="button" class="fcd-design" role="radio" aria-checked="false" data-design="${d.id}">
          <span class="fcd-preview fc-d-${d.id}" aria-hidden="true">${SHOW.map((c) => cardHtml(c, d.id)).join("")}</span>
          <span class="fcd-name"><b>${esc(d.name)}</b><small>${esc(d.text)}</small></span></button>`,
      ).join("")}</div>
      <p class="fcd-note" role="status"></p></div>`;
  const note = root.querySelector(".fcd-note");
  let design = DEFAULT_DESIGN;
  const show = (id) => {
    design = isDesign(id) ? id : DEFAULT_DESIGN;
    for (const b of root.querySelectorAll(".fcd-design")) {
      const on = b.dataset.design === design;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(on));
    }
  };
  show(DEFAULT_DESIGN);
  const read = () => ctx.store?.get("design").then(show, () => (retry = setTimeout(read, 3000)));
  let retry = null;
  read();
  const stop = ctx.store?.onChange((key, value) => (key === "design" ? show(value) : key === null ? read() : null));
  root.querySelector(".fcd-list").addEventListener("click", async (e) => {
    const b = e.target.closest(".fcd-design");
    if (!b || b.dataset.design === design) return;
    const before = design;
    show(b.dataset.design); // at once; back if the table does not take it
    note.textContent = "";
    const r = await ctx.store?.set("design", b.dataset.design);
    if (!r?.ok) {
      show(before);
      note.textContent = r?.reason ?? "The table did not take the change. Try again.";
    }
  });
  return {
    update(view) {
      const home = view.home.reduce((a, b) => a + b, 0);
      root.querySelector(".fcd-state").textContent = view.over === "won" ? `Deal ${view.deal} is solved.` : view.over ? `Deal ${view.deal} is over.` : `Deal ${view.deal} · ${home} of 52 cards home`;
    },
    destroy() {
      stop?.();
      clearTimeout(retry);
    },
  };
}
