"""Browser check of Hold'em's board: Next hand (D-136) and where each seat's cards and bet lie (D-137).
  python3 scripts/e2e/next_hand.py out/

A cloud service (port 8106) and a Table Host (8107) of their own, so a remote player can join. Ann at the table (a
phone) and Rita remote (the invite page, over WebRTC) play Hold'em with a long result pause. After a fold:
- the table's board and Rita's board both show "Next hand · N s";
- the table switches board control for remote players off: Rita's button goes, the table's stays; on again, back;
- a tap on Rita's board starts hand 2 at once, a tap on the table's board hand 3, and the last hand says Finish.
Then, for 2, 4, 6 and 8 seats (north and south seats among them) with AI players, every seat's cards, its bet and the dealer button lie inside the felt
(the south player's cards used to sit on the rail and the bet off the table).
"""
import os, sys, time
from playwright.sync_api import sync_playwright
from common import call, errors, join_deck, start_cloud, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
ADMIN = "admin-token-for-e2e-0106"
CLOUD, TABLE = "http://127.0.0.1:8106", "http://127.0.0.1:8107"
KEY = {"x-table-key": "k"}

cloud = start_cloud(8106, ADMIN_TOKEN=ADMIN, PUBLIC_URL=CLOUD, ICE_SERVERS="[]")
host = start_table(8107, PUBLIC_URL=TABLE, TABLE_KEY="k", CLOUD_URL=CLOUD, AI_DELAY_MS="100")


def a(method, path, body=None):
    return call(TABLE, method, "/api/v1" + path, body, KEY)


def to_lobby():
    """End the game if it still runs (one that ended by itself shows its result), then back to the lobby."""
    if a("GET", "/state")["phase"] in ("active", "paused"):
        a("POST", "/game/end")
        wait(lambda: a("GET", "/state")["phase"] not in ("active", "paused"), 5, "the game to end")
    if a("GET", "/state")["phase"] != "idle":
        a("POST", "/game/close", {})


def view():
    return a("GET", "/game/board")["view"]


# Every hole-card pair, bet and the dealer button must lie inside the felt's stadium shape.
INSIDE = """() => {
  const felt = document.querySelector('.he-felt').getBoundingClientRect();
  const r = felt.height / 2, cy = felt.top + r;
  const inside = (x, y) => {
    const cx = Math.min(Math.max(x, felt.left + r), felt.right - r);
    return Math.hypot(x - cx, y - cy) <= r + 0.5;
  };
  const corners = (b) => [[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom]];
  const bad = [];
  const els = [...document.querySelectorAll('.he-hole .hc, .he-bet .he-chip, .he-dealer')];
  for (const e of els) {
    const b = e.getBoundingClientRect();
    if (!b.width) continue;
    if (!corners(b).every(([x, y]) => inside(x, y))) bad.push(e.className + ' @' + Math.round(b.left) + ',' + Math.round(b.top));
  }
  // nothing in the middle (shared cards, pot, message, Next hand) may cover a seat's cards
  const hit = (p, q) => p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom;
  const mid = [...document.querySelectorAll('.he-center .he-board, .he-center .he-pot, .he-center .he-msg, .he-center .he-next')]
    .filter((e) => !e.hidden && e.getBoundingClientRect().height).map((e) => [e.className, e.getBoundingClientRect()]);
  for (const h of document.querySelectorAll('.he-hole .hc'))
    for (const [c, r] of mid) if (hit(h.getBoundingClientRect(), r)) bad.push(c + ` covers a seat's cards`);
  return { n: els.length, bad };
}"""

# The hand counts' text, the north one's turn, where Lobby sits, and anything the counts cover.
CORNERS = """() => {
  const hit = (p, q) => p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom;
  const counts = [...document.querySelectorAll('.he-count')].filter((e) => !e.hidden);
  const lobby = document.getElementById('lobby-button');
  const others = [...document.querySelectorAll('.kit-plate, #lobby-button, #settings-button, #tools-button, #corners button')]
    .filter((e) => e.offsetParent && e.getBoundingClientRect().width);
  const bad = [];
  for (const c of counts) for (const o of others) if (hit(c.getBoundingClientRect(), o.getBoundingClientRect())) bad.push(c.className + ' covers ' + (o.id || o.className));
  const lb = lobby.getBoundingClientRect();
  return { texts: counts.map((e) => e.innerText.replace(/\\s+/g, '')), north: getComputedStyle(document.querySelector('.he-count-north')).transform,
    lobby: (lb.top < innerHeight / 2 ? 'top' : 'bottom') + '-' + (lb.left > innerWidth / 2 ? 'right' : 'left'), bad };
}"""

try:
    code = wait(lambda: a("GET", "/state")["cloud"].get("pairingCode"), 15, "the pairing code")
    call(CLOUD, "POST", f"/admin/api/tables/pair/{code}", {}, {"authorization": f"Bearer {ADMIN}"})
    wait(lambda: a("GET", "/state")["cloud"]["status"] == "online")
    time.sleep(1.0)

    with sync_playwright() as p:
        b = p.chromium.launch(args=["--disable-features=WebRtcHideLocalIpsWithMdns", "--autoplay-policy=no-user-gesture-required"])
        board = b.new_page(viewport={"width": 1920, "height": 1080})
        watch(board, "board")
        board.goto(TABLE + "/board/")
        board.wait_for_selector("text=Pick a game")
        ann = b.new_context(viewport={"width": 390, "height": 800}).new_page()
        watch(ann, "ann")
        join_deck(ann, a("GET", "/state")["joinUrl"], "Ann")

        board.click("button[data-invite]")
        board.wait_for_selector(".invite-body .code")
        invite = board.inner_text(".invite-body .code").strip()
        remote = b.new_context(viewport={"width": 1600, "height": 900}).new_page()
        watch(remote, "remote")
        remote.goto(f"{CLOUD}/i/{invite}")
        remote.fill("#join input[name=name]", "Rita")
        remote.click("#join button[type=submit]")
        remote.wait_for_selector("#play:not([hidden])", timeout=30000)
        rdeck, rboard = remote.frame_locator("#deck"), remote.frame_locator("#board")
        rdeck.locator("text=Rita").first.wait_for(timeout=20000)
        board.wait_for_selector(".overlay .invite", state="detached", timeout=10000)  # closes once Rita joins (D-164)

        a("POST", "/game/select", {"gameId": "holdem", "settings": {"hands": 3, "turnSeconds": 0, "showdownSeconds": 30}})
        # The board's audio running before the game starts: a headless browser without a sound device can take a while to
        # start it, and a sound asked for meanwhile is dropped (the board kit waits a second at most).
        took = board.evaluate("""async () => { const t0 = performance.now(); const { audio } = await import('/shared/board-kit.js');
          for (let k = 0; k < 100; k++) { const c = audio(); if (c && c.state === 'running') return Math.round(performance.now() - t0);
            await new Promise((r) => setTimeout(r, 100)); } return -1; }""")
        print(f"board audio running after {took} ms")
        assert took >= 0, "the board's audio never started"
        # every sound the board plays (it keeps only the last 50)
        board.evaluate("""() => { const all = (window.allSounds = []); const list = (window.gameTableSounds = []);
          const push = list.push; list.push = function (...a) { all.push(...a); return push.apply(this, a); }; }""")
        ann.click("#ready")
        rdeck.locator("#ready").click()
        wait(lambda: all(x.get("ready") for x in a("GET", "/state")["players"]), 10, "both ready")
        a("POST", "/game/start")
        # the board shows hand 1 before anyone acts (on a slow machine its module may still be loading)
        board.locator(".he-hole .hc").first.wait_for(timeout=15000)
        seat = {x["seat"]: x["name"] for x in a("GET", "/state")["players"]}

        def act(name):
            v = wait(lambda: (lambda v: v if v["phase"] == "betting" and v["toAct"] is not None else None)(view()), 10, "a turn")
            d = ann if seat[v["toAct"]] == "Ann" else rdeck
            d.locator(f".he-actions:not([hidden]) .he-{name}").click(timeout=10000)
            wait(lambda: view()["lastAction"] and view()["lastAction"]["seat"] == v["toAct"], 10, f"the {name}")

        def fold():
            v = wait(lambda: (lambda v: v if v["phase"] == "betting" and v["toAct"] is not None else None)(view()), 10, "a turn")
            d = ann if seat[v["toAct"]] == "Ann" else rdeck
            d.locator(".he-actions:not([hidden]) .he-fold").click(timeout=10000)
            wait(lambda: view()["phase"] == "handOver", 10, "the result")

        # Hand 1: the result shows a Next hand button on both boards.
        fold()
        nxt, rnxt = board.locator(".he-next"), rboard.locator(".he-next")
        nxt.wait_for(state="visible", timeout=5000)
        rnxt.wait_for(state="visible", timeout=10000)
        label = nxt.inner_text()
        assert label.startswith("Next hand · ") and label.endswith(" s"), label
        board.wait_for_timeout(700)
        r = board.evaluate(INSIDE)
        assert not r["bad"], f"the result: {r['bad']}"
        board.screenshot(path=os.path.join(OUT, "holdem-next-hand.png"))
        remote.screenshot(path=os.path.join(OUT, "holdem-next-hand-remote.png"))

        # Board control off: only the table's board keeps the button; on again: back on Rita's board.
        a("POST", "/remote", {"boardControl": False})  # the invite window's checkbox
        rboard.locator(".he-next").wait_for(state="hidden", timeout=10000)
        assert nxt.is_visible(), "the table's board keeps Next hand without remote board control"
        a("POST", "/remote", {"boardControl": True})
        rnxt.wait_for(state="visible", timeout=10000)

        # A tap on Rita's board starts hand 2 at once; on the table's board, hand 3.
        rnxt.click()
        wait(lambda: view()["hand"] == 2 and view()["phase"] == "betting", 5, "hand 2 to start at once")
        nxt.wait_for(state="hidden", timeout=5000)
        fold()
        nxt.wait_for(state="visible", timeout=5000)
        nxt.click()
        wait(lambda: view()["hand"] == 3 and view()["phase"] == "betting", 5, "hand 3 to start at once")
        act("call")  # the small blind completes; the big blind checks: the flop comes
        act("call")
        wait(lambda: view()["street"] == "flop", 10, "the flop")
        act("raise")  # a bet on the flop (nobody can fold while checking is free)
        fold()
        nxt.wait_for(state="visible", timeout=5000)
        assert nxt.inner_text().startswith("Finish"), nxt.inner_text()
        nxt.click()
        wait(lambda: view()["over"], 5, "the game to end")
        # Sounds (they follow the table's sound setting, on by default): shuffle and deal for each hand after a skip,
        # a fold, and the pot going to the winner.
        board.wait_for_timeout(1500)
        played = board.evaluate("() => window.allSounds")
        print("sounds:", sorted(set(played)))
        for want in ("holdem-shuffle", "holdem-deal", "holdem-chips", "holdem-check", "holdem-street", "holdem-fold", "holdem-win"):
            assert want in played, f"no {want}: {played}"
        assert played.count("holdem-shuffle") == 3, f"a shuffle for each of the three hands, the first included (audio ran after {took} ms): {played}"
        to_lobby()

        # Cards, bets and the dealer button on the felt, for several layouts (Ann and Rita stay; AI fills the rest).
        covered = set()
        for seats in (2, 4, 6, 8):
            a("POST", "/layout", {"seats": seats})
            while len(a("GET", "/state")["players"]) < seats:
                a("POST", "/ai", {})
            a("POST", "/game/select", {"gameId": "holdem", "settings": {"hands": 2, "turnSeconds": 0, "showdownSeconds": 30}})
            for x in a("GET", "/state")["players"]:
                if x["name"] == "Ann" and not x.get("ready"):
                    ann.click("#ready")
                if x["name"] == "Rita" and not x.get("ready"):
                    rdeck.locator("#ready").click()
            wait(lambda: all(x.get("ready") for x in a("GET", "/state")["players"] if not x.get("ai")), 10, "humans ready")
            a("POST", "/game/start")
            wait(lambda: view()["phase"] == "betting", 10, "the deal")
            board.wait_for_timeout(900)  # the spots' transitions
            r = board.evaluate(INSIDE)
            board.screenshot(path=os.path.join(OUT, f"holdem-spots-{seats}.png"))
            # The hand count (upper left facing north, lower right facing south), clear of plates and buttons;
            # the Lobby button top right.
            c = board.evaluate(CORNERS)
            assert c["texts"] == ["PREFLOPHand1of21moretoplay"] * 2, c  # street, hand 1 of 2 (whitespace removed)
            assert board.locator(".he-street").inner_text() == "", "the street is in the corners, not the middle"
            assert c["north"].startswith("matrix(-1"), f"the upper-left count should face north: {c['north']}"
            assert c["lobby"] == "top-right", c
            assert not c["bad"], f"{seats} seats: {c['bad']}"
            assert r["n"] >= seats * 2, r
            assert not r["bad"], f"{seats} seats: off the felt: {r['bad']}"
            edges = {a("GET", "/state")["seatEdges"][x["seat"]] for x in a("GET", "/state")["players"]}
            print(f"{seats} seats: {r['n']} cards/chips/dealer on the felt; edges {sorted(edges)}")
            covered |= edges
            to_lobby()
        assert {"north", "south", "east", "west"} <= covered, covered
        # AI players bet, call and check, and the flop comes: their sounds too
        played = board.evaluate("() => window.allSounds")
        print("all sounds:", {n: played.count(n) for n in sorted(set(played))})
        assert "holdem-chips" in played, played
        b.close()
except BaseException as e:
    # One line GitHub shows as an annotation on the e2e check, so a failure is readable without the job log.
    import traceback
    where = traceback.extract_tb(e.__traceback__)[-1]
    here = [f for f in traceback.extract_tb(e.__traceback__) if f.filename.endswith("next_hand.py")]
    line = here[-1].lineno if here else where.lineno
    print(f"::error file=scripts/e2e/next_hand.py,line={line}::{type(e).__name__}: {str(e)[:900]}".replace("\n", " | "))
    raise
finally:
    host.terminate()
    cloud.terminate()
if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("ok: Next hand on the table's board and on remote boards with board control; cards, bets and dealer on the felt")
