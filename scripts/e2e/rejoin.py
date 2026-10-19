"""Browser check: a phone at the table drops during a game and gets its seat back (D-130, D-159).
  python3 scripts/e2e/rejoin.py out/

A Table Host of its own (port 8097, a 1.5 s waiting time). Ann and Ben join by phone and play Coin Flip. Ben's phone
goes away for good (its browser closed, so its session is gone too); his seat waits and the game goes on. On a new
phone page Ben is told to scan the code. On the board, Settings › Show join code shows the QR code and the address
during the game; then Settings › Players › Exchange… Ben, "Someone at the table", shows the seat's own code: Ben's
phone opens it, joins with his name, takes his seat back and can guess again.
"""
import os, sys
from playwright.sync_api import sync_playwright
from common import api, errors, join_deck, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
BASE = "http://127.0.0.1:8097"
KEY = "rejoink"


def a(method, path, body=None):
    return api(method, path, body, base=BASE, key=KEY)


def players():
    return {pl["name"]: pl for pl in a("GET", "/state")["players"]}


proc = start_table(8097, TABLE_KEY=KEY, PUBLIC_URL=BASE, GRACE_MS="1500")
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        board = br.new_page(viewport={"width": 1920, "height": 1080})
        watch(board, "board")
        board.goto(BASE + "/board/")
        phone = lambda: br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True)
        url = a("GET", "/join")["url"]
        ann = phone().new_page()
        watch(ann, "Ann")
        join_deck(ann, url, "Ann")
        ben_ctx = phone()
        ben = ben_ctx.new_page()
        watch(ben, "Ben")
        join_deck(ben, url, "Ben")
        a("POST", "/game/select", {"gameId": "coin-flip", "settings": {"rounds": 20, "roundSeconds": 0}})
        ann.click("#ready")
        ben.click("#ready")
        wait(lambda: all(pl["ready"] for pl in players().values()), 10, "everyone ready")
        a("POST", "/game/start", {})
        ben.wait_for_selector("[data-guess=heads]")

        # Ben's phone goes away for good (its session too): his seat waits (D-144, D-159); the game goes on.
        ben_seat = players()["Ben"]["seat"]
        ben_ctx.close()
        wait(lambda: not players()["Ben"]["connected"], 10, "Ben away")
        assert a("GET", "/state")["phase"] == "active"
        assert not any(board.locator("aside.join").nth(i).is_visible() for i in range(board.locator("aside.join").count())), "the lobby's QR panel is not on the screen during a game"

        # A new phone page: Ben is told where the code is.
        ben = phone().new_page()
        watch(ben, "Ben again")
        ben.goto(BASE + "/deck/")
        ben.wait_for_selector("text=Settings › Show join code")

        # The board: Settings › Show join code, during the game (for someone joining a game that seats newcomers).
        board.click("#settings-button")
        board.click(".overlay.settings button[data-join-code]")
        board.wait_for_selector(".overlay.join-code .join-big img")
        shown = board.inner_text(".overlay.join-code .url")
        assert shown == a("GET", "/join")["url"], f"the address shown: {shown}"
        assert a("GET", "/join")["token"] in board.inner_text(".overlay.join-code .code")
        board.screenshot(path=os.path.join(OUT, "rejoin-join-code.png"))
        board.click(".overlay.join-code [data-close-overlay]")
        board.wait_for_selector(".overlay.join-code", state="detached")

        # Back into his own seat: Settings › Players › Exchange… Ben, someone at the table (D-159). Ben "scans" its
        # code, joins with his name and plays his seat again.
        board.click(f".overlay.settings [data-exchange='{players()['Ben']['id']}']")
        board.click(".overlay.exchange [data-ex=local]")
        board.wait_for_selector(".overlay.exchange .join-big img")
        ben.goto(a("GET", "/state")["exchange"]["url"])
        ben.fill("input[name=name]", "Ben")
        ben.click("button[type=submit]")
        wait(lambda: players().get("Ben", {}).get("seat") == ben_seat and players()["Ben"]["connected"], 10, "Ben in his seat again")
        board.wait_for_selector(".overlay.exchange", state="detached", timeout=5000)
        assert a("GET", "/state")["phase"] == "active"
        ben.wait_for_selector("[data-guess=heads]", timeout=10000)
        ben.screenshot(path=os.path.join(OUT, "rejoin-phone.png"))

        board.click(".overlay.settings [data-close-overlay]")
        br.close()
    if errors:
        raise AssertionError("browser errors:\n" + "\n".join(errors))
    print("rejoin: ok")
finally:
    proc.kill()
