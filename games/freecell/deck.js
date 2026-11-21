// FreeCell on the phone: nothing to do here. The game is played on the board (D-308).
export function mount(root) {
  root.innerHTML = `<div class="card center"><div class="eyebrow">FreeCell</div>
    <p style="font-size:1.1em;margin:.6em 0 .2em">This game is played on the board.</p>
    <p class="muted fc-deck-state" style="margin:0"></p></div>`;
  return {
    update(view) {
      const text = view.over === "won" ? `Deal ${view.deal} is solved.` : view.over ? `Deal ${view.deal} is over.` : `Deal ${view.deal} · ${view.home.reduce((a, b) => a + b, 0)} of 52 cards home`;
      root.querySelector(".fc-deck-state").textContent = text;
    },
    destroy() {},
  };
}
