"""Browser check of players lost during a game (D-119), with the Partners test game (tests/fixtures/seat-games).
  python3 scripts/e2e/seat_loss.py out/

A Table Host of its own (port 8095). Ann and Ben on phones, two AI players, Partners in "teams" mode. Ann's phone goes
away: the board shows a card at her seat with the game's reason and End game, the game stays visible, and Ben's
phone says whom the game waits for. Ann's phone comes back: the card goes and the game goes on. Then Remove for Ben
says that this ends the game, and it does, with the game's reason.
"""
import os, sys
from playwright.sync_api import sync_playwright
from common import REPO, api, errors, join_deck, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
BASE = "http://127.0.0.1:8095"
KEY = "seatk"
REASON = "Partners can't go on without a full team."


def a(method, path, body=None):
    return api(method, path, body, base=BASE, key=KEY)


proc = start_table(8095, TABLE_KEY=KEY, PUBLIC_URL=BASE, GAMES_DIR=os.path.join(REPO, "tests", "fixtures", "seat-games"),
                   SHOW_TEST_GAMES="1", GRACE_MS="1500", AI_DELAY_MS="50")
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        board = br.new_page(viewport={"width": 1920, "height": 1080})
        watch(board, "board")
        board.goto(BASE + "/board/")
        ann_ctx = br.new_context(viewport={"width": 390, "height": 844})
        ann = ann_ctx.new_page()
        watch(ann, "Ann", ignore=("ERR_CONNECTION", "WebSocket"))
        ben = br.new_context(viewport={"width": 390, "height": 844}).new_page()
        watch(ben, "Ben")
        url = a("GET", "/join")["url"]
        join_deck(ann, url, "Ann")
        join_deck(ben, url, "Ben")
        a("POST", "/ai", {})
        a("POST", "/ai", {})
        a("POST", "/game/select", {"gameId": "partners", "settings": {"mode": "teams"}})
        ann.click("#ready")
        ben.click("#ready")
        wait(lambda: all(pl["ready"] for pl in a("GET", "/state")["players"]), 10, "everyone ready")
        a("POST", "/game/start", {})
        board.wait_for_selector(".partners [data-score]")

        # Ann's phone goes away: the game waits for her, past the waiting time (1.5 s here).
        ann.close()
        board.wait_for_selector(f'.player-wait:has-text("{REASON}")')
        assert "Ann" in board.inner_text(".player-wait") and board.locator(".player-wait [data-pause=end]").count() == 1
        assert board.locator(".partners [data-score]").is_visible(), "the game stays visible behind the card"
        ben.wait_for_selector(".banner:has-text('Waiting for Ann to come back')")
        board.wait_for_timeout(2500)
        assert a("GET", "/state")["phase"] == "paused", "still waiting after the waiting time"
        board.screenshot(path=os.path.join(OUT, "seat-loss-waiting.png"))
        ben.screenshot(path=os.path.join(OUT, "seat-loss-phone.png"))

        # Ann's phone comes back (the same browser, so the same session): the game goes on.
        ann = ann_ctx.new_page()
        watch(ann, "Ann again")
        ann.goto(BASE + "/deck/")
        wait(lambda: a("GET", "/state")["phase"] == "active", 10, "the game to go on")
        board.wait_for_selector(".player-wait", state="detached")

        # Remove Ben: the board says it ends the game, and it does with the game's reason.
        ben_id = next(pl["id"] for pl in a("GET", "/state")["players"] if pl["name"] == "Ben")
        board.click("#lobby-button")
        board.click(f"[data-remove='{ben_id}']")
        board.wait_for_selector(f'.dialog:has-text("This ends the game: {REASON}")')
        board.screenshot(path=os.path.join(OUT, "seat-loss-remove.png"))
        board.click(".dialog button[data-x=yes]")
        wait(lambda: a("GET", "/state")["phase"] == "finished", 10, "the game to end")
        assert a("GET", "/state")["summary"]["text"] == REASON
        br.close()
    if errors:
        raise AssertionError("browser errors:\n" + "\n".join(errors))
    print("seat-loss: ok")
finally:
    proc.kill()
