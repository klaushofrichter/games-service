"""Browser check: a seat has one name everywhere (D-093). Two phones and an AI player at a table whose layout changes
(2, 4, 6, 8 seats and back): after every change, each player's seat must read the same on the board's seat card, on
their phone's badge and in every phone's "At the table" list, and match the compass name from the table's state
(south, southwest …). Then during a game: the badge in the phone's tabs and the "At the table" tab.

  python3 scripts/e2e/seat_names.py out/
"""
import os, sys, time
from playwright.sync_api import sync_playwright
from common import api, errors, join_deck, start_table, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
PORT = 8138
BASE = f"http://127.0.0.1:{PORT}"
CHROMIUM = os.environ.get("CHROMIUM_PATH")
problems = []


def a(m, p, b=None):
    return api(m, p, b, base=BASE, key="k")


def expected(edges, seat):
    """The compass name of a seat, as board-kit.js seatName computes it from the layout."""
    edge = edges[seat]
    mine = [i for i, e in enumerate(edges) if e == edge]
    if len(mine) < 2:
        return edge
    span = 1300
    def along(i):
        k, n = mine.index(i), len(mine)
        x = (1920 - span) / 2 + span * (k + 0.5) / n
        if edge == "north":
            x = 1920 - x
        return x if edge in ("south", "north") else k  # east/west: in order
    order = sorted(mine, key=along)
    ends = ["west", "east"] if edge in ("south", "north") else ["north", "south"]
    k = order.index(seat)
    part = ends[0] if k == 0 else ends[1] if k == len(order) - 1 else ""
    if not part:
        return edge
    return f"{edge}{part}" if edge in ("south", "north") else f"{part}{edge}"


def badge(name):
    for w in ("north", "south", "east", "west"):
        name = name.replace(w, w[0])
    return name.upper()


def check(tag, board, phones, in_game=False):
    time.sleep(0.7)
    st = a("GET", "/state")
    edges = st["seatEdges"]
    seated = [p for p in st["players"] if p["seat"] is not None]
    for p in seated:
        want = expected(edges, p["seat"])
        if not in_game:
            got = board.locator(f".seat:has(.name:text-is('{p['name']}')) .num")
            if got.count() != 1 or got.inner_text().strip().lower() != want:
                problems.append(f"{tag}: board says {got.all_inner_texts()} for {p['name']}, expected {want}")
        for ph in phones:
            rows = [r for r in ph.locator(".list .row").all_inner_texts() if r.split("\n")[0].strip() == p["name"]]
            if not rows or f"{want} seat" not in rows[0]:
                problems.append(f"{tag}: {ph.label}'s list says {rows} for {p['name']}, expected '{want} seat'")
    for ph in phones:
        me = next(p for p in seated if p["name"] == ph.label)
        want = badge(expected(edges, me["seat"]))
        sel = ".tab-seat" if in_game else ".badge"
        got = ph.inner_text(sel).strip() if ph.locator(sel).count() else None
        if got != want:
            problems.append(f"{tag}: {ph.label}'s badge says {got!r}, expected {want!r}")
    print(tag, {p["name"]: expected(edges, p["seat"]) for p in seated})


proc = start_table(PORT, TABLE_KEY="k", PUBLIC_URL=BASE, AI_DELAY_MS="150")
try:
    with sync_playwright() as p:
        br = p.chromium.launch(**({"executable_path": CHROMIUM} if CHROMIUM else {}))
        board = br.new_page(viewport={"width": 1920, "height": 1080})
        watch(board, "board")
        board.goto(BASE + "/board/")
        board.wait_for_selector("button.tile")
        phones = []
        for name in ("Klaus", "Mira"):
            ph = br.new_page(viewport={"width": 390, "height": 844})
            watch(ph, name)
            join_deck(ph, a("GET", "/join")["url"], name)
            ph.label = name
            phones.append(ph)
        a("POST", "/ai", {})
        check("4 seats", board, phones)
        for n in (6, 8, 4, 2, 8, 6, 4):
            try:
                a("POST", "/layout", {"seats": n})
            except Exception as e:  # a layout with fewer seats than players is refused; that's fine
                print(f"layout {n}: {e}")
                continue
            check(f"{n} seats", board, phones)
        phones[0].screenshot(path=os.path.join(OUT, "seat-names-phone.png"))
        # During a game: the tabs' badge, and the list on the table tab.
        a("POST", "/layout", {"seats": 6})
        a("POST", "/game/select", {"gameId": "coin-flip", "settings": {"rounds": 20, "roundSeconds": 0}})
        for ph in phones:
            ph.click("#ready")
        time.sleep(0.4)
        a("POST", "/game/start", {})
        for ph in phones:
            ph.wait_for_selector("#tab-table")
            ph.click("#tab-table")
        check("in a game", board, phones, in_game=True)
        phones[0].screenshot(path=os.path.join(OUT, "seat-names-phone-game.png"))
        br.close()
finally:
    proc.terminate()
if errors or problems:
    print("BROWSER ERRORS:\n" + "\n".join(errors) if errors else "", "\nSEAT NAMES:\n" + "\n".join(problems) if problems else "")
    sys.exit(1)
print("ok: one name per seat, on the board and every phone")
