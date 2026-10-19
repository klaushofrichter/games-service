"""Browser check: a player away during a game (D-144).
  python3 scripts/e2e/away.py out/

A Table Host of its own (port 8131, a 1.5 s waiting time, which is off by default). Ann and Ben play Coin Flip; Ben's
phone goes away. His seat waits past the waiting time; after a moment the board shows a card at his seat, "Ben is away",
with "Hand Ben to an AI". Tapping it asks first; confirmed, "Ben (AI)" takes the seat and the card is gone. Then Ann
leaves from her phone (D-158), and the board shows "Ann left the game" at once.
"""
import os, sys
from playwright.sync_api import sync_playwright
from common import api, errors, join_deck, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
BASE = "http://127.0.0.1:8131"
KEY = "awayk"


def a(method, path, body=None):
    return api(method, path, body, base=BASE, key=KEY)


proc = start_table(8131, TABLE_KEY=KEY, PUBLIC_URL=BASE, GRACE_MS="1500")
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        board = br.new_page(viewport={"width": 1920, "height": 1080})
        watch(board, "board")
        board.goto(BASE + "/board/")
        ann = br.new_page(viewport={"width": 390, "height": 844})
        watch(ann, "Ann")
        join_deck(ann, a("GET", "/join")["url"], "Ann")
        ben_ctx = br.new_context(viewport={"width": 390, "height": 844})
        ben = ben_ctx.new_page()
        join_deck(ben, a("GET", "/join")["url"], "Ben")
        a("POST", "/game/select", {"gameId": "coin-flip", "settings": {"rounds": 5, "roundSeconds": 0}})
        ann.click("#ready")
        ben.click("#ready")
        wait(lambda: all(pl["ready"] for pl in a("GET", "/state")["players"]), 10, "everyone ready")
        a("POST", "/game/start", {})
        ben.wait_for_selector("[data-guess=heads]")
        assert a("GET", "/state")["play"] == {"awayTimeout": False}, "the waiting time is off by default"
        ben_ctx.close()
        board.wait_for_selector("#away-layer .away-card", timeout=25000)
        st = a("GET", "/state")
        assert any(pl["name"] == "Ben" and not pl["connected"] for pl in st["players"]), "Ben's seat waits for him past the waiting time"
        assert "Ben" in board.locator("#away-layer .away-card").inner_text()
        board.wait_for_timeout(500)
        board.screenshot(path=os.path.join(OUT, "away-card.png"))
        board.click("#away-layer [data-hand-ai]")
        board.wait_for_selector("text=Hand Ben to an AI?")
        board.locator("button", has_text="Hand to an AI").last.click()
        wait(lambda: any(pl["name"] == "Ben (AI)" and pl["kind"] == "ai" for pl in a("GET", "/state")["players"]), 10, "Ben (AI) in the seat")
        board.wait_for_selector("#away-layer .away-card", state="detached", timeout=5000)
        assert a("GET", "/state")["phase"] == "active"
        # Ann leaves from her phone (D-158): the own tab, Leave the game, confirmed; her phone says so and the board
        # shows "Ann left the game" with Hand Ann to an AI at once.
        ann.click("#tab-table")
        ann.click("[data-leave=game]")
        ann.wait_for_selector(".leave-confirm")
        ann.screenshot(path=os.path.join(OUT, "leave-confirm.png"))
        ann.click(".leave-confirm")
        ann.wait_for_selector("text=You left the game")
        board.wait_for_selector("#away-layer .away-card:has-text('left the game')", timeout=5000)
        board.screenshot(path=os.path.join(OUT, "left-card.png"))
        br.close()
finally:
    proc.terminate()
if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("away: ok")
