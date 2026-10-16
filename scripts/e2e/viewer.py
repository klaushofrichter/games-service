"""Browser end-to-end check of the Game Viewer (D-120).
  python3 scripts/e2e/viewer.py out/

A coin-flip game played with a phone and a Pachisi simulation appear in the board's Game logs (from the lobby and from
the settings). A game's moves show as numbered rows with the game's columns; the filters, "Move #" and paging work; a
move opens in full with its reference to copy, the state before and after, and the previous and next move; a
simulation's games can be switched; and the panel fits when the board faces an east or west edge.
Starts its own table host.
"""
import os, sys, tempfile
from playwright.sync_api import sync_playwright
from common import api, errors, join_deck, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
TABLE = "http://127.0.0.1:8114"
KEY = "k"


def t(method, path, body=None):
    return api(method, path, body, base=TABLE, key=KEY)


host = start_table(8114, TABLE_KEY=KEY, TABLE_NAME="Den", AI_DELAY_MS="150", DATA_DIR=tempfile.mkdtemp(prefix="e2e-viewer-"), PUBLIC_URL=TABLE)
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        # 1. A game with a phone (Ann and an AI, three rounds) and a Pachisi simulation of two games.
        phone = br.new_page(viewport={"width": 390, "height": 844})
        watch(phone, "phone")
        join_deck(phone, t("GET", "/join")["url"], "Ann")
        t("POST", "/ai", {})
        t("POST", "/game/select", {"gameId": "coin-flip", "settings": {"rounds": 3, "roundSeconds": 0}})
        phone.click("#ready")
        wait(lambda: all(pl["ready"] for pl in t("GET", "/state")["players"]), 10, "everyone ready")
        t("POST", "/game/start", {})
        for _ in range(3):
            phone.wait_for_selector("[data-guess=heads]:not([disabled])", timeout=15000)
            phone.click("[data-guess=heads]")
            wait(lambda: phone.locator("[data-guess=heads]:not([disabled])").count() == 0 or t("GET", "/state")["phase"] == "finished", 10, "the guess")
        wait(lambda: t("GET", "/state")["phase"] == "finished", 20, "the game to end")
        t("POST", "/game/close", {})
        sim = t("POST", "/simulation", {"gameId": "pachisi", "players": 2, "games": 2, "seed": 4, "settings": {"tokens": 1}})
        wait(lambda: len(t("GET", "/history")) == 2, 10, "both logs in the history")

        board = br.new_page(viewport={"width": 1920, "height": 1080})
        watch(board, "board")
        board.goto(TABLE + "/board/")
        board.wait_for_selector("button[data-logs]")

        # 2. The list, from the lobby's toolbar: newest first, with the game, players and log id.
        board.click("button[data-logs]")
        board.wait_for_selector(".vtable.logs tbody tr")
        rows = board.locator(".vtable.logs tbody tr")
        assert rows.count() == 2, rows.count()
        assert "Pachisi" in rows.nth(0).inner_text() and sim["logId"] in rows.nth(0).inner_text(), rows.nth(0).inner_text()
        assert "Coin Flip" in rows.nth(1).inner_text() and "Ann" in rows.nth(1).inner_text(), rows.nth(1).inner_text()
        board.screenshot(path=os.path.join(OUT, "viewer-list.png"))

        # 3. The coin-flip game: numbered moves, the game's columns, the automatic flip as a sub-step.
        rows.nth(1).click()
        board.wait_for_selector(".vtable.moves tbody tr[data-line]")
        heads = [h.inner_text().strip().lower() for h in board.locator(".vtable.moves thead th").all()]
        for col in ("#", "time", "player", "round", "guess", "coin", "score", "what happened"):
            assert col in heads, (col, heads)
        text = board.inner_text(".vtable.moves")
        assert "guesses heads" in text and "Coin:" in text and "automatic" in text, text
        assert "Game started" in text and "Game ended" in text, text
        board.screenshot(path=os.path.join(OUT, "viewer-coinflip.png"))

        # Filters: Ann only, then moves only.
        board.click("button[data-seat='0']")
        board.wait_for_function("document.querySelector('button[data-seat=\"0\"]').classList.contains('on') && document.querySelector('.vtable.moves')")
        names = {c.inner_text().split()[0] for c in board.locator(".vtable.moves td.who").all()}
        assert names == {"Ann"}, names
        board.click("button[data-seat='']")
        board.click("button[data-toggle=movesOnly]")
        board.wait_for_function("document.querySelector('button[data-toggle=movesOnly]').classList.contains('on') && document.querySelector('.vtable.moves')")
        assert "Game started" not in board.inner_text(".vtable.moves")

        # 4. One move in full: reference, facts, state before and after, previous and next.
        board.click("tr[data-line]:has(td.n:text-is('2'))")
        board.wait_for_selector(".viewer-panel .step")
        ref = board.inner_text(".viewer-panel .refrow code")
        assert ref.endswith("#2"), ref
        board.click(".viewer-panel button[data-copyref]")
        board.wait_for_selector(".toast:has-text('#2')")
        board.click("details:has(summary:text-is('State after')) summary")
        assert '"round"' in board.inner_text("details:has(summary:text-is('State after')) pre")
        board.screenshot(path=os.path.join(OUT, "viewer-move.png"))
        board.click("button[data-stepmove='3']")
        board.wait_for_selector(".viewer-panel .refrow code:text-matches('#3$')")
        board.click("button[data-back]")
        board.wait_for_selector(".vtable.moves tr.target td.n:text-is('3')")  # back on the list, at the move
        board.click("button[data-back]")

        # 5. The simulation: "Move #" jumps to the page with the move; game 2 of 2.
        board.wait_for_selector(".vtable.logs tbody tr")
        board.locator(".vtable.logs tbody tr").nth(0).click()
        board.wait_for_selector(".game-pick :text('Game 1 of 2')")
        moves = t("GET", f"/history/{sim['logId']}")["gameList"][0]["moves"]
        target = max(1, moves - 2)
        board.fill("form.goto input", str(target))
        board.click("form.goto button")
        board.wait_for_selector(f".vtable.moves tr.target td.n:text-is('{target}')")
        board.screenshot(path=os.path.join(OUT, "viewer-goto.png"))
        board.click("button[data-game='1']")
        board.wait_for_selector(".game-pick :text('Game 2 of 2')")
        board.wait_for_selector(".vtable.moves tbody tr[data-line]")
        assert "rolls a" in board.inner_text(".vtable.moves")
        board.click("button[data-close]")
        board.wait_for_selector(".overlay.viewer", state="detached")

        # 6. From the settings, with the board facing east: the panel is turned and stays on the screen.
        t("POST", "/face", {"edge": "east"})
        board.wait_for_function("document.querySelector('#settings-button') && !document.querySelector('#settings-button').hidden")
        board.click("#settings-button")
        board.click(".overlay.settings button[data-viewer]")
        board.wait_for_selector(".viewer-panel.sideways .vtable.logs tbody tr")
        box = board.locator(".viewer-panel").bounding_box()
        assert box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= 1920 and box["y"] + box["height"] <= 1080, box
        board.screenshot(path=os.path.join(OUT, "viewer-east.png"))
        t("POST", "/face", {"edge": "south"})
        br.close()
    assert not errors, errors
    print("viewer: ok")
finally:
    host.kill()
