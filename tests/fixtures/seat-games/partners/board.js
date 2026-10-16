// Partners on the board: the score of each team.
export function mount(root) {
  root.innerHTML = `<div class="partners" style="position:absolute;inset:0;display:grid;place-items:center;font:600 56px system-ui;color:#f3eee2"><div data-score></div></div>`;
  return {
    update(view) {
      root.querySelector("[data-score]").textContent = Object.entries(view.score).map(([t, n]) => `Team ${t}: ${n}`).join("   ");
    },
    destroy() {
      root.innerHTML = "";
    },
  };
}
