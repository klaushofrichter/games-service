"""Browser end-to-end check: a real board page and phone decks play a game; screenshots on the way.

Starts nothing itself: run a Table Host first, e.g.
  PORT=8090 TABLE_KEY=devkey AI_DELAY_MS=300 PUBLIC_URL=http://127.0.0.1:8090 node apps/table-host/src/main.ts
then:
  python3 scripts/e2e/play.py roulette out/
Fails (exit 1) on any browser console error or uncaught exception.
"""
import os, sys, time
from playwright.sync_api import sync_playwright
from common import BASE, api, errors, join_deck, pick_game, reset, watch, wait

GAME = sys.argv[1] if len(sys.argv) > 1 else "roulette"
OUT = sys.argv[2] if len(sys.argv) > 2 else "e2e-out"
os.makedirs(OUT, exist_ok=True)


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, f"{GAME}-{name}.png"))


def join(browser, name):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True)
    d = ctx.new_page()
    watch(d, name)
    return join_deck(d, api("GET", "/join")["url"], name)


SCENARIOS = {}


def scenario(fn):
    SCENARIOS[fn.__name__] = fn
    return fn


@scenario
def roulette(browser, board):
    api("POST", "/layout", {"seats": 4})
    decks = [join(browser, n) for n in ["Klaus", "Mira", "Jonas"]]
    api("POST", "/ai", {})
    api("POST", "/game/select", {"gameId": "roulette", "settings": {"rounds": 2, "bettingSeconds": 60, "resultSeconds": 15}})
    time.sleep(0.4)
    for d in decks:
        d.click("#ready")
    time.sleep(0.4)
    api("POST", "/game/start")
    decks[0].wait_for_selector(".rd-balance")
    d0, d1, d2 = decks
    d0.click("[data-chip='100']"); d0.click("[data-type=red]"); d0.click("[data-type=straight][data-target='17']")
    d1.click("[data-chip='50']"); d1.click("[data-type=dozen][data-target='2']"); d1.click("[data-type=odd]")
    d2.click("[data-chip='25']"); d2.click("[data-type=straight][data-target='0']"); d2.click("[data-type=column][data-target='3']")
    time.sleep(0.8)
    shot(board, "board-betting")
    shot(d0, "deck-betting")
    for d in decks:
        d.click(".rd-done")
    time.sleep(1.2)
    shot(board, "board-spinning")
    time.sleep(5.5)
    shot(board, "board-result")
    shot(d0, "deck-result")
    v = api("GET", "/game/board")["view"]
    assert v["phase"] == "result", v["phase"]
    api("POST", "/rotate", {"degrees": 180})
    time.sleep(0.8)
    shot(board, "board-rotated")
    # D-101: the turn-around button sits left of the gear (in the viewer's frame) and turns the game back; the seat
    # plates stay where they are, and a lobby turned east leaves the game facing the way it was
    plates = lambda: board.evaluate("() => [...document.querySelectorAll('#seats > .seat')].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; })")
    before = plates()
    flip, gear = board.locator("#flip-button").bounding_box(), board.locator("#settings-button").bounding_box()
    assert flip["x"] > gear["x"], f"facing north, the turn-around button belongs to the viewer's left of the gear: {flip} {gear}"
    board.click("#flip-button")
    wait(lambda: api("GET", "/state")["frontEdge"] == "south", 5, "the game to face south")
    time.sleep(0.6)
    flip, gear = board.locator("#flip-button").bounding_box(), board.locator("#settings-button").bounding_box()
    assert flip["x"] < gear["x"], f"facing south, the turn-around button is left of the gear: {flip} {gear}"
    assert plates() == before, "turning the game must not move the seat plates"
    api("POST", "/face", {"edge": "east"})
    time.sleep(0.5)
    assert board.evaluate("() => document.querySelector('#flip-button svg').style.transform") == "rotate(0deg)", "a lobby turned east must leave the game facing south"
    api("POST", "/face", {"edge": "south"})
    return decks


@scenario
def pachisi(browser, board):
    api("POST", "/layout", {"seats": 4})
    decks = [join(browser, n) for n in ["Klaus", "Mira"]]
    api("POST", "/ai", {})
    api("POST", "/game/select", {"gameId": "pachisi", "settings": {"turnSeconds": 60, "tokens": 4}})
    time.sleep(0.4)
    for d in decks:
        d.click("#ready")
    time.sleep(0.4)
    api("POST", "/game/start")
    decks[0].wait_for_selector(".pc-what")
    # Settings (D-088): Pachisi adds player colours. Klaus picks purple, then Mira picks purple too and they swap.
    board.click("#settings-button")
    board.wait_for_selector(".game-settings")
    rows = board.locator(".game-settings .row")
    rows.nth(0).locator(".swatch").nth(4).click()
    purple = "rgb(195, 139, 232)"
    wait_for = lambda page, sel, color: page.wait_for_function(
        "([s, c]) => [...document.querySelectorAll(s)].some((e) => getComputedStyle(e).backgroundColor === c)", arg=[sel, color], timeout=5000)
    wait_for(decks[0], ".pc-tokens .card > div:first-child", purple)  # Klaus's phone follows
    klaus_before = rows.nth(0).locator(".swatch.on").get_attribute("style")
    rows.nth(1).locator(".swatch").nth(4).click()
    wait_for(decks[1], ".pc-tokens .card > div:first-child", purple)
    board.wait_for_function("() => document.querySelectorAll('.game-settings .swatch.on').length === 3")
    assert rows.nth(0).locator(".swatch.on").get_attribute("style") != klaus_before, "picking a taken colour swaps it"
    shot(board, "settings-pachisi")
    board.click("[data-close-overlay]")
    moves = 0
    shot_move = False
    for _ in range(160):
        v = api("GET", "/game/board")["view"]
        if v["over"]:
            break
        seat = v["turn"]
        if seat > 1:  # AI seat plays by itself
            time.sleep(0.35)
            continue
        d = decks[seat]
        if v["phase"] == "roll":
            d.wait_for_selector(".pc-roll:not([hidden])", timeout=3000)
            d.click(".pc-roll")
        else:
            d.wait_for_selector("button[data-token]", timeout=3000)
            if not shot_move and moves > 6:
                shot(d, "deck-move")
                shot_move = True
            d.click("button[data-token]")
            moves += 1
            if moves == 14:
                time.sleep(0.8)
                shot(board, "board-midgame")
        time.sleep(0.25)
    assert moves >= 10, f"only {moves} human moves"
    shot(decks[1], "deck-waiting")
    return decks


@scenario
def holdem(browser, board):
    api("POST", "/layout", {"seats": 4})
    decks = [join(browser, n) for n in ["Klaus", "Mira", "Jonas"]]
    api("POST", "/ai", {})
    api("POST", "/game/select", {"gameId": "holdem", "settings": {"hands": 3, "turnSeconds": 60, "showdownSeconds": 20}})
    time.sleep(0.4)
    for d in decks:
        d.click("#ready")
    time.sleep(0.4)
    api("POST", "/game/start")
    decks[0].wait_for_selector(".he-mine .hc")
    took = set()
    for step in range(60):
        v = api("GET", "/game/board")["view"]
        if v["phase"] == "handOver":
            time.sleep(0.6)
            shot(board, "board-showdown")
            shot(decks[0], "deck-result")
            break
        if v["toAct"] is None or v["toAct"] > 2:
            time.sleep(0.35)
            continue
        d = decks[v["toAct"]]
        d.wait_for_selector(".he-actions:not([hidden]) .he-call", timeout=3000)
        if v["street"] == "flop" and "flop" not in took:
            time.sleep(0.5)
            shot(board, "board-flop")
            shot(d, "deck-turn")
            took.add("flop")
        # one player raises once on the turn to exercise betting
        if v["street"] == "turn" and "raise" not in took:
            d.click(".he-raise")
            took.add("raise")
        else:
            d.click(".he-call")
        time.sleep(0.3)
    assert "flop" in took, "never reached the flop"
    v = api("GET", "/game/board")["view"]
    assert v["phase"] == "handOver", v["phase"]
    return decks


@scenario
def coinflip(browser, board):
    decks = [join(browser, n) for n in ["Klaus", "Mira"]]
    api("POST", "/ai", {})
    api("POST", "/game/select", {"gameId": "coin-flip", "settings": {"rounds": 2, "roundSeconds": 30}})
    time.sleep(0.4)
    # D-089: the AI shows Ready on the board; the phone says what is true now and what the button switches to
    board.wait_for_selector(".seat.ai >> text=Ready")
    decks[0].wait_for_selector("text=You are not ready yet")
    assert decks[0].inner_text("#ready") == "Switch to ready"
    for d in decks:
        d.click("#ready")
    decks[0].wait_for_selector("text=You are ready")
    assert decks[0].inner_text("#ready") == "Switch to not ready"
    # D-090: change the rounds from the board's settings before the start, Ready stays
    board.click("#settings-button")
    board.wait_for_selector(".game-rules")
    board.locator(".game-rules [data-setting=rounds][data-delta='1']").click()
    wait(lambda: api("GET", "/state")["game"]["settings"]["rounds"] == 3, 5, "rounds to become 3")
    assert all(p["ready"] for p in api("GET", "/state")["players"])
    # D-092: sound effects switch off and on again from the settings
    board.click("[data-sound]")
    wait(lambda: api("GET", "/state")["display"]["sound"] is False, 5, "sound off")
    board.wait_for_selector("[data-sound] >> text=Off")
    board.click("[data-sound]")
    wait(lambda: api("GET", "/state")["display"]["sound"] is True, 5, "sound on")
    board.click("[data-close-overlay]")
    api("POST", "/game/start")
    board.click("#settings-button")  # during the game the settings are shown, not editable
    board.wait_for_selector(".game-rules")
    assert board.locator(".game-rules [data-setting]").count() == 0, "game settings must be read-only while playing"
    board.click("[data-close-overlay]")
    decks[0].wait_for_selector(".cf-clock >> text=Time to pick")  # countdown on the phone
    board.wait_for_selector(".cf-clock >> text=seconds to pick")  # and on the board
    for rnd in range(3):
        decks[0].wait_for_selector("[data-guess=heads]:not([disabled])")
        decks[0].click("[data-guess=heads]")
        decks[1].click("[data-guess=tails]")
        if rnd == 0:
            board.wait_for_selector(".cf-picks >> text=Klaus · heads")  # everyone's pick shows with the flip
            board.wait_for_selector(".cf-picks >> text=Mira · tails")
            time.sleep(1.3)
            shot(board, "board")
            shot(decks[0], "deck")
    # D-092: the board played the coin's sounds (spin and landing) for each round
    # (the last flip's spin needs the final step's events, which used to be dropped when a step ended the game)
    time.sleep(1.5)
    played = board.evaluate("() => window.gameTableSounds ?? []")
    assert played.count("coin-spin") == 3 and played.count("coin-land") >= 2, played
    # D-091: the last screen stays, with statistics, until Show result
    wait(lambda: api("GET", "/state")["phase"] == "finished", 10, "the game to finish")
    board.wait_for_selector("#result-button:not([hidden])")
    board.wait_for_selector(".cf-table >> text=Klaus")
    board.wait_for_selector("text=All 3 rounds played")
    shot(board, "held-final")
    board.click("#result-button")
    board.wait_for_selector(".summary-table >> text=Heads %")
    decks[0].wait_for_selector(".summary-table >> text=Klaus")
    shot(board, "result")
    return decks


@scenario
def endings(browser, board):
    """D-089..D-093: the phone's name line, sound off, a game ended from the lobby, a full table."""
    api("POST", "/layout", {"seats": 2})
    decks = [join(browser, n) for n in ["Klaus", "Mira"]]
    # the phone: name on the left, the seat's compass badge on the right, no separate seat card
    assert decks[0].inner_text(".who .badge") == "S" and decks[1].inner_text(".who .badge") == "N"
    assert decks[0].locator(".seatcard").count() == 0
    extra = join(browser, "Paul")  # the 2-seat table is full
    extra.wait_for_selector("text=No seat yet")
    assert extra.locator(".who .badge").count() == 0
    extra.close()
    # sound off: a whole game plays without a single sound effect
    api("POST", "/display", {"sound": False})
    board.click("#settings-button")  # also wakes audio, as a touch would
    board.wait_for_selector("[data-sound] >> text=Off")
    board.click("[data-close-overlay]")
    board.evaluate("() => (window.gameTableSounds = [])")
    api("POST", "/game/select", {"gameId": "coin-flip", "settings": {"rounds": 1, "roundSeconds": 0}})
    for d in decks:
        d.click("#ready")
    wait(lambda: all(p["ready"] for p in api("GET", "/state")["players"] if p["seat"] is not None), 5, "everyone ready")
    api("POST", "/game/start")
    for d, g in zip(decks, ["heads", "tails"]):
        d.wait_for_selector(f"[data-guess={g}]:not([disabled])")
        d.click(f"[data-guess={g}]")
    board.wait_for_selector("#result-button:not([hidden])")  # held, as a game that ended by itself
    time.sleep(1.4)
    assert board.evaluate("() => window.gameTableSounds") == [], "no sounds with sound off"
    board.click("#result-button")
    # a game ended from the lobby goes straight to the result, no held screen
    board.click("[data-again]")
    wait(lambda: api("GET", "/state")["phase"] == "ready", 5, "ready again")
    for d in decks:
        d.click("#ready")
    wait(lambda: all(p["ready"] for p in api("GET", "/state")["players"] if p["seat"] is not None), 5, "everyone ready")
    api("POST", "/game/start")
    board.wait_for_selector("#lobby-button:not([hidden])")
    board.click("#lobby-button")
    board.click("[data-end]")
    board.click(".dialog [data-x=yes]")
    wait(lambda: api("GET", "/state")["phase"] == "finished", 5, "the game to end")
    board.wait_for_selector("text=finished")
    assert board.locator("#result-button").is_hidden(), "ended from the lobby: no held screen"
    shot(board, "ended-from-lobby")
    api("POST", "/display", {"sound": True})
    return decks


@scenario
def dialogs(browser, board):
    api("POST", "/layout", {"seats": 4})
    decks = [join(browser, "Klaus")]
    ai = api("POST", "/ai", {})["playerId"]
    time.sleep(0.5)
    pick_game(board, "roulette")
    board.wait_for_selector(".dialog.form")
    board.fill(".dialog [name=rounds]", "4")
    shot(board, "settings-dialog")
    board.click(".dialog [data-x=yes]")
    time.sleep(0.5)
    st = api("GET", "/state")
    assert st["phase"] == "ready" and st["game"]["settings"]["rounds"] == 4, st
    seat = next(p["seat"] for p in st["players"] if p["id"] == ai)
    board.locator(".seat").nth(seat).click()
    board.click(f"[data-config='{ai}']")
    board.wait_for_selector(".dialog.form select[name=style]")
    board.select_option(".dialog select[name=style]", "aggressive")
    shot(board, "ai-dialog")
    board.click(".dialog [data-x=yes]")
    time.sleep(0.5)
    st = api("GET", "/state")
    assert next(p for p in st["players"] if p["id"] == ai)["aiOptions"] == {"style": "aggressive"}
    shot(board, "ready-with-ai")
    return decks


@scenario
def rules(browser, board):
    """Every game's rules on the smallest phone (D-099): the Rules button, the modal, its images, the settings at this
    table, nothing wider than the screen, and closing it again (button, backdrop, Escape)."""
    ctx = browser.new_context(viewport={"width": 320, "height": 568}, device_scale_factor=2, has_touch=True)
    d = ctx.new_page()
    watch(d, "phone")
    join_deck(d, api("GET", "/join")["url"], "Klaus")
    api("POST", "/ai", {})
    assert d.locator("[data-rules]").count() == 0, "no Rules button before a game is chosen"
    games = [g for g in api("GET", "/games") if g["howToPlay"]]
    assert {"roulette", "pachisi", "holdem", "coin-flip"} <= {g["id"] for g in games}, [g["id"] for g in games]
    for g in games:
        if g["id"] == "quartet":
            continue  # needs four humans; its rules are checked by tests/rules.test.ts
        api("POST", "/game/select", {"gameId": g["id"]})
        d.locator("[data-rules]").click()
        d.locator(".rules-modal .md h3").first.wait_for()
        title = d.inner_text(".rules-modal .rules-head h2")
        assert title.strip(), f"{g['id']}: no title"
        imgs = d.locator(".rules-modal .md img")
        for k in range(imgs.count()):
            imgs.nth(k).scroll_into_view_if_needed()
            wait(lambda: imgs.nth(k).evaluate("i => i.complete && i.naturalWidth > 0"), 10, f"{g['id']} image {k}")
        if g["settings"]:
            assert d.locator(".rules-settings tr").count() == len(g["settings"]), f"{g['id']}: settings at this table"
        wide = d.evaluate("() => [...document.querySelectorAll('.rules-modal *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.md-table')).map(e => e.tagName + '.' + e.className).slice(0, 3)")
        assert not wide, f"{g['id']}: sticks out of a 320 px phone: {wide}"
        d.locator(".rules-modal .rules-body").evaluate("b => b.scrollTop = 0")
        shot(d, f"rules-{g['id']}")
        if g["id"] == "roulette":
            d.keyboard.press("Escape")
        elif g["id"] == "pachisi":
            d.mouse.click(160, 4)  # the backdrop above the sheet
        else:
            d.locator(".rules-modal .rules-close").click()
        d.wait_for_selector(".rules-modal", state="detached")
    api("POST", "/game/close", {})
    return [d]


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        board = browser.new_page(viewport={"width": 1920, "height": 1080})
        watch(board, "board")
        reset()
        board.goto(BASE + "/board/")
        time.sleep(0.8)
        decks = SCENARIOS[GAME](browser, board)
        time.sleep(0.3)
        browser.close()
    reset()
    if errors:
        print("BROWSER ERRORS:\n" + "\n".join(errors))
        sys.exit(1)
    print(f"ok: {GAME}, screenshots in {OUT}")


if __name__ == "__main__":
    main()
