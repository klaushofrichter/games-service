"""Browser end-to-end check of remote play (phase 1c): the local board creates an invite, a second
browser opens the invite page, joins by name, and gets the board and its private deck over a WebRTC
data channel to the table. Also checks the board-control switch and reconnecting after a reload.
  python3 scripts/e2e/remote.py out/
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright
from common import call, errors, join_deck, pick_game, start_cloud, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
ADMIN = "admin-token-for-e2e-0001"
CLOUD, TABLE = "http://127.0.0.1:8095", "http://127.0.0.1:8096"

cloud = start_cloud(8095, ADMIN_TOKEN=ADMIN, PUBLIC_URL=CLOUD, ICE_SERVERS="[]")
host = start_table(8096, PUBLIC_URL=TABLE, TABLE_KEY="k", TABLE_NAME="Living room", CLOUD_URL=CLOUD)


def state():
    return call(TABLE, "GET", "/api/v1/state", headers={"x-table-key": "k"})


try:
    code = wait(lambda: state()["cloud"].get("pairingCode"), 15, "the pairing code")
    call(CLOUD, "POST", f"/admin/api/tables/pair/{code}", {}, {"authorization": f"Bearer {ADMIN}"})
    wait(lambda: state()["cloud"]["status"] == "online")
    time.sleep(1.0)  # signaling socket opens right after

    with sync_playwright() as p:
        # Chromium hides host candidates behind mDNS names by default; the table's WebRTC stack
        # resolves real addresses only, and the test has no STUN server.
        b = p.chromium.launch(args=["--disable-features=WebRtcHideLocalIpsWithMdns"])
        board = b.new_page(viewport={"width": 1600, "height": 900})
        watch(board, "local board")
        board.goto(TABLE + "/board/")
        board.wait_for_selector("text=Pick a game")
        board.click("button[data-invite]")
        board.wait_for_selector(".invite-body .code")
        invite = board.inner_text(".invite-body .code").strip()
        assert board.inner_html(".invite-body .qr").startswith("<svg"), "invite QR missing"
        # the invite link has a copy button that puts exactly that link on the clipboard (D-094)
        board.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=TABLE)
        board.click(".invite-body button[data-copy]")
        board.wait_for_selector(".invite-body button.copy.done")
        assert board.evaluate("() => navigator.clipboard.readText()") == board.inner_text(".invite-body .url").strip()
        board.screenshot(path=os.path.join(OUT, "remote-invite-dialog.png"))

        remote_ctx = b.new_context(viewport={"width": 1440, "height": 900})
        remote = remote_ctx.new_page()
        watch(remote, "remote")
        remote.goto(f"{CLOUD}/i/{invite}")
        remote.fill("#join input[name=name]", "Rita")
        remote.click("#join button[type=submit]")
        remote.wait_for_selector("#play:not([hidden])", timeout=30000)
        deck = remote.frame_locator("#deck")
        rboard = remote.frame_locator("#board")
        deck.locator("text=Rita").first.wait_for(timeout=20000)
        rboard.locator("text=Pick a game").wait_for(timeout=20000)
        assert rboard.locator("aside.join").count() == 0, "remote board must not show the local join code"
        assert rboard.locator("button[data-sim]").count() == 0, "remote board must not offer simulations"
        players = wait(lambda: [x for x in state()["players"] if x["name"] == "Rita"])
        assert players[0]["location"] == "remote" and players[0]["seat"] is not None, players
        board.wait_for_selector(".invite-body >> text=1 of 4 remote seats in use")
        remote.wait_for_timeout(600)
        remote.screenshot(path=os.path.join(OUT, "remote-player.png"))

        # D-095: the deck window sits top right and is as tall as its content, so it has no scrollbar when the
        # window has room; in a short window it stops at the window and scrolls.
        FIT = """() => { const w = document.getElementById('deck-wrap').getBoundingClientRect();
          const d = document.getElementById('deck').contentDocument.scrollingElement;
          return { top: w.top, bottom: w.bottom, inner: innerHeight, scrolls: d.scrollHeight > d.clientHeight + 1 }; }"""
        f = remote.evaluate(FIT)
        assert abs(f["top"] - 16) < 2, f
        assert f["bottom"] < f["inner"] - 16 - 40, f"lobby deck should be shorter than the window: {f}"
        assert not f["scrolls"], f"deck scrolls although the window has room: {f}"
        remote.set_viewport_size({"width": 1440, "height": 360})
        remote.wait_for_timeout(400)
        f = remote.evaluate(FIT)
        assert abs(f["top"] - 16) < 2 and abs(f["bottom"] - (f["inner"] - 16)) < 2, f"short window: deck should fill it: {f}"
        assert f["scrolls"], f"short window: the deck needs its scrollbar: {f}"
        remote.set_viewport_size({"width": 1440, "height": 900})
        remote.wait_for_timeout(300)

        # the remote board turns so Rita's own seat is at the bottom of her screen
        rita = players[0]
        call(TABLE, "POST", "/api/v1/seats/move", {"playerId": rita["id"], "seat": 2}, {"x-table-key": "k"})  # a north seat
        bframe = remote.frame(url=re.compile(r".*/board/.*"))
        wait(lambda: "rotate(-180deg)" in bframe.evaluate("() => document.getElementById('surface').style.transform"), 10)
        assert state()["frontEdge"] == "south", "turning the remote view must not turn the table"
        rboard.locator("text=Pick a game").wait_for()
        remote.wait_for_timeout(500)
        remote.screenshot(path=os.path.join(OUT, "remote-north-seat.png"))
        assert rboard.locator("#corners button[data-face]").count() == 0, "remote boards don't turn the table"
        assert not rboard.locator("#settings-button").is_visible(), "settings stay with the table (D-088)"
        assert not rboard.locator("#view-button").is_visible(), "the full-width view is only for east and west seats (D-101)"

        # remote board control: change the layout from the remote board, then the table switches control off
        rboard.locator("button[data-layout='6']").click()
        wait(lambda: state()["layout"] == 6)
        board.uncheck(".invite input[name=control]")
        wait(lambda: not state()["remote"]["boardControl"])
        rboard.locator("text=view only").wait_for(timeout=10000)
        rboard.locator("button[data-layout='4']").click()
        rboard.locator(".toast").wait_for(timeout=5000)
        assert state()["layout"] == 6
        remote.screenshot(path=os.path.join(OUT, "remote-view-only.png"))
        board.check(".invite input[name=control]")
        board.click(".invite button[data-x=close]")

        # reload: the session reconnects and the deck resumes the same player
        remote.reload()
        remote.wait_for_selector("#play:not([hidden])", timeout=30000)
        remote.frame_locator("#deck").locator("text=Rita").first.wait_for(timeout=20000)
        time.sleep(1.0)
        ritas = [x for x in state()["players"] if x["name"] == "Rita"]
        assert len(ritas) == 1 and ritas[0]["connected"], state()["players"]

        # a sideways seat (east): the remote surface turns a quarter and still fits the frame
        call(TABLE, "POST", "/api/v1/layout", {"seats": 8}, {"x-table-key": "k"})
        rita_id = [x for x in state()["players"] if x["name"] == "Rita"][0]["id"]
        call(TABLE, "POST", "/api/v1/seats/move", {"playerId": rita_id, "seat": 6}, {"x-table-key": "k"})
        bframe = remote.frame(url=re.compile(r".*/board/.*"))
        wait(lambda: "rotate(90deg)" in bframe.evaluate("() => document.getElementById('surface').style.transform"), 10)
        box = bframe.evaluate("() => { const r = document.getElementById('surface').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom, innerWidth, innerHeight]; }")
        assert box[0] >= -1 and box[1] >= -1 and box[2] <= box[4] + 1 and box[3] <= box[5] + 1, f"sideways board overflows its frame: {box}"
        remote.wait_for_timeout(500)
        remote.screenshot(path=os.path.join(OUT, "remote-east-seat.png"))
        # on a side seat the remote player may put the board upright to use the full width (D-101), and back
        view = rboard.locator("#view-button")
        assert view.is_visible() and "full width" in view.inner_text(), "east seat: the full-width button is missing"
        view.click()
        wait(lambda: "rotate(0deg)" in bframe.evaluate("() => document.getElementById('surface').style.transform"), 5)
        box = bframe.evaluate("() => { const r = document.getElementById('surface').getBoundingClientRect(); return [r.right - r.left, innerWidth]; }")
        assert box[0] >= box[1] - 2, f"the upright board should use the full width: {box}"
        assert "bottom" in view.inner_text()
        assert state()["frontEdge"] == "south", "the remote view choice must not turn the table"
        remote.wait_for_timeout(400)
        remote.screenshot(path=os.path.join(OUT, "remote-east-seat-full-width.png"))
        view.click()
        wait(lambda: "rotate(90deg)" in bframe.evaluate("() => document.getElementById('surface').style.transform"), 5)

        # a real game: Ana at the table, Rita remote, Pachisi; Rita plays from her deck in the invite page
        call(TABLE, "POST", "/api/v1/layout", {"seats": 4}, {"x-table-key": "k"})
        local = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True).new_page()
        watch(local, "Ana")
        join_deck(local, call(TABLE, "GET", "/api/v1/join", headers={"x-table-key": "k"})["url"], "Ana")
        pick_game(rboard, "pachisi")  # the remote board picks the game
        rboard.locator(".dialog button.primary").click()          # settings dialog: defaults
        wait(lambda: state()["phase"] == "ready")
        local.click("#ready")
        deck = remote.frame_locator("#deck")
        deck.locator("#ready").click()
        wait(lambda: all(p["ready"] for p in state()["players"] if p["kind"] == "human"))
        rboard.locator("button[data-start]").click()                # and starts it
        wait(lambda: state()["phase"] == "active")
        seats = {p["seat"]: p["name"] for p in state()["players"]}
        moves = {"Ana": 0, "Rita": 0}
        for _ in range(120):
            v = call(TABLE, "GET", "/api/v1/game/board", headers={"x-table-key": "k"})["view"]
            if v["over"] or (moves["Rita"] >= 4 and moves["Ana"] >= 4):
                break
            who = seats.get(v["turn"])
            page = deck if who == "Rita" else local
            if v["phase"] == "roll":
                page.locator(".pc-roll:not([hidden])").click(timeout=5000)
            else:
                page.locator("button[data-token]").first.click(timeout=5000)
            moves[who] += 1
            time.sleep(0.3)
        assert moves["Rita"] >= 4, moves
        rboard.locator(".pc-wrap").wait_for(timeout=5000)
        remote.wait_for_timeout(600)
        remote.screenshot(path=os.path.join(OUT, "remote-pachisi.png"))
        b.close()
finally:
    host.terminate()
    cloud.terminate()

# the remote page deliberately triggers one 403 (control switched off)
errors = [e for e in errors if "status of 403" not in e]
if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("ok: remote play")
