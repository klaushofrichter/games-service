// Test game Forgetful (D-302): the favourites the table keeps, and a button that adds one from this screen.
export function mount(root, ctx) {
  root.innerHTML = `<div class="keeper" style="position:absolute;inset:0;display:grid;place-items:center;align-content:center;gap:16px;font-size:28px">
    <div>Forgetful</div><div class="keeper-list">…</div><button type="button" class="keeper-add">Add a favourite</button></div>`;
  const list = root.querySelector(".keeper-list");
  let favs = [];
  const load = async () => {
    if (!ctx.store) return void (list.textContent = "no store");
    try {
      favs = (await ctx.store.get("favourites")) ?? [];
    } catch {
      return void setTimeout(load, 500); // the table gave no answer just now: ask again, never take it for "none"
    }
    list.textContent = favs.length ? favs.join(", ") : "none";
  };
  const off = ctx.store?.onChange(load);
  root.querySelector(".keeper-add").addEventListener("click", async () => {
    await ctx.store?.set("favourites", [...favs, `phone ${favs.length + 1}`]); // this screen is not told of its own change: it reads again itself
    load();
  });
  load();
  return { update() {}, destroy: () => off?.() };
}
