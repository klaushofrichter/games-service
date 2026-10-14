import { esc, html } from "/shared/board-kit.js";

export function mount(root) {
  const box = html(`<div class="dd" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;font-size:40px"></div>`);
  root.appendChild(box);
  return {
    update(v, _e, info) {
      box.style.transform = `translate(-50%,-50%) rotate(${info.rotation}deg)`;
      box.innerHTML = `<div class="eyebrow">Dice Duel</div>` + v.seats.map((s) => `<div class="dd-row">${esc(v.names[s])}: ${v.rolls[s] ?? "…"}</div>`).join("");
    },
    destroy() {},
  };
}
