"""Browser check: exchanging a seat's player during a game (D-159).
  python3 scripts/e2e/exchange.py out/

A Table Host of its own (port 8137). Ann and Ben play Coin Flip. On the board, Settings › Players › Ben (the name, D-166):
"Someone at the table" shows a QR code and its link, and the window waits; a new phone opens the link, joins as Cleo
and takes Ben's seat (colour kept), and the window closes by itself. Then Cleo's name, "An AI player", confirmed:
"Cleo (AI)" plays the seat. Ann, now the last player at the table, for an AI: the board asks first and switches on
games without a player at the table (D-223). The board can't remove a player of the running game. Ben's phone is told why it lost the seat.
"""
import os, sys
from playwright.sync_api import sync_playwright
from common import api, errors, join_deck, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
BASE = "http://127.0.0.1:8137"
KEY = "exk"


def a(method, path, body=None):
    return api(method, path, body, base=BASE, key=KEY)


def players():
    return {p["name"]: p for p in a("GET", "/state")["players"]}


proc = start_table(8137, TABLE_KEY=KEY, PUBLIC_URL=BASE)
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        board = br.new_page(viewport={"width": 1920, "height": 1080})
        watch(board, "board")
        board.goto(BASE + "/board/")
        ann = br.new_page(viewport={"width": 390, "height": 844})
        watch(ann, "Ann")
        join_deck(ann, a("GET", "/join")["url"], "Ann")
        ben = br.new_page(viewport={"width": 390, "height": 844})
        join_deck(ben, a("GET", "/join")["url"], "Ben")
        a("POST", "/game/select", {"gameId": "coin-flip", "settings": {"rounds": 20, "roundSeconds": 0}})
        ann.click("#ready")
        ben.click("#ready")
        wait(lambda: all(pl["ready"] for pl in players().values()), 10, "everyone ready")
        a("POST", "/game/start", {})
        ben.wait_for_selector("[data-guess=heads]")
        ben_seat, ben_color = players()["Ben"]["seat"], players()["Ben"]["color"]
        # A running game keeps its players.
        try:
            a("DELETE", f"/players/{players()['Ben']['id']}")
            raise AssertionError("the board removed a player of the running game")
        except AssertionError:
            raise
        except Exception:
            pass  # refused (409): a running game keeps its players

        board.click("#settings-button")
        board.wait_for_selector(".overlay.settings [data-exchange]")
        board.screenshot(path=os.path.join(OUT, "exchange-settings.png"))
        board.click(f".overlay.settings [data-exchange='{players()['Ben']['id']}']")
        board.wait_for_selector(".overlay.exchange [data-ex=local]")
        board.screenshot(path=os.path.join(OUT, "exchange-choices.png"))
        board.click(".overlay.exchange [data-ex=local]")
        board.wait_for_selector(".overlay.exchange .join-big img")
        board.wait_for_timeout(400)
        board.screenshot(path=os.path.join(OUT, "exchange-qr.png"))
        url = a("GET", "/state")["exchange"]["url"]
        assert board.locator(".overlay.exchange").inner_text().count("Waiting for the new player") == 1
        cleo = br.new_page(viewport={"width": 390, "height": 844})
        watch(cleo, "Cleo")
        cleo.goto(url)
        cleo.fill("input[name=name]", "Cleo")
        cleo.click("button[type=submit]")
        cleo.wait_for_selector("#tab-table")  # straight into the game
        board.wait_for_selector(".overlay.exchange", state="detached", timeout=5000)
        cl = players()["Cleo"]
        assert cl["seat"] == ben_seat and cl["color"] == ben_color, cl
        assert "Ben" not in players()
        ben.wait_for_selector("text=Your seat went to someone else", timeout=5000)  # Ben's phone: told why it lost the seat
        cleo.wait_for_selector("[data-guess=heads]", timeout=5000)
        # Cleo for an AI player.
        if not board.locator(".overlay.settings").count():
            board.click("#settings-button")
        board.click(f".overlay.settings [data-exchange='{cl['id']}']")
        board.click(".overlay.exchange [data-ex=ai]")
        board.locator("button", has_text="Exchange").last.click()
        wait(lambda: players().get("Cleo (AI)", {}).get("seat") == ben_seat, 10, "Cleo (AI) in the seat")
        assert a("GET", "/state")["phase"] == "active"
        # D-223: Ann is now the last player at the table. Exchanging her asks first, says the developer setting goes on,
        # and switches it on with the exchange, so the next game can start without anyone at the table.
        assert a("GET", "/state")["developer"]["allowNoLocalPlayer"] is False
        if not board.locator(".overlay.settings").count():
            board.click("#settings-button")
        board.click(f".overlay.settings [data-exchange='{players()['Ann']['id']}']")
        board.click(".overlay.exchange [data-ex=ai]")
        board.wait_for_selector(".dialog >> text=the last player at the table", timeout=5000)
        assert "“Games without a player at the table”, so it is switched on now" in board.inner_text(".dialog")
        board.screenshot(path=os.path.join(OUT, "exchange-last-player.png"))
        board.locator("button", has_text="Exchange").last.click()
        wait(lambda: "Ann (AI)" in players(), 10, "Ann (AI) in the seat")
        assert a("GET", "/state")["developer"]["allowNoLocalPlayer"] is True, "the developer setting stayed off"
        assert a("GET", "/state")["phase"] == "active"
        br.close()
finally:
    proc.terminate()
if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("exchange: ok")
