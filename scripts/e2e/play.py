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
    # Mira picks a colour that is not her seat's: her chips must show it (lobby colours, D-106).
    mira = next(p for p in api("GET", "/state")["players"] if p["name"] == "Mira")
    api("POST", f"/players/{mira['id']}/color", {"color": "#9d6bf0"})
    board.mouse.click(5, 5)  # a touch on the board lets it play sound (browsers keep it off until then)
    api("POST", "/game/start")
    decks[0].wait_for_selector(".rd-balance")
    d0, d1, d2 = decks
    d0.click("[data-chip='100']"); d0.click("[data-type=red]"); d0.click("[data-type=straight][data-target='17']")
    d1.click("[data-chip='50']"); d1.click("[data-type=dozen][data-target='2']"); d1.click("[data-type=odd]")
    d2.click("[data-chip='25']"); d2.click("[data-type=straight][data-target='0']"); d2.click("[data-type=column][data-target='3']")
    time.sleep(0.8)
    # Every chip on its own cell, not stacked in the layout's corner; each in its player's colour.
    faces = board.locator(".rl-chip circle.face")
    spots = {(round(b["x"]), round(b["y"])) for b in (faces.nth(k).bounding_box() for k in range(faces.count()))}
    assert faces.count() >= 6 and len(spots) == faces.count(), spots
    colors = {p["name"]: p["color"] for p in api("GET", "/state")["players"]}
    for amount, who in (("100", "Klaus"), ("50", "Mira"), ("25", "Jonas")):
        fill = board.locator(f".rl-chip:has(text:text-is('{amount}')) circle.face").first.get_attribute("fill")
        assert fill == colors[who], (who, fill, colors[who])
    assert colors["Mira"] == "#9d6bf0", colors
    shot(board, "board-betting")
    shot(d0, "deck-betting")
    for d in decks:
        d.click(".rd-done")
    time.sleep(1.2)
    shot(board, "board-spinning")
    time.sleep(5.5)
    shot(board, "board-result")
    shot(d0, "deck-result")
    # D-150: chips, the spin and the number have sounds
    played = board.evaluate("() => window.gameTableSounds ?? []")
    assert {"roulette-bet", "roulette-spin", "roulette-reveal"} <= set(played), played
    v = api("GET", "/game/board")["view"]
    assert v["phase"] == "result", v["phase"]
    api("POST", "/rotate", {"degrees": 180})
    time.sleep(0.8)
    shot(board, "board-rotated")
    # D-101: the turn-around button sits left of the gear and turns the game back; the seat plates stay where they are,
    # and a lobby turned east leaves the game facing the way it was. D-127: the gear and the turn-around button stay put
    # whichever way the game faces.
    plates = lambda: board.evaluate("() => [...document.querySelectorAll('#seats > .seat')].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; })")
    before = plates()
    buttons = lambda: [board.locator(s).bounding_box() for s in ("#flip-button", "#settings-button")]
    flip, gear = north = buttons()
    assert flip["x"] < gear["x"], f"the turn-around button is left of the gear: {flip} {gear}"
    assert gear["y"] > 1080 / 2, f"the gear stays at the bottom while the game faces north: {gear}"
    board.click("#flip-button")
    wait(lambda: api("GET", "/state")["frontEdge"] == "south", 5, "the game to face south")
    time.sleep(0.6)
    assert buttons() == north, f"turning the game moved the buttons: {north} -> {buttons()}"
    assert plates() == before, "turning the game must not move the seat plates"
    api("POST", "/face", {"edge": "east"})
    time.sleep(0.5)
    assert board.locator("#flip-button").get_attribute("aria-label") == "Turn the game to face north", "a lobby turned east must leave the game facing south"
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
    # Player colours are the board's own setting (D-106), the same in every game. Klaus picks purple, then Mira picks
    # purple too and they swap. The board's cards and the phones follow.
    board.click("#settings-button")
    board.wait_for_selector(".player-colors")
    rows = board.locator(".player-colors .row")
    assert rows.count() == 3, "one row per seated player"
    rows.nth(0).locator(".swatch").nth(4).click()
    purple = "rgb(157, 107, 240)"  # colour 5, purple (D-147)
    wait_for = lambda page, sel, color: page.wait_for_function(
        "([s, c]) => [...document.querySelectorAll(s)].some((e) => getComputedStyle(e).backgroundColor === c)", arg=[sel, color], timeout=5000)
    wait_for(decks[0], ".pc-tokens .card > div:first-child", purple)  # Klaus's phone follows
    klaus_before = rows.nth(0).locator(".swatch.on").get_attribute("style")
    rows.nth(1).locator(".swatch").nth(4).click()
    wait_for(decks[1], ".pc-tokens .card > div:first-child", purple)
    board.wait_for_function("() => document.querySelectorAll('.player-colors .swatch.on').length === 3")
    # The board redraws the rows after the swap reaches it, which can be a moment after Mira's phone: wait for it.
    for _ in range(50):
        if rows.nth(0).locator(".swatch.on").get_attribute("style") != klaus_before:
            break
        time.sleep(0.1)
    assert rows.nth(0).locator(".swatch.on").get_attribute("style") != klaus_before, "picking a taken colour swaps it"
    # on the board: each player's card has a border and a dot before the name in their colour
    time.sleep(0.3)
    plates = board.evaluate("""() => [...document.querySelectorAll('.kit-plate')].map((e) => [e.querySelector('.kit-name').textContent.trim(),
      getComputedStyle(e).borderTopColor, getComputedStyle(e.querySelector('.kit-dot')).backgroundColor])""")
    rgb = lambda h: f"rgb({int(h[1:3], 16)}, {int(h[3:5], 16)}, {int(h[5:7], 16)})"
    want = {p["name"]: rgb(p["color"]) for p in api("GET", "/state")["players"]}
    assert len(plates) == 3 and all(border == dot == want[name] for name, border, dot in plates), f"plates {plates}, colours {want}"
    assert want["Mira"] == purple
    # Pachisi's own setting: the pieces, numbers or icons (D-102); its colour rows are gone
    game_rows = board.locator(".game-settings .row")
    assert game_rows.count() == 1 and "Numbers" in game_rows.nth(0).inner_text(), "Pachisi no longer has its own colour rows"
    # icons are the default (D-109); Numbers switches to 1-4 and Icons back
    board.wait_for_function("() => document.querySelectorAll('.pc-token svg[data-icon]').length === 12")
    game_rows.nth(0).locator("button", has_text="Numbers").click()
    board.wait_for_function("() => document.querySelectorAll('.pc-token svg').length === 0 && document.querySelector('.pc-token').textContent.trim() === '1'")
    decks[0].wait_for_function("() => document.querySelectorAll('.pc-piece svg').length === 0")
    game_rows.nth(0).locator("button", has_text="Icons").click()
    board.wait_for_selector(".game-settings .seg button.on >> text=Icons")
    on = board.evaluate("() => { const b = document.querySelector('.game-settings .seg button.on'); const cs = getComputedStyle(b); return [cs.color, cs.backgroundColor]; }")
    assert on[0] != on[1], f"the chosen option's label is invisible: {on}"
    icons = ["smiley", "star", "bullseye", "moon"]
    board.wait_for_function("() => document.querySelectorAll('.pc-token svg[data-icon]').length === 12")
    for d in decks:
        d.wait_for_function("() => document.querySelectorAll('.pc-piece svg[data-icon]').length === 4")
        assert d.evaluate("() => [...document.querySelectorAll('.pc-piece svg')].map((s) => s.dataset.icon)") == icons
    assert board.evaluate("() => [...document.querySelectorAll('.pc-token svg')].slice(0, 4).map((s) => s.dataset.icon)") == icons
    shot(board, "settings-pachisi")
    board.click("[data-close-overlay]")
    time.sleep(0.4)
    shot(decks[0], "deck-icons")
    moves = board_moves = 0
    shot_move = False
    six = captured = shot_mid = False
    # every sound, not only the last 50 the board keeps
    board.evaluate("""() => { const all = (window.allSounds = []); const list = (window.gameTableSounds = []);
      const push = list.push; list.push = function (...a) { all.push(...a); return push.apply(this, a); }; }""")
    for _ in range(200):
        v = api("GET", "/game/board")["view"]
        if v["over"]:
            break
        six = six or v["die"] == 6
        captured = captured or bool(v["lastMove"] and v["lastMove"]["captured"])
        seat = v["turn"]
        if seat > 1:  # AI seat plays by itself; the board offers none of its tokens to tap
            if v["phase"] == "move":
                assert board.locator(".pc-token.tap").count() == 0, "an AI player's token answers a tap on the board"
            time.sleep(0.35)
            continue
        d = decks[seat]
        if v["phase"] == "roll":
            d.wait_for_selector(".pc-roll:not([hidden])", timeout=3000)
            assert board.locator(".pc-token.tap").count() == 0, "tokens answer taps before the die is rolled"
            d.click(".pc-roll")
        elif moves % 2:
            # D-102: every other move by tapping the token on the board; only this player's movable tokens answer,
            # and the phone follows
            board.wait_for_selector(".pc-token.tap", timeout=3000)
            taps = board.evaluate("() => [...document.querySelectorAll('.pc-token.tap')].map((e) => [Number(e.dataset.seat), Number(e.dataset.token)])")
            assert taps and all(s == seat for s, _ in taps), f"tappable tokens {taps} on seat {seat}'s turn"
            legal = d.evaluate("() => [...document.querySelectorAll('button[data-token]')].map((b) => Number(b.dataset.token))")
            assert sorted(t for _, t in taps) == sorted(legal), f"board {taps} and phone {legal} offer different tokens"
            before = api("GET", "/game/board")["view"]["players"]
            board.locator(f".pc-token.tap[data-seat='{seat}'][data-token='{taps[0][1]}']").click(force=True)  # it bobs, so never "stable"
            wait(lambda: api("GET", "/game/board")["view"]["players"] != before, 5, "the tapped token to move")
            d.wait_for_selector("button[data-token]", state="detached", timeout=3000)  # the phone no longer asks
            moves += 1
            board_moves += 1
        else:
            d.wait_for_selector("button[data-token]", timeout=3000)
            if not shot_move and moves > 6:
                shot(d, "deck-move")
                shot_move = True
            d.click("button[data-token]")
            moves += 1
            if moves >= 14 and not shot_mid:
                time.sleep(0.8)
                shot(board, "board-midgame")
                shot_mid = True
        time.sleep(0.25)
    assert board_moves >= 4, f"only {board_moves} moves by tapping the board"
    # sounds: rolling, moving, and a six and a capture when they happened
    time.sleep(1.0)
    played = board.evaluate("() => window.allSounds")
    assert "pachisi-roll" in played and "pachisi-move" in played, played
    if six:
        assert "pachisi-six" in played, played
    if captured:
        assert "pachisi-capture" in played, played
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
    # D-091: the last screen stays until someone moves on; D-216: the one way on is Awards and Results, whose Done
    # leads to the results.
    wait(lambda: api("GET", "/state")["phase"] == "finished", 10, "the game to finish")
    board.wait_for_selector("#stats-button:not([hidden])")
    assert board.locator("#result-button").is_hidden(), "Show result besides Awards and Results"
    assert board.inner_text("#stats-button").startswith("Awards and Results")
    # In the game's corner (bottom right for Coin Flip), where Show result is, not inset beside it (D-217).
    gap = board.evaluate("""() => { const b = document.getElementById('stats-button').getBoundingClientRect();
      const s = document.getElementById('surface').getBoundingClientRect(), k = s.width / 1920;
      return { right: (s.right - b.right) / k, bottom: (s.bottom - b.bottom) / k }; }""")
    assert abs(gap["right"] - 26) < 4 and abs(gap["bottom"] - 26) < 4, f"Awards and Results is not in the corner: {gap}"
    board.wait_for_selector(".cf-table >> text=Klaus")
    board.wait_for_selector("text=All 3 rounds played")
    shot(board, "held-final")
    board.click("#stats-button")
    board.wait_for_selector(".overlay.statistics .stats-panel")
    # D-229: the window itself doesn't scroll (its scrollbar crossed the rounded corners); its inner body does.
    over = board.evaluate("""() => { const p = document.querySelector('.stats-panel'); const b = p.querySelector('.stats-body');
      return [getComputedStyle(p).overflowY, b && getComputedStyle(b).overflowY, !!p.querySelector('.stats-head [data-close-stats]')]; }""")
    assert over == ["hidden", "auto", True], f"Awards and Results scrolling: {over}"
    # D-233: Back to game shows the last screen again, its way on still in the corner.
    board.click(".overlay.statistics [data-back-stats]")
    board.wait_for_selector(".overlay.statistics", state="detached")
    assert board.locator("#stats-button:not([hidden])").count() == 1, "Back to game left no way on"
    board.click("#stats-button")
    board.wait_for_selector(".overlay.statistics .stats-panel")
    board.click(".overlay.statistics [data-close-stats]")
    board.wait_for_selector(".summary-table >> text=Heads %")
    decks[0].wait_for_selector(".summary-table >> text=Klaus")
    shot(board, "result")
    return decks


@scenario
def endings(browser, board):
    """D-089..D-093: the phone's name line, sound off, a game ended from the lobby, a full table (D-129)."""
    api("POST", "/layout", {"seats": 2})
    decks = [join(browser, n) for n in ["Klaus", "Mira"]]
    # the phone: name on the left, the seat's compass badge on the right, no separate seat card
    badges = [d.inner_text(".who .badge") for d in decks]
    assert badges == ["S", "N"], f"seat badges {badges}"
    assert decks[0].locator(".seatcard").count() == 0, "no separate seat card"
    # The 2-seat table is full (D-129): a third phone is told so instead of getting the name form.
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True)
    extra = ctx.new_page()
    watch(extra, "Paul")
    extra.goto(api("GET", "/join")["url"])
    extra.wait_for_selector("#no-seat :text('No free seat')")
    assert extra.locator("input[name=name]").count() == 0, "no name form without a free seat"
    ctx.close()
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
    # The game is over at once, but the way on waits until the board has shown the end: the coin lands first (D-134).
    wait(lambda: api("GET", "/state")["phase"] == "finished", 5, "the game to end")
    assert board.locator("#stats-button:not([hidden])").count() == 0, "Awards and Results appeared while the coin was still spinning"
    board.wait_for_selector("#stats-button:not([hidden])")  # held, as a game that ended by itself
    assert not board.evaluate("() => document.querySelector('.cf-coin')?.getAnimations().some((a) => a.playState === 'running')"), "Awards and Results appeared before the coin landed"
    time.sleep(1.4)
    assert board.evaluate("() => window.gameTableSounds") == [], "no sounds with sound off"
    # The statistics window (D-140, D-216): the way on from the end, with the awards the host kept, turnable at the table.
    summary = api("GET", "/state")["summary"]
    assert summary["players"] and summary["play"], summary
    board.wait_for_selector("#stats-button:not([hidden])")
    board.click("#stats-button")
    board.wait_for_selector(".overlay.statistics .stats-panel")
    shown = board.locator(".overlay.statistics .award").count()
    assert shown == len(summary["awards"]), (shown, summary["awards"])
    if not summary["awards"]:
        board.wait_for_selector(".overlay.statistics >> text=No awards in this game.")
    assert board.locator(".overlay.statistics .stats-table.play tr").count() == 3, "moves and time for both players"
    # The game's own table is "Results", moves and time "Statistics" (D-242).
    heads = board.locator(".overlay.statistics h4").all_inner_texts()
    want = (["results"] if summary.get("table") else []) + ["statistics"]
    assert [h.strip().lower() for h in heads if h.strip().lower() in ("results", "statistics", "moves and time")] == want, f"the section titles read {heads}"
    # Between two or more award holders "," and "and" are white (D-242).
    if board.locator(".overlay.statistics .award-holders").count():
        ink = board.evaluate("() => getComputedStyle(document.querySelector('.overlay.statistics .award-holders')).color")
        assert ink == "rgb(243, 238, 226)", f"the words between award holders are {ink}, not white"
    # Award holders in their players' colours (D-239), and a colour changed while the window is open follows.
    COLOURS = """() => [...document.querySelectorAll('.overlay.statistics .award-name')].map((e) => [Number(e.dataset.seat), getComputedStyle(e).color])"""
    hex_rgb = lambda h: f"rgb({int(h[1:3], 16)}, {int(h[3:5], 16)}, {int(h[5:7], 16)})"
    if summary["awards"]:
        by_seat = {pl["seat"]: pl for pl in api("GET", "/state")["players"] if pl["seat"] is not None}
        for seat, colour in board.evaluate(COLOURS):
            assert colour == hex_rgb(by_seat[seat]["color"]), (seat, colour, by_seat[seat]["color"])
        seat = board.evaluate(COLOURS)[0][0]
        new = next(c for c in ["#9d6bf0", "#f08a3c", "#ef8fcf"] if c not in {pl["color"] for pl in by_seat.values()})
        api("POST", f"/players/{by_seat[seat]['id']}/color", {"color": new})
        wait(lambda: all(c == hex_rgb(new) for s, c in board.evaluate(COLOURS) if s == seat), 5, "the award holder's new colour")
    # The players' names in the tables in their colours too (D-253), following a colour changed while open.
    NAMES = """() => [...document.querySelectorAll('.overlay.statistics .stats-table .player-name')].map((e) => [Number(e.dataset.seat), getComputedStyle(e).color])"""
    names = board.evaluate(NAMES)
    assert len(names) >= 2, f"no player names marked in the tables: {names}"
    by_seat = {pl["seat"]: pl for pl in api("GET", "/state")["players"] if pl["seat"] is not None}
    for seat, colour in names:
        assert colour == hex_rgb(by_seat[seat]["color"]), ("table name", seat, colour, by_seat[seat]["color"])
    board.screenshot(path=os.path.join(OUT, "statistics-south.png"))
    board.click(".overlay.statistics [data-face=east]")
    board.wait_for_timeout(500)  # the turn animates
    assert board.evaluate("() => document.querySelector('.stats-panel').classList.contains('sideways')"), "east: sideways"
    assert "rotate(-90deg)" in board.evaluate("() => document.querySelector('.stats-panel').style.transform")
    board.screenshot(path=os.path.join(OUT, "statistics-east.png"))
    board.click(".overlay.statistics [data-face=north]")
    assert "rotate(180deg)" in board.evaluate("() => document.querySelector('.stats-panel').style.transform")
    board.click(".overlay.statistics [data-close-stats]")
    board.wait_for_selector(".overlay.statistics", state="detached")
    # Done led on to the results (no Show result any more, D-216)
    board.wait_for_selector("[data-stats]")
    assert board.locator("#stats-button").is_hidden() and board.locator("#result-button").is_hidden()
    # and from the result screen; Escape closes it
    # The result screen's table names the players in their colours (D-253).
    if summary.get("table"):
        marked = board.evaluate("() => [...document.querySelectorAll('.summary-table .player-name')].map((e) => e.style.color)")
        assert marked and all(marked), f"the result table's names have no colour: {marked}"
    board.click("[data-stats]")
    board.wait_for_selector(".overlay.statistics .stats-panel")
    board.keyboard.press("Escape")
    board.wait_for_selector(".overlay.statistics", state="detached")
    # a game ended from the lobby goes straight to the result, no held screen
    board.click("[data-again]")
    wait(lambda: api("GET", "/state")["phase"] == "ready", 5, "ready again")
    for d in decks:
        d.click("#ready")
    wait(lambda: all(p["ready"] for p in api("GET", "/state")["players"] if p["seat"] is not None), 5, "everyone ready")
    api("POST", "/game/start")
    board.wait_for_selector("#lobby-button:not([hidden])")
    board.click("#lobby-button")
    # D-108: the terms open in a window on the board (✕ and Close), not in a new tab
    pages = len(board.context.pages)
    board.click(".overlay [data-terms]")
    # wait for the text itself: the window says "Loading…" in the same place first (that race failed on GitHub)
    board.locator(".overlay.terms .md >> text=entertainment").wait_for()
    assert len(board.context.pages) == pages, "the terms opened a new tab"
    shot(board, "terms")
    board.click(".overlay.terms .terms-close")
    board.wait_for_selector(".overlay.terms", state="detached")
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
    # D-104: the phone's "At the table" list shows each player's colour before the name (the seat's colour, which
    # framed their plate in a game)
    hexes = ["#f2d24b", "#5fb7e8", "#e5484d", "#7fd18b", "#9d6bf0", "#dde3ea", "#f08a3c", "#ef8fcf"]
    rgb = lambda h: f"rgb({int(h[1:3], 16)}, {int(h[3:5], 16)}, {int(h[5:7], 16)})"
    want = [rgb(hexes[p["seat"]]) for p in api("GET", "/state")["players"]]
    decks[0].wait_for_function("(n) => document.querySelectorAll('.list .row .pdot').length === n", arg=len(want))
    dots = decks[0].evaluate("() => [...document.querySelectorAll('.list .row .pdot')].map((e) => getComputedStyle(e).backgroundColor)")
    assert dots == want, f"dots {dots}, expected {want}"
    # D-106: the lobby's seat cards show the same colour as a border and a dot before the name
    cards = board.evaluate("""() => [...document.querySelectorAll('#seats .seat.taken')].map((e) => [getComputedStyle(e).borderTopColor,
      getComputedStyle(e.querySelector('.pdot')).backgroundColor])""")
    assert sorted(c[0] for c in cards) == sorted(want) and all(a == b for a, b in cards), f"cards {cards}, colours {want}"
    # colours are a board setting before any game is chosen too; the phone and the card follow
    board.click("#settings-button")
    board.wait_for_selector(".player-colors")
    assert board.locator(".game-settings").count() == 0
    board.locator(".player-colors .row").nth(0).locator(".swatch").nth(6).click()  # Klaus: orange (D-147)
    orange = rgb(hexes[6])
    decks[0].wait_for_function("(c) => getComputedStyle(document.querySelector('.who .badge')).backgroundColor === c", arg=orange, timeout=5000)
    board.wait_for_function("(c) => [...document.querySelectorAll('#seats .seat.taken')].some((e) => getComputedStyle(e).borderTopColor === c)", arg=orange, timeout=5000)
    shot(board, "settings-colours-lobby")
    board.click("[data-close-overlay]")
    shot(board, "lobby-colours")
    # The settings stay put while the table changes around them: a state change they do not show leaves the panel as it
    # is (it used to be rebuilt on every state, losing its scroll position), and Escape closes them (D-122).
    board.click("#settings-button")
    board.wait_for_selector(".overlay.settings .panel")
    board.evaluate("document.querySelector('.overlay.settings .panel').__mark = 1")
    api("POST", "/face", {"edge": "west"})
    board.wait_for_function("document.querySelector('.overlay.settings .panel').style.transform.includes('90deg')", timeout=5000)
    assert board.evaluate("document.querySelector('.overlay.settings .panel').__mark") == 1, "the settings panel was rebuilt"
    api("POST", "/face", {"edge": "south"})
    board.keyboard.press("Escape")
    board.wait_for_selector(".overlay.settings", state="detached")
    pick_game(board, "roulette")
    board.wait_for_selector(".dialog.form")
    # D-252: a number in the window that chooses a game is typed on the board's number pad, which faces the way the
    # window does; it takes no number out of range (D-146 told so only after OK), and a keyboard types into it too.
    board.click(".dialog [name=rounds]")
    pad = board.locator(".overlay.number-pad")
    pad.wait_for()
    turned = (pad.locator(".panel").evaluate("e => e.style.transform"), board.locator(".dialog.form").evaluate("e => e.style.transform"))
    assert turned[0] == turned[1], f"the pad faces another way than its window: {turned}"
    assert "1 to 50" in pad.inner_text(), pad.inner_text()
    pad.locator("[data-clear]").click()
    board.keyboard.type("51")
    assert pad.locator("[data-enter]").is_disabled(), "Enter with 51 of at most 50"
    shot(board, "settings-out-of-range")
    pad.locator("[data-clear]").click()
    for k in "4":
        pad.locator(f"[data-key='{k}']").click()
    pad.locator("[data-enter]").click()
    pad.wait_for(state="detached")
    assert board.input_value(".dialog [name=rounds]") == "4", board.input_value(".dialog [name=rounds]")
    shot(board, "settings-dialog")
    board.click(".dialog [data-x=yes]")
    time.sleep(0.5)
    st = api("GET", "/state")
    assert st["phase"] == "ready" and st["game"]["settings"]["rounds"] == 4, st
    seat = next(p["seat"] for p in st["players"] if p["id"] == ai)
    board.locator(".seat").nth(seat).click()
    # The selected card's thicker border is in the player's colour, not brass.
    colour = next(p["color"] for p in st["players"] if p["id"] == ai)
    board.wait_for_selector("#seats .seat.selected")
    ring = board.eval_on_selector("#seats .seat.selected", "(e) => getComputedStyle(e).boxShadow")
    assert rgb(colour) in ring and "4px" in ring, f"selected card: {ring}, colour {colour}"
    board.click(f"[data-config='{ai}']")
    board.wait_for_selector(".dialog.form select[name=style]")
    board.select_option(".dialog select[name=style]", "aggressive")
    shot(board, "ai-dialog")
    board.click(".dialog [data-x=yes]")
    time.sleep(0.5)
    st = api("GET", "/state")
    assert next(p for p in st["players"] if p["id"] == ai)["aiOptions"] == {"style": "aggressive"}
    shot(board, "ready-with-ai")
    # D-230: leaving the AI player's window deselects it; so does a tap beside the seats.
    assert board.locator("#seats .seat.selected").count() == 0, "the AI player stayed selected after its window"
    board.locator(".seat").nth(seat).click()
    board.wait_for_selector("#seats .seat.selected")
    board.locator("#center .main .eyebrow").first.click()
    time.sleep(0.2)
    assert board.locator("#seats .seat.selected").count() == 0, "a tap beside the seats kept the selection"
    # D-103: the AI player's window removes it (after a confirmation); Cancel there keeps it.
    board.locator(".seat").nth(seat).click()
    board.click(f"[data-config='{ai}']")
    board.wait_for_selector(".dialog.form [data-x=remove]")
    shot(board, "ai-dialog-remove")
    board.click(".dialog.form [data-x=remove]")
    board.wait_for_selector(".dialog:not(.form) [data-x=no]")
    board.click(".dialog [data-x=no]")
    time.sleep(0.3)
    assert any(p["id"] == ai for p in api("GET", "/state")["players"]), "cancelling must keep the AI player"
    board.locator(".seat").nth(seat).click()
    board.click(f"[data-config='{ai}']")
    board.click(".dialog.form [data-x=remove]")
    board.click(".dialog:not(.form) [data-x=yes]")
    wait(lambda: all(p["id"] != ai for p in api("GET", "/state")["players"]), 5, "the AI player to leave")
    # and before any game is chosen: the window opens (no options yet) and still removes
    api("POST", "/game/close")
    ai2 = api("POST", "/ai", {})["playerId"]
    time.sleep(0.4)
    seat2 = next(p["seat"] for p in api("GET", "/state")["players"] if p["id"] == ai2)
    board.locator(".seat").nth(seat2).click()
    board.click(f"[data-config='{ai2}']")
    board.wait_for_selector(".dialog.form >> text=Pick a game to choose how it plays.")
    board.click(".dialog.form [data-x=remove]")
    board.click(".dialog:not(.form) [data-x=yes]")
    wait(lambda: all(p["id"] != ai2 for p in api("GET", "/state")["players"]), 5, "the second AI player to leave")
    # The Up next chips: frame and dot in each player's colour, a ring until ready; offline, no dot and a red
    # background; tapping a chip offers Remove, online or not.
    api("POST", "/game/select", {"gameId": "roulette", "settings": {}})
    mira = join(browser, "Mira")
    board.wait_for_selector(".ready-list .chip.player:has-text('Mira')")
    for p in api("GET", "/state")["players"]:
        if p["seat"] is None:
            continue
        chip = board.locator(f".ready-list [data-chip='{p['id']}']")
        frame, dot = chip.evaluate("(e) => [getComputedStyle(e).borderTopColor, getComputedStyle(e.querySelector('.dot')).boxShadow]")
        assert frame == rgb(p["color"]) and rgb(p["color"]) in dot, f"{p['name']}: frame {frame}, dot {dot}, colour {p['color']}"
    mira.context.close()  # Mira's phone drops: her seat is held for the grace period
    board.wait_for_selector(".ready-list .chip.player.away:has-text('Mira')")
    away = board.locator(".ready-list .chip.player.away")
    assert away.locator(".dot").count() == 0, "an offline chip has no dot"
    assert away.evaluate("(e) => getComputedStyle(e).backgroundColor") == "rgba(210, 87, 74, 0.38)"
    shot(board, "ready-chips-offline")
    away.click()
    board.wait_for_selector(".dialog:has-text('Remove Mira?')")
    board.click(".dialog [data-x=yes]")
    wait(lambda: all(p["name"] != "Mira" for p in api("GET", "/state")["players"]), 5, "Mira to be removed")
    # Klaus is now the last player at the table, with a game chosen (D-118): the board says he can't be removed
    # instead of asking.
    klaus = next(p for p in api("GET", "/state")["players"] if p["name"] == "Klaus")
    board.click(f".ready-list [data-chip='{klaus['id']}']")
    board.wait_for_selector(".toast:has-text('Klaus is the last player at the table')")
    assert board.locator(".dialog").count() == 0, "no Remove dialog for the last player at the table"
    assert any(p["name"] == "Klaus" for p in api("GET", "/state")["players"])
    # An online player can be removed while someone else is at the table: Cancel keeps him.
    second = join(browser, "Lea")
    lea = next(p for p in api("GET", "/state")["players"] if p["name"] == "Lea")
    board.click(f".ready-list [data-chip='{lea['id']}']")
    board.click(".dialog [data-x=no]")
    time.sleep(0.3)
    assert any(p["name"] == "Lea" for p in api("GET", "/state")["players"])
    second.context.close()
    api("POST", "/game/close")
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
    # D-108: the terms open in the same sheet on the phone, with ✕ top right, and the page stays where it is
    url = d.url
    d.click("footer a[data-terms]")
    d.locator(".rules-modal .md >> text=entertainment").wait_for()
    assert "Terms of service" in d.inner_text(".rules-modal .rules-head h2")
    assert "entertainment" in d.inner_text(".rules-modal .rules-body")
    assert d.url == url, "the terms must not navigate away from the deck"
    close = d.locator(".rules-modal .rules-close").bounding_box()
    assert close["x"] + close["width"] > 320 - 40 and close["y"] < 80, f"the ✕ belongs top right: {close}"
    shot(d, "terms")
    d.locator(".rules-modal .rules-close").click()
    d.wait_for_selector(".rules-modal", state="detached")
    return [d]


@scenario
def tabs(browser, board):
    """D-123: during a game the phone's header is a slim tab bar (own tab, game tab), without the footer; the own tab
    has the name, Rules, everyone at the table and the terms; the game's tab comes forward when it is this player's turn."""
    api("POST", "/layout", {"seats": 2})
    ctx = browser.new_context(viewport={"width": 320, "height": 568}, device_scale_factor=2, has_touch=True)
    d = ctx.new_page()
    watch(d, "phone")
    join_deck(d, api("GET", "/join")["url"], "Klaus")
    assert d.locator("#top .who").count() == 1 and d.locator("footer").is_visible(), "the lobby keeps the full header and footer"
    assert d.locator(".tabs").count() == 0, "no tabs outside a game"
    api("POST", "/ai", {})
    api("POST", "/game/select", {"gameId": "pachisi", "settings": {"turnSeconds": 60, "tokens": 4}})
    d.click("#ready")
    wait(lambda: all(p["ready"] for p in api("GET", "/state")["players"] if p["seat"] is not None), 10, "everyone ready")
    api("POST", "/game/start")
    d.wait_for_selector(".tabs #tab-game[aria-selected=true]")
    d.wait_for_selector(".pc-who")
    assert d.locator("#top .who").count() == 0, "no full header during a game"
    assert not d.locator("footer").is_visible(), "no footer during a game"
    h = d.locator(".tabs").bounding_box()["height"]
    assert h <= 52, f"the tab bar is {h}px high"
    assert d.evaluate("() => document.documentElement.scrollWidth <= innerWidth"), "the tab bar makes the page wider"
    assert "Klaus" in d.inner_text("#tab-table") and "Pachisi" in d.inner_text("#tab-game")
    shot(d, "tabs-game")
    # the own tab: name, seat badge, Rules, everyone at the table, the terms; the game's deck stays mounted
    d.click("#tab-table")
    d.wait_for_selector(".table-tab .who h1 >> text=Klaus")
    assert d.locator(".table-tab .list .row").count() == 2
    assert d.locator(".table-tab .who .badge").count() == 1
    assert not d.locator("#body").is_visible() and d.locator("#body .pc-who").count() == 1, "the game's deck is hidden, not removed"
    shot(d, "tabs-table")
    d.locator(".table-tab [data-rules]").click()
    d.locator(".rules-modal .md h3").first.wait_for()
    d.keyboard.press("Escape")
    d.wait_for_selector(".rules-modal", state="detached")
    d.locator(".table-tab a[data-terms]").click()
    d.locator(".rules-modal .md >> text=entertainment").wait_for()
    d.locator(".rules-modal .rules-close").click()
    d.wait_for_selector(".rules-modal", state="detached")
    d.click("#tab-game")
    d.wait_for_selector("#body .pc-who", state="visible")
    # the game's tab comes forward when the turn comes back to this player
    me = next(p["seat"] for p in api("GET", "/state")["players"] if p["name"] == "Klaus")
    board_view = lambda: api("GET", "/game/board")["view"]
    for attempt in range(6):
        if d.locator("#tab-game[aria-selected=true]").count() == 0:
            d.click("#tab-game")
        wait(lambda: (lambda v: v["over"] or (v["turn"] == me and v["phase"] == "roll"))(board_view()), 15, "Klaus's turn to roll")
        if board_view()["over"]:
            break
        d.locator(".pc-roll:not([hidden])").click()
        d.wait_for_timeout(150)
        d.click("#tab-table")
        end = time.time() + 10
        came = False
        while time.time() < end:
            v = board_view()
            if v["turn"] == me and v["phase"] == "move" and board.locator(".pc-token.tap").count():
                board.locator(".pc-token.tap").first.click(force=True)
            if d.locator("#tab-game[aria-selected=true]").count():
                came = True
                break
            if v["turn"] == me and v["phase"] == "roll" and d.locator("#tab-table[aria-selected=true]").count():
                break  # the turn came back before the tab was opened: try again
            time.sleep(0.2)
        if came:
            break
    else:
        raise AssertionError("the game's tab did not come forward on Klaus's turn")
    shot(d, "tabs-turn")
    api("POST", "/game/end", {})
    d.wait_for_selector("#top .who")
    assert d.locator(".tabs").count() == 0 and d.locator("footer").is_visible(), "the full header and footer come back after the game"
    return [d]


@scenario
def pages(browser, board):
    """D-228: every game tile in the lobby is as tall as the tallest of all games, so paging through the games doesn't
    move the pager; again after a player sits down (the tiles' hints change, so the tiles are measured again)."""
    def walk(label):
        board.wait_for_selector(".pager")
        while board.locator(".pager button[data-page='-1']:not([disabled])").count():
            board.click(".pager button[data-page='-1']")
        seen = []
        while True:
            board.wait_for_timeout(150)
            heights = board.evaluate("() => [...document.querySelectorAll('.games .tile')].map((t) => t.offsetHeight)")
            pager = board.evaluate("() => document.querySelector('.pager').offsetTop")
            seen.append((heights, pager))
            if not board.locator(".pager button[data-page='1']:not([disabled])").count():
                break
            board.click(".pager button[data-page='1']")
        tiles = {h for hs, _ in seen for h in hs}
        pagers = {p for _, p in seen}
        assert len(seen) > 1, f"{label}: only one page of games"
        assert len(tiles) == 1, f"{label}: tiles of different heights {sorted(tiles)}"
        assert len(pagers) == 1, f"{label}: the pager moves between pages ({sorted(pagers)})"
        return tiles.pop()
    walk("empty table")
    shot(board, "pages")
    d = join(browser, "Klaus")
    board.wait_for_timeout(400)
    walk("a player at the table")
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
    try:
        main()
    except Exception as e:
        # On GitHub, an annotation carries the reason to the PR page; the job log itself may be out of reach.
        if os.environ.get("GITHUB_ACTIONS"):
            print(f"::error file=scripts/e2e/play.py::{GAME}: {type(e).__name__}: {str(e)[:900]}".replace("\n", " "))
        raise
