"""Browser check of "Play from the board" (D-175), a developer setting: switched on under Developer settings, the
board moves into a page with one player's deck beside it, laid out like a remote player's page; the deck takes a seat
without a phone or join code, also with a stale session saved (no warning, D-218); the QR code goes and a phone with the code is turned away; the player plays a game of
Coin Flip from the deck against an AI, handed to an AI player mid-game and taking the seat back as before (D-222); Hide and Show fold the deck; Fullscreen takes the whole page, deck included
(D-184); switched off, the board is alone again and the
player stays at the table.
A Table Host of its own (port 8139), without the cloud service.
  python3 scripts/e2e/board_deck.py out/
"""
import os, sys, time
from playwright.sync_api import sync_playwright
from common import call, errors, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
BASE = "http://127.0.0.1:8139"
proc = start_table(8139, TABLE_KEY="k", PUBLIC_URL=BASE, AI_DELAY_MS="200")


def a(method, path, body=None):
    return call(BASE, method, "/api/v1" + path, body, {"x-table-key": "k"})


def players():
    return {p["name"]: p for p in a("GET", "/state")["players"]}


try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={"width": 1600, "height": 900})
        watch(page, "board")
        page.goto(BASE + "/board/")
        page.wait_for_selector("text=Pick a game")
        assert page.locator("aside.join img").count() == 1, "the QR code shows before"
        # A session saved by an earlier run that the table no longer knows (it restarted): the deck shows its name form
        # without "session expired; scan the QR code" (D-218).
        page.evaluate("() => localStorage.setItem('gametable.board-deck.' + location.host, 'from-an-earlier-run')")

        # Developer settings › Play from the board: the board moves into the page with the deck beside it.
        page.click("#tools-button")
        page.click(".overlay.advanced [data-adv=board-deck]")
        page.wait_for_url("**/board/play.html", timeout=10000)
        board = page.frame_locator("#board")
        deck = page.frame_locator("#deck")
        board.locator("text=Pick a game").wait_for(timeout=15000)
        assert board.locator("aside.join img").count() == 0, "no QR code while played from the board"
        board.locator("aside.join.board-deck").wait_for()

        # The deck takes a seat with a name, without a join code.
        deck.locator("input[name=name]").wait_for(timeout=10000)
        page.wait_for_timeout(300)
        assert deck.locator("#top").inner_text().strip() == "", f"a warning over the name form: {deck.locator('#top').inner_text()}"
        deck.locator("input[name=name]").fill("Dev")
        deck.locator("button[type=submit]").click()
        wait(lambda: "Dev" in players(), 10, "Dev at the table")
        assert players()["Dev"]["location"] == "local"
        page.screenshot(path=os.path.join(OUT, "board-deck-lobby.png"))

        # A phone with the join code is turned away.
        phone = b.new_page(viewport={"width": 390, "height": 844})
        watch(phone, "phone")
        phone.goto(a("GET", "/join")["url"])
        phone.fill("input[name=name]", "Phone")
        phone.click("button[type=submit]")
        phone.wait_for_selector("text=played from its board", timeout=10000)
        assert "Phone" not in players()

        # A game of Coin Flip, played from the deck beside the board.
        a("POST", "/ai", {})
        a("POST", "/game/select", {"gameId": "coin-flip", "settings": {"rounds": 3, "roundSeconds": 0}})
        deck.locator("#ready").click()
        wait(lambda: all(x["ready"] for x in players().values()), 10, "everyone ready")
        a("POST", "/game/start", {})
        deck.locator("[data-guess=heads]:not([disabled])").first.click(timeout=20000)
        page.wait_for_timeout(1500)
        # D-222: the board hands Dev's seat to an AI player ("Dev (AI)"); the deck offers the seat back, and takes it as
        # Dev, without the name form.
        seat = players()["Dev"]["seat"]
        a("POST", "/exchange", {"seat": seat, "kind": "ai"})
        deck.locator("[data-board-again]:has-text('Take your seat back')").wait_for(timeout=10000)
        page.screenshot(path=os.path.join(OUT, "board-deck-seat-back.png"))
        deck.locator("[data-board-again]").click()
        wait(lambda: players().get("Dev", {}).get("seat") == seat and "Dev (AI)" not in players(), 15, "Dev back in the seat")
        assert deck.locator("input[name=name]").count() == 0, "the name form after taking the seat back"
        end = time.time() + 60
        while a("GET", "/state")["phase"] != "finished" and time.time() < end:
            guess = deck.locator("[data-guess=heads]:not([disabled])")
            if guess.count():
                guess.first.click()
            page.wait_for_timeout(500)
        wait(lambda: a("GET", "/state")["phase"] == "finished", 5, "the game to finish")
        page.screenshot(path=os.path.join(OUT, "board-deck-game.png"))

        # Hide and Show fold the deck, as on a remote player's page.
        page.click("#deck-min")
        page.wait_for_selector("#play.deck-min")
        page.click("#deck-min")
        page.wait_for_selector("#play:not(.deck-min)")

        # Fullscreen from the board's settings takes the whole page, board and deck (D-184), not just the board's frame,
        # which would cover the deck.
        board.locator("#settings-button").click()
        board.locator(".overlay.settings [data-fs]").click()
        wait(lambda: page.evaluate("() => document.fullscreenElement === document.documentElement"), 5, "the page to go fullscreen")
        box = page.locator("#deck-wrap").bounding_box()
        assert box and box["width"] > 300 and box["x"] + box["width"] <= 1600, f"the deck is not on screen in fullscreen: {box}"
        assert board.locator(".overlay.settings [data-fs]").inner_text() == "Leave fullscreen"
        page.screenshot(path=os.path.join(OUT, "board-deck-fullscreen.png"))
        board.locator(".overlay.settings [data-fs]").click()
        wait(lambda: page.evaluate("() => document.fullscreenElement === null"), 5, "the page to leave fullscreen")
        board.locator(".overlay.settings [data-close-overlay]").first.click()

        # Switched off: the board is alone again, with its QR code; the player stays.
        a("POST", "/developer", {"boardDeck": False})
        page.wait_for_url("**/board/", timeout=10000)
        page.wait_for_selector("aside.join img", timeout=15000)
        assert players()["Dev"]["location"] == "local"
        b.close()
finally:
    proc.terminate()
if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("board-deck: ok")
