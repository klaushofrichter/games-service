"""Browser check of FreeCell (D-308), the solo game played on the board.

  - the deal lies on the board: 52 cards, eight columns, four free cells, four foundations; the phone only says that the
    game is on the board;
  - a card dropped where it may not go slides back; a tap moves a card where it fits; Undo takes it back;
  - Hint lights a card and its place; dragging the card there makes the move. Following the hints solves the deal:
    cards go home by themselves, and the game ends with "Solved";
  - turned to face north the board is upside down and dragging still follows the pointer;
  - a deal's number entered in the board's settings (number pad, asked first) deals that deal;
  - Awards and Results shows what was earned (a game for one keeps its awards).

A Table Host of its own (port 8154).
  python3 scripts/e2e/freecell.py out/
"""
import os, sys
from playwright.sync_api import sync_playwright
from common import api, errors, join_deck, open_board, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
PORT = 8154
BASE = f"http://127.0.0.1:{PORT}"
KEY = "freecell-e2e"


def a(method, path, body=None):
    return api(method, path, body, base=BASE, key=KEY)


proc = start_table(PORT, TABLE_KEY=KEY, PUBLIC_URL=BASE)
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        board = br.new_page(viewport={"width": 1920, "height": 1080})
        watch(board, "board")
        open_board(board, BASE + "/board/")
        phone = br.new_context(viewport={"width": 320, "height": 568}, has_touch=True).new_page()  # the narrowest phone
        watch(phone, "phone")
        join_deck(phone, a("GET", "/join")["url"], "Klaus")
        a("POST", "/game/select", {"gameId": "freecell"})
        phone.click("#ready")
        wait(lambda: all(pl["ready"] for pl in a("GET", "/state")["players"]), 5, "the player to be ready")
        a("POST", "/game/start")
        board.wait_for_selector(".fc-root .fc-card")
        board.wait_for_timeout(1800)  # (the deal is dealt out)
        board.screenshot(path=os.path.join(OUT, "freecell-deal.png"))

        # What lies where, read from the page: each card's place by its position.
        STATE = """() => { const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, top: b.top, left: b.left }; };
          return { cards: [...document.querySelectorAll('.fc-card')].map((el) => ({ card: Number(el.dataset.card), movable: el.classList.contains('fc-movable'), hint: el.classList.contains('fc-hint'), source: el.classList.contains('fc-hint-from'), z: Number(el.style.zIndex), ...r(el) })),
            hintSlot: (() => { const s = document.querySelector('.fc-slot.fc-hint'); return s ? r(s) : null; })(),
            note: document.querySelector('.fc-note').hidden ? '' : document.querySelector('.fc-note').textContent,
            moves: Number(document.querySelector('.fc-moves').textContent), home: document.querySelector('.fc-home').textContent }; }"""
        state = lambda: board.evaluate(STATE)
        s = state()
        assert len(s["cards"]) == 52 and s["moves"] == 0 and s["home"].startswith("0"), s["home"]
        assert board.locator(".fc-slot.fc-cell").count() == 4 and board.locator(".fc-slot.fc-found").count() == 4 and board.locator(".fc-slot.fc-col").count() == 8
        assert "played on the board" in phone.inner_text("#game, #app"), "the phone does not say where the game is"

        # The cards' design (D-310) is chosen on the phone, each shown with a few of its cards; the board changes at
        # once, in the middle of a game, and the table keeps the choice: a board loaded anew shows it again.
        phone.wait_for_selector(".fcd-design[data-design=classic].on")
        assert phone.locator(".fcd-design").count() == 6 and phone.locator(".fcd-preview .fc-card").count() == 24
        loaded = "() => [...document.querySelectorAll('.fc-card img')].every((i) => i.complete && i.naturalWidth > 0)"
        phone.wait_for_function(loaded)
        wide = phone.evaluate("() => document.documentElement.scrollWidth - innerWidth")
        assert wide <= 0, f"the phone's page is {wide} px wider than the screen"
        phone.screenshot(path=os.path.join(OUT, "freecell-phone-designs.png"), full_page=True)
        for d in ("plain", "mosaic", "botanical", "linea", "speakeasy"):
            phone.click(f".fcd-design[data-design={d}]")
            board.wait_for_selector(f".fc-root.fc-d-{d}")
            board.wait_for_function(loaded)
            assert board.locator(".fc-root .fc-card .fc-ix").count() == 52, f"{d}: a card lost its corner"
            board.wait_for_timeout(300)
            board.screenshot(path=os.path.join(OUT, f"freecell-design-{d}.png"))
        assert board.locator(".fc-d-botanical").count() == 0 and board.locator(".fc-card img.fc-scene").count() == 12, "the speakeasy court cards"
        board.reload()
        board.wait_for_selector(".fc-root.fc-d-speakeasy")
        phone.click(".fcd-design[data-design=classic]")
        board.wait_for_selector(".fc-root.fc-d-classic")
        phone.wait_for_selector(".fcd-design[data-design=classic].on")
        board.wait_for_timeout(1800)

        def drag(x0, y0, x1, y1):
            board.mouse.move(x0, y0)
            board.mouse.down()
            board.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, steps=3)
            board.mouse.move(x1, y1, steps=3)
            board.mouse.up()

        def settle():
            """Until every card lies still (cards going home by themselves follow one after the other)."""
            last = None
            for _ in range(60):
                board.wait_for_timeout(150)
                now = [(c["x"], c["y"]) for c in state()["cards"]]
                if now == last:
                    return
                last = now
            raise AssertionError("the cards never came to rest")

        # A card dropped on nothing slides back, and that is no move.
        top = max((c for c in s["cards"] if c["movable"]), key=lambda c: c["y"])
        drag(top["x"], top["top"] + 20, 120, 900)
        settle()
        again = next(c for c in state()["cards"] if c["card"] == top["card"])
        assert abs(again["x"] - top["x"]) < 2 and abs(again["y"] - top["y"]) < 2, f"a card dropped beside the columns did not slide back: {top} -> {again}"
        assert state()["moves"] == 0

        # A tap moves a card where it fits best; Undo takes it back.
        board.mouse.click(top["x"], top["top"] + 20)
        wait(lambda: state()["moves"] == 1, 5, "a tap to move a card")
        settle()
        moved = next(c for c in state()["cards"] if c["card"] == top["card"])
        assert abs(moved["x"] - top["x"]) > 50 or abs(moved["y"] - top["y"]) > 50, "the tapped card did not move"
        board.click(".fc-btn[data-do=undo]")
        settle()
        back = next(c for c in state()["cards"] if c["card"] == top["card"])
        assert abs(back["x"] - top["x"]) < 2 and abs(back["y"] - top["y"]) < 2, "Undo did not put the card back"
        assert board.locator(".fc-btn[data-do=undo]").is_disabled(), "Undo is offered with nothing to take back"

        # Another deal by its number, from the board's settings (the gear): typed on the number pad, and asked first,
        # since the game that is on ends. Cancel keeps the game; the deal's number shows on the board.
        first = board.inner_text(".fc-deal")
        def enter_deal(n, answer):
            board.click("#settings-button")
            board.click(".overlay.settings button.pad-value")
            board.click(".number-pad button[data-clear]")
            for ch in str(n):
                board.click(f".number-pad .keys button[data-key='{ch}']")
            board.click(".number-pad button[data-enter]")
            board.wait_for_selector(f".dialog-backdrop .dialog >> text=Play deal #{n}?")
            board.click(f".dialog-backdrop button[data-x={answer}]")
            board.click(".overlay.settings [data-close-overlay]")
        enter_deal(1, "no")
        board.wait_for_timeout(400)
        assert board.inner_text(".fc-deal") == first, "Cancel started another deal"
        enter_deal(1, "yes")
        wait(lambda: board.inner_text(".fc-deal") == "#1", 5, "deal 1 to be dealt")
        settle()
        assert state()["moves"] == 0 and state()["home"].startswith("0")

        def follow_hint(turned=False):
            """Ask for a hint and make the hinted move by dragging the card to its place."""
            before = state()["moves"]
            board.click(".fc-btn[data-do=hint]")
            board.wait_for_selector(".fc-card.fc-hint")
            h = state()
            assert h["note"].startswith("Hint:"), h["note"]
            hinted = sorted((c for c in h["cards"] if c["hint"]), key=lambda c: c["z"])
            src = next(c for c in hinted if c["source"])
            dst = next((c for c in hinted if c is not src), None) or h["hintSlot"]
            assert dst, f"the hint shows no place to go: {h['note']}"
            # hold the card near its top (its visible strip in a column); upside down that is its lower edge on the screen
            grab_y = src["top"] + (196 * board.evaluate("() => document.querySelector('.fc-card').getBoundingClientRect().height / 196") - 20 if turned else 20)
            drag(src["x"], grab_y, dst["x"], dst["y"] + (-30 if turned else 30))
            try:
                wait(lambda: state()["moves"] == before + 1, 5, f"the hinted move to be made ({h['note']})")
            except AssertionError:
                board.screenshot(path=os.path.join(OUT, "freecell-stuck.png"))
                print("src", src, "dst", dst, "hinted", [(c["card"], c["movable"]) for c in hinted])
                raise
            settle()

        for _ in range(6):
            follow_hint()
        board.screenshot(path=os.path.join(OUT, "freecell-play.png"))

        # Turned to face north: the board is upside down, and the drag still goes where the pointer goes.
        a("POST", "/rotate", {"degrees": 180})
        board.wait_for_selector(".fc-root.fc-north")
        board.wait_for_timeout(600)
        for _ in range(4):
            follow_hint(turned=True)
        board.screenshot(path=os.path.join(OUT, "freecell-north.png"))
        a("POST", "/rotate", {"degrees": 180})
        board.wait_for_selector(".fc-root:not(.fc-north)")
        board.wait_for_timeout(600)

        # The house rule (D-310, on by default): a foundation's top card may be dragged back to a free cell or a
        # column; that is a move, and Undo takes it back. Switched off in the board's settings, the card stays; the
        # table keeps the choice.
        FOUND = """() => { const r = (e) => e.getBoundingClientRect(); const slots = [...document.querySelectorAll('.fc-found')].map(r);
          const cards = [...document.querySelectorAll('.fc-card')].map((e) => ({ e, b: r(e), z: Number(e.style.zIndex) }));
          const at = (s) => cards.filter((c) => Math.abs(c.b.left - s.left) < 2 && Math.abs(c.b.top - s.top) < 2).sort((a, b) => b.z - a.z)[0];
          const top = slots.map(at).find(Boolean);
          const cell = [...document.querySelectorAll('.fc-cell')].map(r).find((s) => !at(s));
          return top && cell ? { x: top.b.left + top.b.width / 2, y: top.b.top + top.b.height / 2, movable: top.e.classList.contains('fc-movable'), cx: cell.left + cell.width / 2, cy: cell.top + cell.height / 2 } : null; }"""
        for _ in range(60):
            f = board.evaluate(FOUND)
            if f:
                break
            follow_hint()
        assert f and f["movable"], f"no foundation card to take back, or it can't be picked up: {f}"
        before = state()
        drag(f["x"], f["y"], f["cx"], f["cy"])
        wait(lambda: state()["moves"] == before["moves"] + 1, 5, "a card taken back from a foundation to be a move")
        settle()
        assert int(state()["home"].split("/")[0]) == int(before["home"].split("/")[0]) - 1, (before["home"], state()["home"])
        board.click(".fc-btn[data-do=undo]")
        settle()
        assert state()["home"] == before["home"], "Undo did not put the card back on its foundation"
        def house_rule(want):
            board.click("#settings-button")
            row = board.locator(".overlay.settings .row", has_text="taken back from the foundations")
            assert row.locator("button[role=switch]").get_attribute("aria-checked") == ("false" if want else "true")
            row.locator("button[role=switch]").click()
            wait(lambda: row.locator("button[role=switch]").get_attribute("aria-checked") == ("true" if want else "false"), 5, "the house rule's switch to turn")
            board.click(".overlay.settings [data-close-overlay]")
        house_rule(False)
        f = board.evaluate(FOUND)
        assert f and not f["movable"], "with the house rule off a foundation card can still be picked up"
        drag(f["x"], f["y"], f["cx"], f["cy"])
        settle()
        assert state()["home"] == before["home"], "with the house rule off a card left its foundation"
        # The table keeps it with the game's settings (D-325): the next game begins with the rule as it was left.
        wait(lambda: a("GET", "/game-data/freecell").get("settings") == {"takeBack": False}, 5, "the table to keep the house rule")
        house_rule(True)
        assert board.evaluate(FOUND)["movable"]

        # Follow the hints to the end: the game solves.
        for k in range(400):
            if a("GET", "/state")["phase"] != "active":
                break
            if board.locator(".fc-note.fc-won").count():
                break
            follow_hint()
        board.wait_for_selector(".fc-note.fc-won", timeout=20000)
        assert state()["home"].startswith("52"), state()["home"]
        board.screenshot(path=os.path.join(OUT, "freecell-solved.png"))

        # Awards and Results: a game for one keeps its awards.
        board.wait_for_selector("#stats-button:not([hidden])", timeout=20000)
        board.click("#stats-button")
        board.wait_for_selector(".overlay.statistics .stats-panel")
        titles = board.locator(".overlay.statistics .award h3").all_inner_texts()
        assert "Solved" in titles and "Good Advice" in titles, f"the awards of a solved game with hints: {titles}"
        assert "On Your Own" not in titles, titles
        board.screenshot(path=os.path.join(OUT, "freecell-awards.png"))
        br.close()
finally:
    proc.terminate()
if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("ok: freecell")
