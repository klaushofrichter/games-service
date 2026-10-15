"""Browser check for AI players that take their time (D-112), with the Think Race test game (tests/fixtures).

A Table Host of its own on port 8093 with the test games. A board and one phone; one AI player that thinks for
10 s against a 2 s budget. Checks:
  - the board shows the AI as out of time: a card at the AI's seat, on the board, with "Play now" and "End game";
  - the game is paused (the phone says whom it waits for) and the game stays visible around the card;
  - "Play now" plays the game's quick move (logged as a fallback) and the game goes on;
  - an AI that answers during the pause takes the card away by itself;
  - no browser console error.
  python3 scripts/e2e/ai_wait.py out/
"""
import os, sys, time
from playwright.sync_api import sync_playwright
from common import REPO, api, errors, join_deck, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
PORT = 8093
BASE = f"http://127.0.0.1:{PORT}"
KEY = "e2ekey"


def a(method, path, body=None):
    return api(method, path, body, base=BASE, key=KEY)


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, f"ai-wait-{name}.png"))


def start_race(board, deck, think_ms, target):
    if a("GET", "/state")["phase"] in ("active", "paused"):
        a("POST", "/game/end", {})
    wait(lambda: a("GET", "/state")["phase"] not in ("active", "paused", "terminating"), 5, "the last game to end")
    if a("GET", "/state")["phase"] != "idle":
        a("POST", "/game/close", {})
    for p in a("GET", "/state")["players"]:
        if p["kind"] == "ai":
            a("DELETE", f"/players/{p['id']}")
    a("POST", "/game/select", {"gameId": "think-race", "settings": {"target": target}})
    ai = a("POST", "/ai", {})["playerId"]
    a("POST", f"/players/{ai}/ai-options", {"options": {"thinkMs": think_ms}})
    deck.click("#ready")
    wait(lambda: all(p["ready"] for p in a("GET", "/state")["players"]), 5, "everyone ready")
    a("POST", "/game/start", {})
    return ai


def main():
    proc = start_table(PORT, TABLE_KEY=KEY, GAMES_DIR=os.path.join(REPO, "tests", "fixtures", "async-games"), SHOW_TEST_GAMES="1",
                       AI_DELAY_MS="100", PUBLIC_URL=BASE)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            board = browser.new_page(viewport={"width": 1920, "height": 1080})
            watch(board, "board")
            board.goto(BASE + "/board/")
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True)
            deck = ctx.new_page()
            watch(deck, "Ann")
            join_deck(deck, a("GET", "/join")["url"], "Ann")

            # An AI far over its budget: the game pauses and the board offers Play now at its seat.
            ai = start_race(board, deck, 10_000, 5)
            card = board.locator(f"#pause-layer .ai-wait-card[data-ai-wait='{ai}']")
            card.wait_for(timeout=8000)
            st = a("GET", "/state")
            assert st["phase"] == "paused" and st["pause"]["reason"] == "ai", st["pause"]
            name = st["pause"]["ai"]["name"]
            assert name in card.inner_text(), card.inner_text()
            box = card.bounding_box()
            assert box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= 1920 and box["y"] + box["height"] <= 1080, box
            # the game stays visible: the pause layer itself takes no touches
            assert board.evaluate("getComputedStyle(document.getElementById('pause-layer')).pointerEvents") == "none"
            assert card.locator("button[data-pause=end]").count() == 1
            deck.wait_for_selector(f".banner:has-text('Waiting for {name}')")
            shot(board, "board")
            shot(deck, "phone")
            card.locator("button[data-pause=play-now]").click()
            # The quick move is played at once; the AI's next move then has a fresh budget (and runs out again).
            board.wait_for_selector("#pause-layer .ai-wait-card", state="detached", timeout=1500)
            deck.wait_for_selector(".banner:has-text('Waiting for')", state="detached", timeout=1500)
            # the game's quick move for Think Race adds 2 (a normal AI move adds 1)
            assert a("GET", "/game/board")["view"]["count"] == 2, a("GET", "/game/board")["view"]

            # An AI that answers during the pause takes the card away by itself.
            ai = start_race(board, deck, 2600, 1)
            board.locator("#pause-layer .ai-wait-card").wait_for(timeout=8000)
            wait(lambda: a("GET", "/state")["phase"] == "finished", 8, "the late answer to finish the race")
            board.wait_for_selector("#pause-layer .ai-wait-card", state="detached", timeout=5000)
            browser.close()
    finally:
        proc.terminate()
    if errors:
        print("BROWSER ERRORS:\n" + "\n".join(errors))
        sys.exit(1)
    print(f"ok: AI out of time on the board and the phone, Play now, late answer; screenshots in {OUT}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        if os.environ.get("GITHUB_ACTIONS"):
            print(f"::error file=scripts/e2e/ai_wait.py::{type(e).__name__}: {str(e)[:900]}".replace("\n", " "))
        raise
