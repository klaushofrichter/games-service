// Playing-card rendering shared by the Hold'em board and deck.
const SUIT = { c: "♣", d: "♦", h: "♥", s: "♠" };
const RANK = { T: "10" };

export const CARD_CSS = `
.hc { display: inline-grid; grid-template-rows: auto 1fr; width: var(--w, 96px); height: calc(var(--w, 96px) * 1.4); border-radius: calc(var(--w, 96px) * .1);
  background: linear-gradient(160deg, #fffdf7, #efe8d6); color: #1b1a17; box-shadow: 0 8px 18px rgba(0,0,0,.45); padding: calc(var(--w, 96px) * .07);
  font-family: var(--display); font-weight: 700; position: relative; flex: none; }
.hc.red { color: #b3261e; }
.hc .r { font-size: calc(var(--w, 96px) * .34); line-height: 1; }
.hc .s { font-size: calc(var(--w, 96px) * .5); line-height: 1; place-self: center; }
.hc.back { background: repeating-linear-gradient(45deg, #7a1f1a 0 6px, #8e2a23 6px 12px); border: calc(var(--w, 96px) * .05) solid #f3eee2; }
.hc.empty { background: rgba(255,255,255,.04); border: 2px dashed rgba(255,255,255,.15); box-shadow: none; }
.hc.win { box-shadow: 0 0 0 4px #d6a94a, 0 0 30px rgba(214,169,74,.8); }
.hc.deal { animation: hc-deal .45s cubic-bezier(.2,.7,.2,1) both; }
@keyframes hc-deal { from { transform: translateY(-40px) rotate(-8deg); opacity: 0; } }
`;

export function card(c, opts = {}) {
  const w = opts.width ? `--w:${opts.width}px;` : "";
  if (!c) return `<div class="hc empty" style="${w}"></div>`;
  if (c === "back") return `<div class="hc back ${opts.cls ?? ""}" style="${w}"></div>`;
  const red = c[1] === "h" || c[1] === "d";
  return `<div class="hc ${red ? "red" : ""} ${opts.cls ?? ""}" style="${w}"><span class="r">${RANK[c[0]] ?? c[0]}</span><span class="s">${SUIT[c[1]]}</span></div>`;
}

export function injectCardStyles() {
  if (document.getElementById("hc-css")) return;
  const s = document.createElement("style");
  s.id = "hc-css";
  s.textContent = CARD_CSS;
  document.head.appendChild(s);
}
