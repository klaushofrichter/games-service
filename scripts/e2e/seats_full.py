"""Browser check of a full table (D-129).
  python3 scripts/e2e/seats_full.py out/

A Table Host of its own (port 8096), two seats. Ann joins by phone and an AI player takes the other seat: + AI player
and Invite are greyed out (Invite because this host has no service, D-169), and the board's QR panel says there is no
free seat. A second phone that scans the code
sees why instead of the name form; when the AI player is removed on the board, that phone shows the form by itself
and Ben takes the seat. Then Ann and Ben play Coin Flip: a third phone is told to join after the game, still has no
seat once it ended, and gets the form when the board chooses four seats.
"""
import os, sys
from playwright.sync_api import sync_playwright
from common import api, errors, join_deck, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
BASE = "http://127.0.0.1:8096"
KEY = "fullk"


def a(method, path, body=None):
    return api(method, path, body, base=BASE, key=KEY)


proc = start_table(8096, TABLE_KEY=KEY, PUBLIC_URL=BASE)
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        board = br.new_page(viewport={"width": 1920, "height": 1080})
        watch(board, "board")
        board.goto(BASE + "/board/")
        a("POST", "/layout", {"seats": 2})
        url = a("GET", "/join")["url"]
        ann = br.new_context(viewport={"width": 390, "height": 844}).new_page()
        watch(ann, "Ann")
        join_deck(ann, url, "Ann")
        board.wait_for_selector("button[data-add-ai]:not([disabled])")
        ai = a("POST", "/ai", {})["playerId"]

        # Full: the board's buttons are greyed out with the reason, and the QR panel says so.
        board.wait_for_selector("button[data-add-ai][disabled]")
        # Without the service (this host has none) invites are greyed out with the reason (D-169); with it, the full
        # table's invite is for a watcher (D-168, scripts/e2e/watch.py).
        board.wait_for_selector("button[data-invite][disabled]")
        assert "Game Table service" in board.get_attribute("button[data-invite]", "title")
        assert "Choose more seats" in board.get_attribute("button[data-add-ai]", "title")
        board.wait_for_selector("aside.join.full :text('No free seat')")
        assert "Choose more seats on the board" in board.inner_text("aside.join.full")
        board.screenshot(path=os.path.join(OUT, "seats-full-board.png"))

        # A second phone scans the code: why not, instead of the name form.
        ben = br.new_context(viewport={"width": 390, "height": 844}).new_page()
        watch(ben, "Ben", ignore=("409",))
        ben.goto(url)
        ben.wait_for_selector("#no-seat :text('No free seat')")
        assert ben.locator("input[name=name]").count() == 0
        ben.screenshot(path=os.path.join(OUT, "seats-full-phone.png"))

        # A seat frees up: the phone shows the form by itself, and Ben joins.
        a("DELETE", f"/players/{ai}")
        board.wait_for_selector("button[data-add-ai]:not([disabled])")
        board.wait_for_selector("aside.join:not(.full)")
        ben.wait_for_selector("input[name=name]", timeout=10000)
        ben.fill("input[name=name]", "Ben")
        ben.click("button[type=submit]")
        ben.wait_for_selector(".who h1")
        wait(lambda: any(pl["name"] == "Ben" and pl["seat"] is not None for pl in a("GET", "/state")["players"]), 5, "Ben seated")

        # During a full game: a third phone is told to join after it; the game ends and the seats stay taken; more
        # seats on the board, and the phone shows the form by itself.
        a("POST", "/game/select", {"gameId": "coin-flip", "settings": {"rounds": 20, "roundSeconds": 0}})
        ann.click("#ready")
        ben.click("#ready")
        wait(lambda: all(pl["ready"] for pl in a("GET", "/state")["players"]), 10, "everyone ready")
        a("POST", "/game/start", {})
        cleo = br.new_context(viewport={"width": 390, "height": 844}).new_page()
        watch(cleo, "Cleo", ignore=("409",))
        cleo.goto(url)
        cleo.wait_for_selector("#no-seat :text('Join after it')")
        assert cleo.locator("input[name=name]").count() == 0
        board.wait_for_selector("aside.join.full", state="attached")
        cleo.screenshot(path=os.path.join(OUT, "seats-full-in-game-phone.png"))
        a("POST", "/game/end", {})
        wait(lambda: a("GET", "/state")["phase"] == "finished", 10, "the game to end")
        cleo.wait_for_selector("#no-seat :text('Choose more seats')", timeout=10000)
        a("POST", "/game/close", {})
        a("POST", "/layout", {"seats": 4})
        cleo.wait_for_selector("input[name=name]", timeout=10000)
        br.close()
    if errors:
        raise AssertionError("browser errors:\n" + "\n".join(errors))
    print("seats-full: ok")
finally:
    proc.kill()
