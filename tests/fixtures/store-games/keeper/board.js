// Test game Keeper (D-302): the favourites the table keeps, and a button that adds one from this screen.
export function mount(root, ctx) {
  root.innerHTML = `<div class="keeper" style="position:absolute;inset:0;display:grid;place-items:center;align-content:center;gap:16px;font-size:28px">
    <div>Keeper</div><div class="keeper-list">…</div><button type="button" class="keeper-add">Add a favourite</button></div>`;
  const list = root.querySelector(".keeper-list");
  let favs = [];
  const load = async () => {
    if (!ctx.store) return void (list.textContent = "no store");
    favs = (await ctx.store.get("favourites")) ?? [];
    list.textContent = favs.length ? favs.join(", ") : "none";
  };
  const off = ctx.store?.onChange(load);
  root.querySelector(".keeper-add").addEventListener("click", () => ctx.store?.set("favourites", [...favs, `board ${favs.length + 1}`]));
  load();
  return { update() {}, destroy: () => off?.() };
}
