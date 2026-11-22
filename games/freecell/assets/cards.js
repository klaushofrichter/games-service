// FreeCell's cards and their designs (D-310), for the board and for the phone's preview. A card is a number 0–51:
// rank = card >> 2 (0 ace … 12 king), suit = card & 3 (0 ♠, 1 ♥, 2 ♦, 3 ♣). A design is a class on the element around
// the cards (`fc-d-<id>`, styled in cards.css) and what a card's face holds: its corner, and a pip or a picture.

export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const SUITS = ["♠", "♥", "♦", "♣"];
const ART = "/games/freecell/assets/designs/";
const COURT = { 10: "j", 11: "q", 12: "k" };
const FLOWERS = ["Daisy", "California Poppy", "Bluebell", "Wallflower", "Sweet Violet", "Cornflower", "Foxglove", "Primrose", "Marigold", "Lavender", "Thistle", "Rose", "Sunflower"];
const FLOWER_FILE = ["a", "2", "3", "4", "5", "6", "7", "8", "9", "10", "j", "q", "k"];

/** The designs, the table's own look first: it is the one used until another is chosen. */
export const DESIGNS = [
  { id: "classic", name: "Classic", text: "The table's own cards." },
  { id: "plain", name: "Plain", text: "Large, clear, no decoration." },
  { id: "mosaic", name: "Mosaic", text: "Green and gold, with tiled court cards." },
  { id: "botanical", name: "Botanical", text: "A flower for every rank." },
  { id: "linea", name: "Linea", text: "Line drawings in each suit's colour; corners in red and black." },
  { id: "speakeasy", name: "Speakeasy", text: "Sketches from the twenties on old paper." },
];
export const DEFAULT_DESIGN = "classic";
export const isDesign = (id) => DESIGNS.some((d) => d.id === id);

const rank = (c) => c >> 2;
const suit = (c) => c & 3;
const img = (file, cls) => `<img class="fc-art ${cls}" src="${ART}${file}.webp" alt="" draggable="false">`;

/** What lies under a card's corner in a design: a picture where the design has one, else the suit. */
function middle(c, design) {
  const r = rank(c), s = SUITS[suit(c)];
  const pip = `<span class="fc-pip">${s}</span>`;
  if (design === "botanical") return `${img(`flower-${FLOWER_FILE[r]}`, "fc-flower")}<span class="fc-caption">${FLOWERS[r]}</span>`;
  if (COURT[r] && design === "mosaic") return img(`mosaic-${COURT[r]}`, "fc-court");
  if (COURT[r] && design === "speakeasy") return img(`club-${COURT[r]}`, "fc-scene");
  // a line figure in its suit's colour: the drawing is the mask, the colour comes from the card
  if (COURT[r] && design === "linea") return `<span class="fc-art fc-mask" style="--art:url(${ART}line-${COURT[r]}.webp)"></span>`;
  return pip;
}

/** The inside of a card's element, for a design. */
export function face(c, design = DEFAULT_DESIGN) {
  return `<span class="fc-ix">${RANKS[rank(c)]}<i>${SUITS[suit(c)]}</i></span>${middle(c, isDesign(design) ? design : DEFAULT_DESIGN)}`;
}

/** The classes of a card's element: its colour family, its suit, and whether it is a court card. */
export function cardClass(c) {
  const s = suit(c);
  return `fc-card ${s === 1 || s === 2 ? "red" : ""} fc-s${s} ${rank(c) >= 10 ? "fc-face" : ""} ${rank(c) === 0 ? "fc-ace" : ""}`;
}

/** A whole card as markup (the phone's preview). */
export const cardHtml = (c, design) => `<div class="${cardClass(c)}" data-card="${c}">${face(c, design)}</div>`;
