"""Browser check: a phone at the table drops during a game and rejoins with the join code from the settings (D-130).
  python3 scripts/e2e/rejoin.py out/

A Table Host of its own (port 8097, a 1.5 s waiting time). Ann and Ben join by phone and play Coin Flip. Ben's phone
goes away for good (its browser closed, so its session is gone too); after the waiting time Ben leaves the table and
the game goes on. On a new phone page Ben is told to scan the code, which the board doesn't show during a game. On the
board, Settings › Show join code shows the QR code and the address; Ben's phone opens that address (as scanning the
code does), joins with his name, gets a seat in the running game (Coin Flip seats newcomers) and can guess again.
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
        a("POST", "/play", {"awayTimeout": True})  # the waiting time is a setting, off by default (D-144)
        a("POST", "/game/start", {})
        ben.wait_for_selector("[data-guess=heads]")

        # Ben's phone goes away for good: after the waiting time he leaves the table; the game goes on with Ann.
        ben_ctx.close()
        wait(lambda: "Ben" not in players(), 10, "Ben to leave the table")
        assert a("GET", "/state")["phase"] == "active"
        assert not any(board.locator("aside.join").nth(i).is_visible() for i in range(board.locator("aside.join").count())), "the lobby's QR panel is not on the screen during a game"

        # A new phone page: Ben is told where the code is.
        ben = phone().new_page()
        watch(ben, "Ben again")
        ben.goto(BASE + "/deck/")
        ben.wait_for_selector("text=Settings › Show join code")

        # The board: Settings › Show join code, during the game.
        board.click("#settings-button")
        board.click(".overlay.settings button[data-join-code]")
        board.wait_for_selector(".overlay.join-code .join-big img")
        shown = board.inner_text(".overlay.join-code .url")
        assert shown == a("GET", "/join")["url"], f"the address shown: {shown}"
        assert a("GET", "/join")["token"] in board.inner_text(".overlay.join-code .code")
        board.screenshot(path=os.path.join(OUT, "rejoin-join-code.png"))

        # Ben "scans" it: his phone opens the address, joins, and is seated in the running game.
        ben.goto(shown)
        ben.fill("input[name=name]", "Ben")
        ben.click("button[type=submit]")
        wait(lambda: players().get("Ben", {}).get("seat") is not None, 10, "Ben seated again")
        assert a("GET", "/state")["phase"] == "active"
        ben.wait_for_selector("[data-guess=heads]", timeout=10000)
        ben.screenshot(path=os.path.join(OUT, "rejoin-phone.png"))

        # The window closes with Done; the settings stay open beneath it until closed too.
        board.click(".overlay.join-code [data-close-overlay]")
        board.wait_for_selector(".overlay.join-code", state="detached")
        board.click(".overlay.settings [data-close-overlay]")
        br.close()
    if errors:
        raise AssertionError("browser errors:\n" + "\n".join(errors))
    print("rejoin: ok")
finally:
    proc.kill()
