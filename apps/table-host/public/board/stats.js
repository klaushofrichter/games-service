// The statistics window (D-140): a finished game's awards and statistics on the board, scrollable. The game sends
// the data (its summary's `awards` and `table`); the host adds `players` and `play` from the log. Used by the board
// (after a game, and on the result screen) and by the Game Viewer.
import { esc, ROT } from "/shared/board-kit.js";

/** Whether a summary has anything for the statistics window. */
export function hasStatistics(summary) {
  return !!summary && ((summary.awards?.length ?? 0) > 0 || !!summary.table || !!summary.play);
}

const EDGES = [
  ["south", "S"],
  ["north", "N"],
  ["west", "W"],
  ["east", "E"],
];

/**
 * A summary's seats by the names its tables use (D-253): each seat's player at the end, also with the * of a seat
 * another player took over. A table's first cell that is one of these names shows in that player's colour.
 */
export function seatsByName(summary) {
  const m = new Map();
  for (const p of summary?.players ?? []) {
    m.set(String(p.name), p.seat);
    m.set(`${p.name} *`, p.seat);
  }
  return m;
}

/** A table of the summary; a row's first cell that names a player is marked with its seat, for its colour (D-253). */
export function table(t, cls, seats = new Map()) {
  const cell = (c, i) => (i === 0 && seats.has(String(c)) ? `<td><span class="player-name" data-seat="${seats.get(String(c))}">${esc(c)}</span></td>` : `<td>${esc(c)}</td>`);
  return `<table class="${cls}"><tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>
    ${t.rows.map((r) => `<tr>${r.map(cell).join("")}</tr>`).join("")}</table>`;
}

/**
 * Open the window. `edge` is the edge it first faces; `turnable` shows the S/N/W/E buttons that turn it to another
 * edge (the board at the table; a remote board faces its own player). `colorOf(seat)` gives a seat's player colour
 * now (D-239): award holders show in it, and the overlay's `recolor()` applies a colour changed while it is open; the
 * Game Viewer gives none (old games keep no colours), so names stay brass. Returns the overlay element.
 */
export function openStatistics({ summary, gameName, overlayRoot, edge = "south", turnable = false, onClose, backToGame = false, colorOf = null }) {
  const o = document.createElement("div");
  o.className = "overlay statistics";
  // A seat another player took over shows the last player's name with * (D-159), explained under the window.
  const names = new Map((summary.players ?? []).map((p) => [p.seat, p.changed ? `${p.name} *` : p.name]));
  const changed = (summary.players ?? []).some((p) => p.changed);
  const holders = (seats) => {
    const n = seats.map((s) => `<span class="award-name" data-seat="${s}">${esc(names.get(s) ?? `Seat ${s + 1}`)}</span>`);
    return n.length < 2 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`;
  };
  const awards = summary.awards ?? [];
  const seats = seatsByName(summary); // the results' names in the players' colours (D-253)
  const awardsHtml = awards.length
    ? `<div class="awards">${awards
        .map(
          (a) => `<article class="award" data-award="${esc(a.id)}"><span class="award-icon" aria-hidden="true">${esc(a.icon)}</span>
          <h3>${esc(a.title)}</h3><p class="award-holders">${holders(a.seats)}</p>${a.value ? `<em>${esc(a.value)}</em>` : ""}${a.blurb ? `<small>${esc(a.blurb)}</small>` : ""}</article>`,
        )
        .join("")}</div>`
    : `<p class="no-awards">No awards in this game.</p>`;
  const turn = turnable
    ? `<div class="stats-turn" role="group" aria-label="Turn the window"><span>Turn to</span>${EDGES.map(([e, l]) => `<button type="button" data-face="${e}" aria-label="Turn to the ${e} edge">${l}</button>`).join("")}</div>`
    : "";
  o.innerHTML = `<div class="panel stats-panel" role="dialog" aria-modal="true" aria-label="Awards and Results">
    <div class="stats-head"><h2>${esc(gameName ?? "Game")} · Awards and Results</h2>${turn}${backToGame ? `<button type="button" data-back-stats>Back to game</button>` : ""}<button type="button" class="primary" data-close-stats>Done</button></div>
    <div class="stats-body"><p class="stats-result">${esc(summary.text ?? "")}</p>
    <h4>Awards</h4>${awardsHtml}
    ${summary.table ? `<h4>Results</h4>${table(summary.table, "stats-table game", seats)}` : ""}
    ${summary.play ? `<h4>Statistics</h4>${table(summary.play, "stats-table play", seats)}` : ""}
    ${changed ? `<p class="stats-note">* Another player took over this seat during the game.</p>` : ""}</div>
  </div>`;
  const panel = o.querySelector(".panel");
  const face = (e) => {
    panel.style.transform = `rotate(${ROT[e] ?? 0}deg)`;
    panel.classList.toggle("sideways", e === "east" || e === "west");
    o.dataset.face = e;
    for (const b of o.querySelectorAll("[data-face]")) b.classList.toggle("on", b.dataset.face === e);
  };
  face(edge);
  o.recolor = () => {
    for (const el of o.querySelectorAll(".award-name, .player-name")) el.style.color = (colorOf && colorOf(Number(el.dataset.seat))) || "";
  };
  o.recolor();
  const close = () => {
    o.remove();
    onClose?.();
  };
  o.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (e.target === o || b?.dataset.closeStats !== undefined) return close();
    // Opened from a game's last screen: back to that screen, which keeps its way on (D-233).
    if (b?.dataset.backStats !== undefined) return void o.remove();
    if (b?.dataset.face) face(b.dataset.face);
  });
  overlayRoot.appendChild(o);
  return o;
}
