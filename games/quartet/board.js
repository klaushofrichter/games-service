// Quartet board UI: highlights the seat holding the token.
import { esc, html, seatPlates } from "/shared/board-kit.js";

export function mount(root) {
  const center = html(`<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center">
    <div class="eyebrow" style="font-size:22px">Pass the token</div>
    <div class="q-count display" style="font-size:120px;color:var(--brass)"></div>
    <div class="q-holder" style="font-size:30px"></div></div>`);
  root.appendChild(center);
  return {
    update(view, _events, info) {
      center.style.transform = `translate(-50%,-50%) rotate(${info.rotation}deg)`;
      center.querySelector(".q-count").textContent = `${view.passes}/${view.total}`;
      center.querySelector(".q-holder").innerHTML = `Token is with <b>${esc(view.holderName)}</b>`;
      seatPlates(root, info, (seat) => (seat === view.holder ? "holds the token" : ""), { active: view.holder });
    },
  };
}
