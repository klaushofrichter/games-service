// Playing-card rendering shared by the Hold'em board and deck.
const SUIT = { c: "♣", d: "♦", h: "♥", s: "♠" };
const RANK = { T: "10" };

export function card(c, opts = {}) {
  if (!c) return `<div class="hc empty"></div>`;
  if (c === "back") return `<div class="hc back ${opts.cls ?? ""}"></div>`;
  const red = c[1] === "h" || c[1] === "d";
  return `<div class="hc ${red ? "red" : ""} ${opts.cls ?? ""}"><span class="r">${RANK[c[0]] ?? c[0]}</span><span class="s">${SUIT[c[1]]}</span></div>`;
}
