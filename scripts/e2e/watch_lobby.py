"""Browser check of players and watchers in the lobby (D-168, D-170): a remote player who taps "Leave the game" keeps
watching (their page closes the deck), the board's eye offers "Let play" and their deck comes back; a reload keeps the
player; a watcher who closes the window disappears from the eye; a game started and left by the remote player keeps
their seat waiting while they watch, and an exchange for them as a watcher gives it back.
A cloud service and a Table Host of their own (ports 8187/8188).
  python3 scripts/e2e/watch_lobby.py out/
"""
import os, sys, time
from playwright.sync_api import sync_playwright
from common import call, errors, join_deck, start_cloud, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
ADMIN = "admin-token-for-e2e-0001"
CLOUD, TABLE = "http://127.0.0.1:8187", "http://127.0.0.1:8188"
cloud = start_cloud(8187, ADMIN_TOKEN=ADMIN, PUBLIC_URL=CLOUD, ICE_SERVERS="[]")
host = start_table(8188, PUBLIC_URL=TABLE, TABLE_KEY="k", CLOUD_URL=CLOUD, AI_DELAY_MS="300")


def api(m, p, b=None):
    return call(TABLE, m, "/api/v1" + p, b, {"x-table-key": "k"})


def state():
    return api("GET", "/state")


def players():
    return {p["name"]: p for p in state()["players"]}


def watchers():
    return [w["name"] for w in state()["watchers"]]


def open_invite(ctx, url, name):
    page = ctx.new_page()
    watch(page, name)
    page.goto(url)
    page.fill("#join input[name=name]", name)
    page.click("#join button[type=submit]")
    page.wait_for_selector("#play:not([hidden])", timeout=30000)
    return page


try:
    code = wait(lambda: state()["cloud"].get("pairingCode"), 15, "the pairing code")
    call(CLOUD, "POST", f"/admin/api/tables/pair/{code}", {}, {"authorization": f"Bearer {ADMIN}"})
    wait(lambda: state()["cloud"]["status"] == "online")
    time.sleep(1.0)
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--disable-features=WebRtcHideLocalIpsWithMdns"])
        board = b.new_page(viewport={"width": 1920, "height": 1080})
        watch(board, "board")
        board.goto(TABLE + "/board/")
        ann = b.new_page(viewport={"width": 390, "height": 844})
        join_deck(ann, api("GET", "/join")["url"], "Ann")
        api("POST", "/game/select", {"gameId": "coin-flip", "settings": {"rounds": 20, "roundSeconds": 0}})  # the Ready screen

        # Rita joins remotely as a player: her page shows the board and her deck.
        rctx = b.new_context(viewport={"width": 1440, "height": 900})
        rita = open_invite(rctx, api("POST", "/invites")["url"], "Rita")
        rdeck = rita.frame_locator("#deck")
        rdeck.locator("[data-leave]").wait_for(timeout=20000)
        assert rita.locator("#play.watching").count() == 0
        wait(lambda: "Rita" in players(), 10, "Rita at the table")

        # She leaves from her deck: her page keeps the board and closes the deck; the board's eye shows her.
        rdeck.locator("[data-leave]").click()
        assert "keep watching" in rdeck.locator("body").inner_text()
        rdeck.locator(".leave-confirm").click()
        rita.wait_for_selector("#play.watching #watch-note:not([hidden])", timeout=20000)
        wait(lambda: watchers() == ["Rita"] and "Rita" not in players(), 10, "Rita watching")
        board.wait_for_selector("#watchers-button:not([hidden])")
        rita.screenshot(path=os.path.join(OUT, "lobby-left-watching.png"))

        # Let play from the eye: her deck comes back, and she is a player again.
        board.click("#watchers-button")
        board.click(".overlay.watchers [data-watcher-play]")
        rita.wait_for_selector("#play:not(.watching)", timeout=20000)
        rdeck.locator("[data-leave]").wait_for(timeout=20000)
        wait(lambda: "Rita" in players() and watchers() == [], 10, "Rita playing again")
        board.wait_for_selector("#watchers-button", state="hidden")
        # a reload keeps her a player
        rita.reload()
        rita.wait_for_selector("#play:not([hidden]):not(.watching)", timeout=30000)
        rita.frame_locator("#deck").locator("[data-leave]").wait_for(timeout=20000)
        assert watchers() == [] and players()["Rita"]["location"] == "remote"

        # A watcher who closes the window is gone from the eye.
        wctx = b.new_context(viewport={"width": 1280, "height": 800})
        wanda = open_invite(wctx, api("POST", "/invites", {"watch": True})["url"], "Wanda")
        wanda.wait_for_selector("#play.watching", timeout=20000)
        wait(lambda: watchers() == ["Wanda"], 15, "Wanda watching")
        board.wait_for_selector("#watchers-button:not([hidden])")
        wctx.close()
        wait(lambda: watchers() == [], 60, "Wanda gone after closing her window")
        board.wait_for_selector("#watchers-button", state="hidden", timeout=10000)

        # In a game, Rita leaves: her seat waits, she watches; an exchange for her as a watcher gives it back.
        ann.click("#ready")
        rita.frame_locator("#deck").locator("#ready").click()
        wait(lambda: all(x["ready"] for x in players().values()), 10, "everyone ready")
        api("POST", "/game/start", {})
        rdeck = rita.frame_locator("#deck")
        rdeck.locator("[data-guess=heads]").wait_for(timeout=20000)
        seat = players()["Rita"]["seat"]
        rdeck.locator("#tab-table").click()
        rdeck.locator("[data-leave=game]").click()
        rdeck.locator(".leave-confirm").click()
        rita.wait_for_selector("#play.watching", timeout=20000)
        wait(lambda: watchers() == ["Rita"], 10, "Rita watching her waiting seat")
        board.click("#settings-button")
        board.click(f".overlay.settings [data-exchange='{players()['Rita']['id']}']")
        board.click(".overlay.exchange [data-ex=watcher]")
        rita.wait_for_selector("#play:not(.watching)", timeout=20000)
        rita.frame_locator("#deck").locator("[data-guess=heads]").wait_for(timeout=20000)
        wait(lambda: players().get("Rita", {}).get("seat") == seat and watchers() == [], 10, "Rita back in her seat")
        rita.screenshot(path=os.path.join(OUT, "lobby-back-in-seat.png"))
finally:
    host.terminate()
    cloud.terminate()
if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("watch-lobby: ok")
