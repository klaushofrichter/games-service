"""Browser check of one board window at the table PC (D-132).
  python3 scripts/e2e/one_board.py out/

A Table Host of its own (port 8097) with a game of Pachisi running (AI players, developer setting: no player at the
table). A second board window (another tab, so another tab id) shows "The board is open in another window", names the
game, and gets no table state. "Show the board here" moves the board: the first window shows "The board moved to
another window", the second shows the game. A reload of the window that has the board keeps it without a question. A player's deck opened in a second tab moves
there; the first tab says so and takes it back with "Use this window" (D-133).
"""
import os, sys
from playwright.sync_api import sync_playwright
from common import api, errors, join_deck, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
BASE = "http://127.0.0.1:8097"
KEY = "onek"


def a(method, path, body=None):
    return api(method, path, body, base=BASE, key=KEY)


proc = start_table(8097, TABLE_KEY=KEY, PUBLIC_URL=BASE, ALLOW_NO_LOCAL_PLAYER="1", AI_DELAY_MS="400")
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        first = br.new_page(viewport={"width": 1280, "height": 720})
        watch(first, "first board")
        first.goto(BASE + "/board/")
        first.wait_for_selector("text=Pick a game")
        for _ in range(2):
            a("POST", "/ai", {})
        a("POST", "/game/select", {"gameId": "pachisi"})
        a("POST", "/game/start")
        first.wait_for_selector("#game-layer:not([hidden])", timeout=15000)

        # A second window: another tab of the same browser (sessionStorage differs, so another tab id).
        second = br.new_page(viewport={"width": 1280, "height": 720})
        watch(second, "second board")
        second.goto(BASE + "/board/")
        second.wait_for_selector("#elsewhere-layer:not([hidden]) >> text=The board is open in another window", timeout=10000)
        text = second.inner_text("#elsewhere-layer")
        assert "Pachisi" in text, text
        assert second.locator("#game-layer:not([hidden])").count() == 0, "the second window shows the game"
        assert first.locator("#elsewhere-layer:not([hidden])").count() == 0, "the first window lost the board"
        second.screenshot(path=os.path.join(OUT, "one-board-elsewhere.png"))

        # Keep the other window: this one says it can be closed.
        second.click("[data-elsewhere=leave]")
        second.wait_for_selector("#elsewhere-layer .note:not([hidden])")
        second.reload()
        second.wait_for_selector("#elsewhere-layer:not([hidden])", timeout=10000)

        # Take over: the board moves.
        second.click("[data-elsewhere=here]")
        second.wait_for_selector("#game-layer:not([hidden])", timeout=10000)
        first.wait_for_selector("#elsewhere-layer:not([hidden]) >> text=The board moved to another window", timeout=10000)
        first.screenshot(path=os.path.join(OUT, "one-board-replaced.png"))
        first.wait_for_timeout(2500)
        assert second.locator("#elsewhere-layer:not([hidden])").count() == 0, "the first window came back by itself"

        # A reload of the window with the board keeps it, without a question.
        second.reload()
        second.wait_for_selector("#game-layer:not([hidden])", timeout=10000)
        second.wait_for_timeout(2000)
        assert second.locator("#elsewhere-layer:not([hidden])").count() == 0, "a reload asked again"

        # Closing it frees the table for the other window.
        second.close()
        first.wait_for_timeout(300)
        first.click("[data-elsewhere=here]")
        first.wait_for_selector("#game-layer:not([hidden])", timeout=10000)
        # One deck per player (D-133): the same phone's second tab takes the deck; the first can take it back.
        a("POST", "/game/end", {})
        wait(lambda: a("GET", "/state")["phase"] not in ("active", "paused"), 10, "the game to end")
        phone = br.new_context(viewport={"width": 390, "height": 844})
        d1 = phone.new_page()
        watch(d1, "deck 1")
        join_deck(d1, a("GET", "/join")["url"], "Ann")
        d2 = phone.new_page()  # the same browser: it finds Ann's saved session
        watch(d2, "deck 2")
        d2.goto(BASE + "/deck/")
        d2.wait_for_selector(".who h1", timeout=10000)
        d1.wait_for_selector("text=Your deck is open in another window", timeout=10000)
        d1.screenshot(path=os.path.join(OUT, "one-deck-replaced.png"))
        conn = a("GET", "/connections")
        assert conn["decks"] == 1 and conn["boards"] == 1, conn
        d1.click("[data-action=deck-here]")
        d1.wait_for_selector(".who h1", timeout=10000)
        d2.wait_for_selector("text=Your deck is open in another window", timeout=10000)
        assert [p for p in a("GET", "/state")["players"] if p["name"] == "Ann"][0]["connected"], "Ann went offline"
        br.close()
finally:
    proc.terminate()

if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("ok: one board window")
