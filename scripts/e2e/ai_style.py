"""Browser check: how each AI player plays, in the board's settings window (D-226).
  python3 scripts/e2e/ai_style.py out/

A Table Host of its own (port 8139). Ann and two AI players choose Roulette. Settings › Players shows each AI
player's style beside its name ("Play style: conservative"), not Ann's. During the game a tap on an AI player's style opens
"How this AI player plays from its next move on"; picking "aggressive" and Save changes it for the running game, and
the row says so. Nothing in the players' rows overlaps. Then a second table (port 8140) with the Duel test game, whose
AI options have long labels like Chess's: the rows keep their colours on one line and stay low.
"""
import os, sys
from playwright.sync_api import sync_playwright
from common import REPO, api, errors, join_deck, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
BASE = "http://127.0.0.1:8139"
KEY = "aisk"


def a(method, path, body=None):
    return api(method, path, body, base=BASE, key=KEY)


def players():
    return {p["name"]: p for p in a("GET", "/state")["players"]}


ROWS_CLEAR = """() => {
  const out = [];
  for (const row of document.querySelectorAll('.overlay.settings .player-colors .row')) {
    const tops = new Set([...row.querySelectorAll('.swatch')].map((e) => Math.round(e.getBoundingClientRect().top)));
    if (tops.size > 1) out.push(`${row.textContent.trim().slice(0, 30)}: colours on ${tops.size} lines`);
    if (row.getBoundingClientRect().height > 90) out.push(`${row.textContent.trim().slice(0, 30)}: ${Math.round(row.getBoundingClientRect().height)}px high`);
    const parts = [...row.querySelectorAll('.pname, .ai-style, .swatches')].map((e) => e.getBoundingClientRect());
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const [p, q] = [parts[i], parts[j]];
      if (p.left < q.right - 1 && q.left < p.right - 1 && p.top < q.bottom - 1 && q.top < p.bottom - 1) out.push(row.textContent.trim().slice(0, 30));
    }
  }
  return out;
}"""

proc = start_table(8139, TABLE_KEY=KEY, PUBLIC_URL=BASE)
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
        for _ in range(2):
            a("POST", "/ai", {})
        ais = [pl for pl in players().values() if pl["kind"] == "ai"]

        # Before the game: each AI player's style beside its name, not Ann's.
        board.click("#settings-button")
        board.wait_for_selector(".overlay.settings .ai-style")
        styles = board.locator(".overlay.settings .ai-style")
        assert styles.count() == 2, f"{styles.count()} styles shown for 2 AI players"
        for k in range(2):
            assert styles.nth(k).inner_text() in ("conservative", "aggressive", "erratic"), styles.nth(k).inner_text()
            assert styles.nth(k).get_attribute("title").startswith("Play style: "), styles.nth(k).get_attribute("title")
        assert board.evaluate(ROWS_CLEAR) == [], board.evaluate(ROWS_CLEAR)
        board.click(".overlay.settings [data-close-overlay]")

        ann.click("#ready")
        wait(lambda: all(pl["ready"] for pl in players().values()), 10, "everyone ready")
        a("POST", "/game/start", {})
        wait(lambda: a("GET", "/state")["phase"] == "active", 10, "the game running")

        # During the game: a tap on the style changes it from the AI's next move on.
        target = ais[0]
        board.click("#settings-button")
        board.click(f".overlay.settings [data-ai-options='{target['id']}']")
        board.wait_for_selector(".dialog.form select[name=style]")
        assert "from its next move on" in board.inner_text(".dialog.form")
        board.select_option(".dialog.form select[name=style]", "aggressive")
        board.screenshot(path=os.path.join(OUT, "ai-style-form.png"))
        board.click(".dialog.form [data-x=yes]")
        wait(lambda: players()[target["name"]].get("aiOptions", {}).get("style") == "aggressive", 10, "the new style")
        wait(lambda: "aggressive" == board.inner_text(f".overlay.settings [data-ai-options='{target['id']}']"), 10, "the row showing it")
        assert board.evaluate(ROWS_CLEAR) == [], board.evaluate(ROWS_CLEAR)
        board.screenshot(path=os.path.join(OUT, "ai-style-settings.png"))
        board.click(".overlay.settings [data-close-overlay]")

        # Long option labels (like Chess's engine and strength): values on the row, the rows stay one line high.
        duel = start_table(8140, TABLE_KEY=KEY, PUBLIC_URL="http://127.0.0.1:8140", GAMES_DIR=os.path.join(REPO, "tests", "fixtures", "local-seat"), SHOW_TEST_GAMES="1")
        try:
            b2 = br.new_page(viewport={"width": 1920, "height": 1080})
            watch(b2, "duel board")
            b2.goto("http://127.0.0.1:8140/board/")
            api("POST", "/game/select", {"gameId": "duel"}, base="http://127.0.0.1:8140", key=KEY)
            api("POST", "/ai", {}, base="http://127.0.0.1:8140", key=KEY)
            b2.click("#settings-button")
            b2.wait_for_selector(".overlay.settings .ai-style")
            btn = b2.locator(".overlay.settings .ai-style").first
            assert btn.get_attribute("title").startswith("Engine (online ones fall back to the own engine): "), btn.get_attribute("title")
            assert "Strength (Elo, approximate)" not in btn.inner_text(), btn.inner_text()
            clear = b2.evaluate(ROWS_CLEAR)
            assert clear == [], clear
            b2.screenshot(path=os.path.join(OUT, "ai-style-long-labels.png"))
        finally:
            duel.terminate()
        problems = list(errors)
        assert not problems, problems
        print("ok")
finally:
    proc.terminate()
