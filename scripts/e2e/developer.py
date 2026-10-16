"""Browser check of the developer setting "Games without a player at the table" (D-118).
  python3 scripts/e2e/developer.py out/

A Table Host of its own (port 8094). With the setting off, the board says the last player at the table can't be
removed while a game is chosen; turned on in Settings, the gear shows DEV, and a game of AI players only starts from
the board and plays on it.
"""
import os, sys
from playwright.sync_api import sync_playwright
from common import api, errors, join_deck, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
BASE = "http://127.0.0.1:8094"
KEY = "devk"


def a(method, path, body=None):
    return api(method, path, body, base=BASE, key=KEY)


proc = start_table(8094, TABLE_KEY=KEY, PUBLIC_URL=BASE, AI_DELAY_MS="50")
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        board = br.new_page(viewport={"width": 1920, "height": 1080})
        watch(board, "board", ignore=("409",))  # the refused remove below answers 409
        board.goto(BASE + "/board/")
        phone = br.new_page(viewport={"width": 390, "height": 844})
        watch(phone, "phone")
        join_deck(phone, a("GET", "/join")["url"], "Ann")

        # Off: the last player at the table can't be removed once a game is chosen; the board says why.
        a("POST", "/ai", {})
        a("POST", "/game/select", {"gameId": "coin-flip", "settings": {"rounds": 3, "roundSeconds": 0}})
        ann = next(pl for pl in a("GET", "/state")["players"] if pl["name"] == "Ann")
        board.click(f"[data-chip='{ann['id']}']")
        board.wait_for_selector(".toast:has-text('last player at the table')")
        assert any(pl["name"] == "Ann" for pl in a("GET", "/state")["players"]), "Ann must stay"
        assert board.locator(".dialog").count() == 0, "no Remove dialog for the last player at the table"
        board.wait_for_selector(".toast", state="detached")

        # On: Settings › Developer; the gear shows DEV.
        board.click("#settings-button")
        board.click("[data-dev-no-local]")
        board.wait_for_selector("[data-dev-no-local].on")
        board.screenshot(path=os.path.join(OUT, "developer-settings.png"))
        board.click("[data-close-overlay]")
        board.wait_for_selector("#settings-button.dev")
        board.locator("#settings-button").screenshot(path=os.path.join(OUT, "developer-gear.png"))

        # Ann can go now; two AIs alone start from the board and play.
        board.click(f"[data-chip='{ann['id']}']")
        board.click(".dialog button[data-x=yes]")
        wait(lambda: not any(pl["name"] == "Ann" for pl in a("GET", "/state")["players"]), 5, "Ann to be removed")
        phone.close()
        a("POST", "/ai", {})
        board.wait_for_selector("[data-start]:not([disabled])")
        assert "AI players only (developer setting)" in board.inner_text(".main.waiting .sub"), board.inner_text(".main.waiting .sub")
        board.click("[data-start]")
        wait(lambda: a("GET", "/state")["phase"] in ("active", "finished"), 10, "the AI game to start")
        wait(lambda: a("GET", "/state")["phase"] == "finished", 30, "the AI game to finish")
        board.screenshot(path=os.path.join(OUT, "developer-ai-game.png"))

        # Off again: the gear is plain.
        a("POST", "/developer", {"allowNoLocalPlayer": False})
        board.wait_for_selector("#settings-button:not(.dev)")
        br.close()
    if errors:
        raise AssertionError("browser errors:\n" + "\n".join(errors))
    print("developer: ok")
finally:
    proc.kill()
