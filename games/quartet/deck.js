// Quartet deck UI: one button, enabled on your turn.
export function mount(root, ctx) {
  root.innerHTML = `<div class="card"><div class="stat"><span class="eyebrow">Passes</span><span class="n q-n"></span></div></div>
    <button class="primary big q-pass"></button>`;
  const btn = root.querySelector(".q-pass");
  btn.addEventListener("click", async () => {
    const r = await ctx.send("pass");
    if (!r.ok) ctx.toast(r.reason);
  });
  return {
    update(v) {
      root.querySelector(".q-n").textContent = `${v.passes}/${v.total}`;
      btn.disabled = !v.myTurn;
      btn.textContent = v.myTurn ? "Pass the token" : "Wait for your turn";
      if (v.myTurn) ctx.vibrate?.(60);
    },
  };
}
