"""Browser check of a game played from all four edges (manifest `facing: "any"`, D-227), with the test game Duel
(tests/fixtures/local-seat).
  python3 scripts/e2e/facing.py out/

A Table Host of its own (port 8141). Ann and an AI player start Duel. During the game the board keeps the lobby's four
corner arrows and has no turn button; the Lobby button sits beside its corner, and no platform button covers another.
The east arrow faces the game east: the table's facing and the game's `info.frontEdge` follow.
"""
import os, sys
from playwright.sync_api import sync_playwright
from common import REPO, api, errors, join_deck, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
BASE = "http://127.0.0.1:8141"
KEY = "facek"


def a(method, path, body=None):
    return api(method, path, body, base=BASE, key=KEY)


OVERLAPS = """() => {
  const els = [...document.querySelectorAll('#corners .corner, #lobby-button, #settings-button, #tools-button, #flip-button')]
    .filter((e) => !e.hidden && e.offsetParent && !e.closest('[hidden]'));
  const out = [];
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const [p, q] = [els[i].getBoundingClientRect(), els[j].getBoundingClientRect()];
    if (p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom) out.push(`${els[i].id || els[i].className} / ${els[j].id || els[j].className}`);
  }
  return out;
}"""

proc = start_table(8141, TABLE_KEY=KEY, PUBLIC_URL=BASE, GAMES_DIR=os.path.join(REPO, "tests", "fixtures", "local-seat"), SHOW_TEST_GAMES="1")
try:
    with sync_playwright() as p:
        br = p.chromium.launch(**({"executable_path": os.environ["PW_CHROMIUM"]} if os.environ.get("PW_CHROMIUM") else {}))
        board = br.new_page(viewport={"width": 1920, "height": 1080})
        watch(board, "board")
        board.goto(BASE + "/board/")
        ann = br.new_page(viewport={"width": 390, "height": 844})
        watch(ann, "Ann")
        join_deck(ann, a("GET", "/join")["url"], "Ann")
        a("POST", "/game/select", {"gameId": "duel"})
        a("POST", "/ai", {})
        ann.click("#ready")
        wait(lambda: all(pl["ready"] for pl in a("GET", "/state")["players"]), 10, "everyone ready")
        a("POST", "/game/start", {})
        wait(lambda: a("GET", "/state")["phase"] == "active", 10, "the game running")
        board.wait_for_selector("#lobby-button:not([hidden])")

        # The corner arrows stay, the turn button doesn't show, the Lobby button sits beside its corner.
        wait(lambda: board.locator("#corners:not([hidden]) .corner").count() == 4, 5, "four corner arrows during the game")
        assert not board.locator("#flip-button").is_visible(), "a game played from all sides has no turn button"
        assert "beside" in (board.get_attribute("#lobby-button", "class") or ""), board.get_attribute("#lobby-button", "class")
        clash = board.evaluate(OVERLAPS)
        assert clash == [], clash
        board.screenshot(path=os.path.join(OUT, "facing-south.png"))

        # The east arrow faces the game east, for the table and the game.
        board.click("#corners .corner[data-face=east]")
        wait(lambda: a("GET", "/state")["gameFacing"] == "east", 5, "the game to face east")
        wait(lambda: board.locator("#corners .corner[data-face=east].on").count() == 1, 5, "the east arrow marked")
        assert a("GET", "/state")["phase"] == "active", "turning must not end the game"
        assert board.evaluate(OVERLAPS) == [], board.evaluate(OVERLAPS)
        board.screenshot(path=os.path.join(OUT, "facing-east.png"))
        assert not errors, errors
        print("ok")
        br.close()
finally:
    proc.terminate()
