"""Browser check of the developer setting "Games without a player at the table" (D-118).
  python3 scripts/e2e/developer.py out/

A Table Host of its own (port 8094). With the setting off, the board says the last player at the table can't be
removed while a game is chosen. The setting, Simulation and Game logs are under Advanced, the hammer-and-wrench button
beside the gear (D-128), not in Settings or the lobby; turned on, Advanced shows DEV, and a game of AI players only
starts from the board and plays on it.
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

        # The lobby has no Simulation or Game logs buttons any more, and Settings no Developer group (D-128).
        assert board.locator("button[data-sim], button[data-logs]").count() == 0
        board.click("#settings-button")
        board.wait_for_selector(".overlay.settings .panel")
        assert board.locator(".overlay.settings [data-dev-no-local], .overlay.settings [data-viewer]").count() == 0
        board.click(".overlay.settings [data-close-overlay]")

        # On: Developer settings; the hammer and wrench show DEV.
        board.click("#tools-button")
        board.wait_for_selector(".overlay.advanced button[data-adv=sim]")
        board.wait_for_selector(".overlay.advanced button[data-adv=logs]")
        board.click(".overlay.advanced [data-dev-no-local]")
        board.wait_for_selector(".overlay.advanced [data-dev-no-local].on")
        # Versions at the bottom (D-182): the platform ("dev" outside a release build) and every game the lobby offers.
        board.wait_for_selector(".overlay.advanced .versions .vlist .v:text-matches('^dev')")
        vtext = board.inner_text(".overlay.advanced .versions")
        for g in a("GET", "/games"):
            assert g["name"] in vtext and g["version"] in vtext, (g["name"], g["version"], vtext)
        assert board.locator(".overlay.advanced .group").last.get_attribute("class") == "group versions"
        board.screenshot(path=os.path.join(OUT, "developer-advanced.png"))
        board.click(".overlay.advanced [data-close-overlay]")
        board.wait_for_selector("#tools-button.dev")
        gear, tools = board.locator("#settings-button").bounding_box(), board.locator("#tools-button").bounding_box()
        assert abs(gear["y"] - tools["y"]) < 2 and 60 <= tools["x"] - gear["x"] <= 80, f"beside the gear: {gear} {tools}"
        board.screenshot(path=os.path.join(OUT, "developer-buttons.png"), clip={"x": 0, "y": 960, "width": 420, "height": 120})

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
        board.wait_for_selector("#tools-button:not(.dev)")
        br.close()
    if errors:
        raise AssertionError("browser errors:\n" + "\n".join(errors))
    print("developer: ok")
finally:
    proc.kill()
