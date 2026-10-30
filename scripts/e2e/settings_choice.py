"""Browser check of the board's settings window for a game's choices (D-129b), with the test game Duel
(tests/fixtures/local-seat). A choice with up to three options shows as buttons; more become a pulldown, so a long
list (Chess's eight time controls) never runs out of the window.
  python3 scripts/e2e/settings_choice.py out/

A Table Host of its own (port 8105). Duel chosen, the settings window opened: "Pace of play" (five choices) is a
pulldown listing all five, inside the window; "Side" (two) is buttons. Picking from the pulldown and tapping a button
both change the table's settings, and the pulldown shows the new choice. Before that, Duel's description names a setting
(D-238): the tile shows its default ("Pace: no limit"), and the window that chooses the game follows the pulldown.
"""
import os, sys
from playwright.sync_api import sync_playwright
from common import REPO, api, errors, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
BASE = "http://127.0.0.1:8105"
KEY = "setk"
PACE = ["no limit", "very slow", "slow", "quick", "very quick"]


def a(method, path, body=None):
    return api(method, path, body, base=BASE, key=KEY)


proc = start_table(8105, TABLE_KEY=KEY, PUBLIC_URL=BASE, GAMES_DIR=os.path.join(REPO, "tests", "fixtures", "local-seat"), SHOW_TEST_GAMES="1")
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        board = br.new_page(viewport={"width": 1920, "height": 1080})
        watch(board, "board")
        board.goto(BASE + "/board/")
        # A setting in the description (D-238): the default on the tile, the value being chosen in the window.
        tile = board.locator(".tile[data-game=duel] .desc")
        tile.wait_for()
        assert "Pace: no limit (" in tile.inner_text(), tile.inner_text()
        board.click(".tile[data-game=duel]")
        intro = board.locator(".dialog.form .form-intro")
        intro.wait_for()
        assert "Pace: no limit (" in intro.inner_text(), intro.inner_text()
        board.select_option(".dialog.form select[name=pace]", "quick")
        assert "Pace: quick (" in intro.inner_text(), intro.inner_text()
        board.click(".dialog.form [data-x=no]")
        a("POST", "/game/select", {"gameId": "duel"})
        board.click("#settings-button")
        rows = board.locator(".game-rules .row")
        rows.first.wait_for()
        pace = board.locator(".game-rules select[data-setting-select=pace]")
        assert pace.count() == 1, "Pace of play (five choices) should be a pulldown"
        assert pace.locator("option").all_inner_texts() == PACE, pace.locator("option").all_inner_texts()
        assert pace.input_value() == "no limit"
        assert board.locator(".game-rules .seg [data-setting=side]").count() == 2, "Side (two choices) should stay buttons"
        # Nothing in the game's settings sticks out of the window.
        out = board.evaluate("""() => {
          const panel = document.querySelector('.overlay.settings .panel').getBoundingClientRect();
          return [...document.querySelectorAll('.game-rules .row > *')].map((e) => e.getBoundingClientRect())
            .filter((r) => r.right > panel.right + 1 || r.left < panel.left - 1).length;
        }""")
        assert out == 0, f"{out} game settings controls stick out of the settings window"
        board.screenshot(path=os.path.join(OUT, "settings-choice.png"))
        # Choosing from the pulldown and from the buttons both reach the table.
        pace.select_option("quick")
        wait(lambda: a("GET", "/state")["game"]["settings"]["pace"] == "quick", 5, "pace to become quick")
        wait(lambda: board.locator(".game-rules select[data-setting-select=pace]").input_value() == "quick", 5, "the pulldown to show quick")
        board.locator(".game-rules [data-setting=side][data-value=right]").click()
        wait(lambda: a("GET", "/state")["game"]["settings"]["side"] == "right", 5, "side to become right")
        assert a("GET", "/state")["game"]["settings"]["pace"] == "quick", "changing one setting must keep the other"
        br.close()
finally:
    proc.terminate()
if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("ok: a five-choice setting is a pulldown inside the window, a two-choice one buttons; both change the settings")
