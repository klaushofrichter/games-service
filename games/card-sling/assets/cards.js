// Card faces for the Card Sling experiment: UNO-like colours and numbers, drawn as SVG at any size.
const FILL = { red: "#e5484d", yellow: "#f2c230", green: "#3fb05f", blue: "#3b82e0" };

/** A card's face as an <svg>, w × h pixels. */
export function cardFace(card, w, h) {
  // The face may come from a phone's gesture (D-202): only known colours and short plain values reach the markup.
  const color = Object.hasOwn(FILL, card?.color) ? card.color : "";
  const value = String(card?.value ?? "").replace(/[^\w+-]/g, "").slice(0, 3);
  card = { color, value };
  const c = FILL[color] ?? "#888";
  const big = h * 0.36, small = h * 0.13;
  return `<svg viewBox="0 0 100 150" width="${w}" height="${h}" aria-label="${card.color} ${card.value}">
    <rect x="1" y="1" width="98" height="148" rx="10" fill="#fff"/>
    <rect x="6" y="6" width="88" height="138" rx="7" fill="${c}"/>
    <ellipse cx="50" cy="75" rx="34" ry="52" transform="rotate(28 50 75)" fill="#fff"/>
    <text x="50" y="${75 + big * 0.36 * (150 / h)}" text-anchor="middle" font-size="${big * (150 / h)}" font-weight="800" font-family="system-ui,sans-serif" fill="${c}" stroke="#1b1b1b" stroke-width="1.2">${card.value}</text>
    <text x="15" y="${22}" text-anchor="middle" font-size="${small * (150 / h)}" font-weight="800" font-family="system-ui,sans-serif" fill="#fff">${card.value}</text>
    <text x="85" y="140" text-anchor="middle" font-size="${small * (150 / h)}" font-weight="800" font-family="system-ui,sans-serif" fill="#fff" transform="rotate(180 85 133)">${card.value}</text>
  </svg>`;
}

/** The back of a card, w × h pixels. */
export function cardBack(w, h) {
  return `<svg viewBox="0 0 100 150" width="${w}" height="${h}" aria-hidden="true">
    <rect x="1" y="1" width="98" height="148" rx="10" fill="#fff"/>
    <rect x="6" y="6" width="88" height="138" rx="7" fill="#1b1b1b"/>
    <ellipse cx="50" cy="75" rx="30" ry="48" transform="rotate(28 50 75)" fill="#e5484d"/>
    <text x="50" y="84" text-anchor="middle" font-size="26" font-weight="900" font-style="italic" font-family="system-ui,sans-serif" fill="#f2c230" transform="rotate(-18 50 75)">SLING</text>
  </svg>`;
}
