export function mount(root, ctx) {
  root.innerHTML = `<div class="card"><div class="eyebrow">Dice Duel</div><div class="display dd-mine" style="font-size:2em">…</div></div>
    <button class="primary big dd-roll">Roll</button>`;
  root.querySelector(".dd-roll").addEventListener("click", () => ctx.send("roll"));
  return {
    update(v) {
      root.querySelector(".dd-mine").textContent = v.mine ?? "…";
      root.querySelector(".dd-roll").disabled = !!v.mine;
    },
    destroy() {},
  };
}
