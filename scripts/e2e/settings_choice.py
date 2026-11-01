"""Browser check of the board's settings window for a game's choices (D-129b), with the test game Duel
(tests/fixtures/local-seat). A choice with up to three options shows as buttons; more become a pulldown, so a long
list (Chess's eight time controls) never runs out of the window.
  python3 scripts/e2e/settings_choice.py out/

A Table Host of its own (port 8105). Duel chosen, the settings window opened: "Pace of play" (five choices) is a
pulldown listing all five, inside the window; "Side" (two) is buttons. Picking from the pulldown and tapping a button
both change the table's settings, and the pulldown shows the new choice; its list opens inside the window and turns with
it (D-248). Before that, Duel's description names a setting
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
        # A setting's meaning as a paragraph of the description (D-249): the chosen side's, following the choice, and
        # not again under the field; the tile leaves it out.
        assert "Left: the first move is yours" in intro.inner_text(), intro.inner_text()
        assert board.locator(".dialog.form [data-hint=side]").count() == 0, "the side's meaning shows twice"
        assert "first move" not in tile.inner_text(), tile.inner_text()
        board.select_option(".dialog.form select[name=side]", "right")
        assert "Right: the other player moves first" in intro.inner_text(), intro.inner_text()
        # The window that chooses the game: the seed disabled and blank for a fixed board, a fresh one for random; only
        # digits typed (no "e", ".", "-"), at most six.
        field = board.locator(".dialog.form input[name=seed]")
        field.wait_for(state="attached")
        assert field.is_disabled() and field.input_value() == "", "the seed should be disabled and blank for a fixed board"
        assert not field.is_visible(), "the seed and its title should be hidden for a fixed board (D-248)"
        # What the chosen board means, under the setting, following the choice (D-246).
        hint = board.locator(".dialog.form [data-hint=board]")
        assert hint.inner_text() == "The same board every game.", hint.inner_text()
        # The pulldown opens its options inside the window, which turns with the board (D-248), and reads the labels.
        board.click(".dialog.form .pick:has(select[name=board]) .pick-cover")
        menu = board.locator(".dialog.form .pick-menu")
        menu.wait_for()
        assert menu.locator("button").all_inner_texts() == ["Fixed", "Random"], menu.locator("button").all_inner_texts()
        menu.locator("button", has_text="Random").click()
        assert board.locator(".dialog.form .pick-menu").count() == 0, "the list should close once a board is picked"
        assert board.locator(".dialog.form select[name=board]").input_value() == "random"
        assert hint.inner_text() == "A new board from a seed.", hint.inner_text()
        assert field.is_visible(), "the seed should show for a random board"
        assert not field.is_disabled() and field.input_value().isdigit(), f"no fresh seed: {field.input_value()!r}"
        field.fill("")
        field.type("1e-2.3--4567890")
        assert field.input_value() == "123456", field.input_value()
        board.select_option(".dialog.form select[name=board]", "fixed")
        assert field.is_disabled() and field.input_value() == ""
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
        # The pulldown's list turns with the window (D-248): on a board facing the other edge it opens under the select in
        # the window's own frame, which is above it on the screen.
        before = board.locator(".overlay.settings .panel").evaluate("e => e.style.transform")
        a("POST", "/rotate", {"degrees": 180})
        wait(lambda: board.locator(".overlay.settings .panel").evaluate("e => e.style.transform") != before, 5, "the window to turn")
        # The window turns with a transition: measure once it has come to rest.
        wait(lambda: board.locator(".overlay.settings .panel").evaluate("e => e.getAnimations().length === 0"), 5, "the window to stop turning")
        board.click(".game-rules .pick:has(select[data-setting-select=pace]) .pick-cover")
        menu = board.locator(".game-rules .pick-menu")
        menu.wait_for()
        assert menu.locator("button").all_inner_texts() == PACE, menu.locator("button").all_inner_texts()
        sel_box, menu_box = pace.bounding_box(), menu.bounding_box()
        assert menu_box["y"] + menu_box["height"] <= sel_box["y"] + 1, f"the list should turn with the window: {menu_box} vs {sel_box}"
        board.screenshot(path=os.path.join(OUT, "settings-pulldown-turned.png"))
        menu.locator("button[data-val=quick]").click()
        wait(lambda: a("GET", "/state")["game"]["settings"]["pace"] == "quick", 5, "pace to become quick")
        a("POST", "/rotate", {"degrees": 180})
        wait(lambda: board.locator(".game-rules select[data-setting-select=pace]").input_value() == "quick", 5, "the pulldown to show quick")
        board.locator(".game-rules [data-setting=side][data-value=right]").click()
        wait(lambda: a("GET", "/state")["game"]["settings"]["side"] == "right", 5, "side to become right")
        assert a("GET", "/state")["game"]["settings"]["pace"] == "quick", "changing one setting must keep the other"

        # A setting that applies only with another (D-245): no seed row for a fixed board; choosing random draws one,
        # which the number pad changes (digits, Clear, Enter), turning with the board.
        assert board.locator(".game-rules .row", has_text="Board's seed").count() == 0, "a seed row for a fixed board"
        assert "The same board every game." in board.locator(".game-rules .row", has_text="Board").first.inner_text(), "no description under the board setting (D-246)"
        board.locator(".game-rules [data-setting=board][data-value=random]").click()
        wait(lambda: a("GET", "/state")["game"]["settings"]["seed"] >= 1, 5, "a random seed")
        wait(lambda: "A new board from a seed." in board.locator(".game-rules .row", has_text="Board").first.inner_text(), 5, "the description to follow the choice")
        seed = board.locator(".game-rules [data-setting-pad=seed]")
        seed.wait_for(timeout=5000)
        assert seed.inner_text().strip() == str(a("GET", "/state")["game"]["settings"]["seed"])
        seed.click()
        pad = board.locator(".overlay.number-pad")
        pad.wait_for()
        pad.locator("[data-clear]").click()
        assert pad.locator("[data-enter]").is_disabled(), "Enter with nothing typed"
        for k in "4242":
            pad.locator(f"[data-key='{k}']").click()
        board.screenshot(path=os.path.join(OUT, "settings-number-pad.png"))
        # It turns with the board while open (D-245).
        before = pad.locator(".panel").evaluate("e => e.style.transform")
        a("POST", "/rotate", {"degrees": 90})
        wait(lambda: pad.locator(".panel").evaluate("e => e.style.transform") != before, 5, "the pad to turn with the board")
        a("POST", "/rotate", {"degrees": 180}); a("POST", "/rotate", {"degrees": 90})
        pad.locator("[data-enter]").click()
        wait(lambda: a("GET", "/state")["game"]["settings"]["seed"] == 4242, 5, "the seed typed on the pad")
        board.locator(".game-rules [data-setting=board][data-value=fixed]").click()
        wait(lambda: a("GET", "/state")["game"]["settings"]["seed"] == 0, 5, "the seed back at its default")
        board.click(".overlay.settings [data-close-overlay]")

        br.close()
finally:
    proc.terminate()
if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("ok: a five-choice setting is a pulldown inside the window, a two-choice one buttons; both change the settings")
