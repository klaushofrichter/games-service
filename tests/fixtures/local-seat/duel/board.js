// Test game Duel: nothing to draw.
export function mount(root) {
  root.innerHTML = `<div style="position:absolute;inset:0;display:grid;place-items:center;font-size:40px">Duel</div>`;
  return { update() {}, destroy() {} };
}
