"""Layout checks in a real browser, for the dev host on port 8090 (TABLE_KEY=devkey):
  - decks at common phone sizes, in the lobby and in every game: no sideways scrolling, and every
    visible button big enough to tap (at least 40 px high, 44 px wide or labelled wide)
  - the board at common screen sizes: the 16:9 surface fits the window, nothing scrolls
  python3 scripts/e2e/layout.py out/
"""
import json, os, sys, time, urllib.request
from playwright.sync_api import sync_playwright

BASE, KEY = "http://127.0.0.1:8090", "devkey"
OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
problems, errors = [], []

PHONES = {"small-android": (360, 640), "iphone-se": (320, 568), "iphone-14": (390, 844), "landscape": (844, 390)}
SCREENS = {"hd": (1280, 720), "laptop": (1366, 768), "fullhd": (1920, 1080), "4k": (3840, 2160), "4:3": (1024, 768)}
GAMES = {"roulette": {"rounds": 1, "bettingSeconds": 60}, "pachisi": {"turnSeconds": 60, "tokens": 2}, "holdem": {}}


def api(method, path, body=None):
    req = urllib.request.Request(BASE + "/api/v1" + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"x-table-key": KEY, "content-type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b"{}")


def reset():
    st = api("GET", "/state")
    if st["phase"] in ("active", "paused"):
        api("POST", "/game/end", {})
    if st["phase"] in ("ready", "finished", "active", "paused"):
        try:
            api("POST", "/game/close", {})
        except Exception:
            pass
    for p in api("GET", "/state")["players"]:
        api("DELETE", f"/players/{p['id']}")
    api("POST", "/layout", {"seats": 4})


CHECK = """() => {
  const w = innerWidth, out = [];
  if (document.documentElement.scrollWidth > w + 1) out.push(`page is ${document.documentElement.scrollWidth}px wide in a ${w}px window`);
  for (const b of document.querySelectorAll('button, [role=button], input[type=checkbox], a.button')) {
    const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
    if (!r.width || !r.height || cs.visibility === 'hidden' || b.closest('[hidden]')) continue;
    if (r.right > w + 1) out.push(`"${(b.textContent || b.className).trim().slice(0, 30)}" sticks out to ${Math.round(r.right)}px`);
    if (r.height < 40 && b.type !== 'checkbox') out.push(`"${(b.textContent || b.className).trim().slice(0, 30)}" is only ${Math.round(r.height)}px high`);
  }
  // nothing may stick out of the panel (card) it sits in
  for (const card of document.querySelectorAll('.card, [class*="-panel"], [class$="card"]')) {
    const c = card.getBoundingClientRect();
    if (!c.width) continue;
    for (const el of card.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).position === 'fixed') continue;
      if (r.left < c.left - 1 || r.right > c.right + 1)
        out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} sticks out of its ${String(card.className).split(' ')[0]} by ${Math.round(Math.max(c.left - r.left, r.right - c.right))}px`);
    }
  }
  return out;
}"""


def check(page, where):
    for p in page.evaluate(CHECK):
        problems.append(f"{where}: {p}")


def watch(page, name):
    page.on("console", lambda m: m.type == "error" and errors.append(f"{name}: {m.text}"))
    page.on("pageerror", lambda e: errors.append(f"{name}: {e}"))


with sync_playwright() as p:
    b = p.chromium.launch()
    # ----- decks -----
    for phone, (w, h) in PHONES.items():
        for game, settings in GAMES.items():
            reset()
            ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, has_touch=True)
            d = ctx.new_page()
            watch(d, f"{phone}/{game}")
            d.goto(api("GET", "/join")["url"])
            check(d, f"deck {phone} join form")
            d.fill("input[name=name]", "Alexandra-Maximiliane")  # a long name
            d.click("button[type=submit]")
            d.wait_for_selector(".seatcard")
            api("POST", "/ai", {})
            api("POST", "/game/select", {"gameId": game, "settings": settings})
            time.sleep(0.3)
            check(d, f"deck {phone} lobby ({game} selected)")
            d.click("#ready")
            time.sleep(0.2)
            api("POST", "/game/start", {})
            time.sleep(1.2)
            check(d, f"deck {phone} in {game}")
            # on your turn, something to press must be on screen without scrolling
            for _ in range(30):
                if d.evaluate("() => /your turn/i.test(document.body.innerText)"):
                    break
                time.sleep(0.2)
            if d.evaluate("() => /your turn/i.test(document.body.innerText)"):
                d.wait_for_timeout(300)
                if not d.evaluate("""() => [...document.querySelectorAll('#body button:not([disabled])')].some((b) => {
                      const r = b.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; })"""):
                    problems.append(f"deck {phone} in {game}: on your turn no action button is visible without scrolling")
            if phone == "iphone-se":
                d.screenshot(path=os.path.join(OUT, f"layout-{phone}-{game}.png"))
            ctx.close()
    reset()
    # ----- board -----
    for name, (w, h) in SCREENS.items():
        page = b.new_page(viewport={"width": w, "height": h})
        watch(page, f"board {name}")
        page.goto(BASE + "/board/")
        page.wait_for_selector("text=Pick a game")
        page.wait_for_timeout(300)
        fit = page.evaluate("""() => { const r = document.getElementById('surface').getBoundingClientRect();
          return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight,
                   sx: document.documentElement.scrollWidth, sy: document.documentElement.scrollHeight }; }""")
        if fit["l"] < -1 or fit["t"] < -1 or fit["r"] > fit["w"] + 1 or fit["b"] > fit["h"] + 1:
            problems.append(f"board {name}: surface {fit} does not fit")
        if fit["sx"] > w + 1 or fit["sy"] > h + 1:
            problems.append(f"board {name}: page scrolls ({fit['sx']}x{fit['sy']})")
        filled = max((fit["r"] - fit["l"]) / w, (fit["b"] - fit["t"]) / h)
        if filled < 0.97:
            problems.append(f"board {name}: surface uses only {filled:.0%} of the screen")
        page.close()
    b.close()

if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
if problems:
    print("LAYOUT PROBLEMS:\n" + "\n".join(sorted(set(problems))))
if errors or problems:
    sys.exit(1)
print(f"ok: layout on {len(PHONES)} phone sizes x {len(GAMES)} games and {len(SCREENS)} board sizes")
