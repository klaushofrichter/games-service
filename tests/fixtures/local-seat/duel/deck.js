// Test game Duel: nothing on the phone.
export function mount(root) {
  root.innerHTML = `<div style="position:absolute;inset:0;display:grid;place-items:center;font-size:20px">Duel</div>`;
  return { update() {}, destroy() {} };
}
