"""Browser check: the table's rules in the board's settings (D-236, D-237).
  python3 scripts/e2e/table_rules.py out/

A Table Host of its own (port 8143) with a "minute" of one second (AWAY_TO_AI_MINUTE_MS). Ann chooses Roulette. The
settings window has the Table rules group: Off/3 min/5 min and the switch for different play styles (on). The board
sets 3 minutes and turns the switch off; the state follows. During the game the group is locked and says the values.
Ann's phone goes away: after three "minutes" an AI player, "Ann (AI)", takes her seat and the game goes on.
"""
import os, sys, time
from playwright.sync_api import sync_playwright
from common import api, errors, join_deck, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
BASE = "http://127.0.0.1:8143"
KEY = "rules"


def a(method, path, body=None):
    return api(method, path, body, base=BASE, key=KEY)


proc = start_table(8143, TABLE_KEY=KEY, PUBLIC_URL=BASE, AWAY_TO_AI_MINUTE_MS="1000")
try:
    with sync_playwright() as p:
        br = p.chromium.launch(**({"executable_path": os.environ["PW_CHROMIUM"]} if os.environ.get("PW_CHROMIUM") else {}))
        board = br.new_page(viewport={"width": 1920, "height": 1080})
        watch(board, "board")
        board.goto(BASE + "/board/")
        ann = br.new_page(viewport={"width": 390, "height": 844})
        watch(ann, "Ann")
        join_deck(ann, a("GET", "/join")["url"], "Ann")
        a("POST", "/game/select", {"gameId": "roulette"})
        assert a("GET", "/state")["rules"] == {"awayToAi": 0, "distinctAiStyles": True}

        # Before the game: the group, its defaults, and both controls change the rules.
        board.click("#settings-button")
        board.wait_for_selector(".overlay.settings .table-rules")
        assert board.locator(".overlay.settings .table-rules [data-rule-away='0'].on").count() == 1, "Off is not chosen"
        assert board.locator(".overlay.settings .table-rules [data-rule-distinct].on").count() == 1, "different styles is not on"
        board.click(".overlay.settings [data-rule-away='3']")
        wait(lambda: a("GET", "/state")["rules"]["awayToAi"] == 3, 5, "the rule at 3 minutes")
        board.click(".overlay.settings [data-rule-distinct]")
        wait(lambda: a("GET", "/state")["rules"]["distinctAiStyles"] is False, 5, "different styles off")
        board.wait_for_selector(".overlay.settings .table-rules [data-rule-away='3'].on")
        board.locator(".overlay.settings .table-rules").screenshot(path=os.path.join(OUT, "table-rules.png"))
        board.click(".overlay.settings [data-close-overlay]")

        # During the game: locked, with the values.
        a("POST", "/ai", {})
        ann.click("#ready")
        wait(lambda: all(pl["ready"] for pl in a("GET", "/state")["players"]), 10, "everyone ready")
        a("POST", "/game/start", {})
        wait(lambda: a("GET", "/state")["phase"] == "active", 10, "the game running")
        board.click("#settings-button")
        board.wait_for_selector(".overlay.settings .table-rules.locked")
        text = board.inner_text(".overlay.settings .table-rules")
        assert "After 3 minutes" in text and "Off" in text, text
        assert board.locator(".overlay.settings .table-rules [data-rule-away]").count() == 0, "the rules can be changed during the game"
        board.click(".overlay.settings [data-close-overlay]")

        # Ann goes away: after three "minutes" an AI player plays her seat.
        seat = [x for x in a("GET", "/state")["players"] if x["name"] == "Ann"][0]["seat"]
        ann.close()
        wait(lambda: any(x["seat"] == seat and x["kind"] == "ai" for x in a("GET", "/state")["players"]), 15, "an AI player in Ann's seat")
        s = a("GET", "/state")
        assert [x["name"] for x in s["players"] if x["seat"] == seat] == ["Ann (AI)"], s["players"]
        assert s["phase"] == "active", s["phase"]
        time.sleep(1)
        board.screenshot(path=os.path.join(OUT, "table-rules-replaced.png"))
        problems = list(errors)
        assert not problems, problems
        print("ok")
finally:
    proc.terminate()
