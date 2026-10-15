// Think Race on a phone: add 1 or 2 to the count.
export function mount(root, ctx) {
  root.innerHTML = `<div style="padding:16px;font:18px system-ui"><p data-count></p><button data-n="1" style="min-height:44px">Add 1</button> <button data-n="2" style="min-height:44px">Add 2</button></div>`;
  root.addEventListener("click", (e) => {
    const n = Number(e.target.closest("button[data-n]")?.dataset.n);
    if (n) ctx.send("add", { n });
  });
  return {
    update(view) {
      root.querySelector("[data-count]").textContent = `Count ${view.count} of ${view.target}`;
    },
    destroy() {
      root.innerHTML = "";
    },
  };
}
