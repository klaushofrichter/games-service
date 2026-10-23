// Card Sling board: the platform's sling (D-189, /shared/sling.js) with the simplest game around it. Cards come in
// at the player's edge of the board while they drag (the back, until the move is made), fly to the pile when played,
// and fly back to a seat when drawn. A test game: the board shows it only with SHOW_TEST_GAMES=1.
import { seatPlates, useStyles } from "/shared/board-kit.js";
import { slingBoard } from "/shared/sling.js";
import { cardBack, cardFace } from "/games/card-sling/assets/cards.js";

const CW = 120, CH = 180;
const PILE = { x: 960, y: 520 };

export function mount(root, ctx) {
  useStyles("/games/card-sling/board.css");
  root.innerHTML = `<div class="cs-root"><div class="cs-pile"></div><div class="cs-count"></div></div>`;
  const box = root.querySelector(".cs-root");
  const $ = (s) => root.querySelector(s);
  let view = null;
  const landing = new Set();
  const sling = slingBoard(box, { render: (c, { back }) => (back ? cardBack(CW, CH) : cardFace(c, CW, CH)), size: { w: CW, h: CH }, speed: () => 1.5 });

  function renderPile() {
    $(".cs-pile").innerHTML = (view?.pile ?? [])
      .filter((c) => !landing.has(c.id))
      .map((c) => `<div style="transform:translate(${PILE.x + c.dx - CW / 2}px,${PILE.y + c.dy - CH / 2}px) rotate(${c.angle}deg)">${cardFace(c, CW, CH)}</div>`)
      .join("");
  }

  return {
    update(v, events, info) {
      view = v;
      sling.info(info);
      seatPlates(box, info, (seat) => `${v.counts[seat] ?? 0} cards`);
      $(".cs-count").textContent = `${v.played} of ${v.plays} cards played`;
      for (const e of events) {
        if (e.name === "played") {
          const c = e.data.card;
          landing.add(c.id);
          sling.fly(e.data.seat, { id: c.id, item: c, to: { x: PILE.x + c.dx, y: PILE.y + c.dy, angle: c.angle } }).then(() => (landing.delete(c.id), renderPile()));
        } else if (e.name === "drew") sling.toSeat(e.data.seat, { from: { x: PILE.x, y: PILE.y, angle: 0 } });
      }
      renderPile();
    },
    gesture: (seat, data) => sling.gesture(seat, data),
    whenIdle: () => new Promise((r) => setTimeout(r, landing.size ? 900 : 0)),
    destroy: () => sling.destroy(),
  };
}
