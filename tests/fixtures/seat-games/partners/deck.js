// Partners on a phone: score a point for your team.
export function mount(root, ctx) {
  root.innerHTML = `<div style="padding:16px;font:18px system-ui"><p data-score></p><button data-point style="min-height:44px">Point</button></div>`;
  root.addEventListener("click", (e) => {
    if (e.target.closest("button[data-point]")) ctx.send("point");
  });
  return {
    update(view) {
      root.querySelector("[data-score]").textContent = Object.entries(view.score).map(([t, n]) => `Team ${t}: ${n}`).join(", ");
    },
    destroy() {
      root.innerHTML = "";
    },
  };
}
