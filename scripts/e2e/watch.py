"""Browser check of remote watchers (D-168): the board invites a watcher ("Watch only"), the watcher's page shows the
board without a deck, the board shows an eye with their number; during a game a seat is exchanged for the watcher, whose
page then opens a deck and plays; exchanged back for an AI player they watch again; removed, their page says so.
A cloud service and a Table Host of their own (ports 8197/8198).
  python3 scripts/e2e/watch.py out/
"""
import os, sys, time
from playwright.sync_api import sync_playwright
from common import call, errors, join_deck, start_cloud, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
ADMIN = "admin-token-for-e2e-0001"
CLOUD, TABLE = "http://127.0.0.1:8197", "http://127.0.0.1:8198"
cloud = start_cloud(8197, ADMIN_TOKEN=ADMIN, PUBLIC_URL=CLOUD, ICE_SERVERS="[]")
host = start_table(8198, PUBLIC_URL=TABLE, TABLE_KEY="k", CLOUD_URL=CLOUD, AI_DELAY_MS="300")


def api(m, p, b=None):
    return call(TABLE, m, "/api/v1" + p, b, {"x-table-key": "k"})


def players():
    return {p["name"]: p for p in api("GET", "/state")["players"]}


try:
    code = wait(lambda: api("GET", "/state")["cloud"].get("pairingCode"), 15, "the pairing code")
    call(CLOUD, "POST", f"/admin/api/tables/pair/{code}", {}, {"authorization": f"Bearer {ADMIN}"})
    wait(lambda: api("GET", "/state")["cloud"]["status"] == "online")
    time.sleep(1.0)
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--disable-features=WebRtcHideLocalIpsWithMdns"])
        board = b.new_page(viewport={"width": 1920, "height": 1080})
        watch(board, "board")
        board.goto(TABLE + "/board/")
        ann = b.new_page(viewport={"width": 390, "height": 844})
        join_deck(ann, api("GET", "/join")["url"], "Ann")
        api("POST", "/ai", {})
        api("POST", "/game/select", {"gameId": "coin-flip", "settings": {"rounds": 20, "roundSeconds": 0}})
        ann.click("#ready")
        wait(lambda: all(x["ready"] for x in players().values()), 10, "everyone ready")
        api("POST", "/game/start", {})
        ann.wait_for_selector("[data-guess=heads]")

        # Invite a watcher: during a game the seats are full, so the lobby's button invites a watcher.
        board.click("#lobby-button")
        board.click("button[data-invite=watch]")
        board.wait_for_selector(".panel.invite input[name=watch]:checked")
        link = board.inner_text(".invite-body .url").strip()
        assert "watch=1" in link, link
        board.screenshot(path=os.path.join(OUT, "watch-invite.png"))

        wctx = b.new_context(viewport={"width": 1440, "height": 900})
        wanda = wctx.new_page()
        watch(wanda, "watcher")
        wanda.goto(link)
        assert "Watch" in wanda.inner_text("#title")
        wanda.fill("#join input[name=name]", "Wanda")
        wanda.click("#join button[type=submit]")
        wanda.wait_for_selector("#play:not([hidden])", timeout=30000)
        wanda.wait_for_selector("#play.watching #watch-note:not([hidden])", timeout=20000)
        wanda.frame_locator("#board").locator("#game-layer:not([hidden])").wait_for(timeout=20000)
        # the board's invite dialog closed by itself when Wanda came; the eye shows one watcher
        board.wait_for_selector(".panel.invite", state="detached", timeout=10000)
        board.wait_for_selector("#watchers-button:not([hidden])")
        assert board.inner_text("#watchers-button .n").strip() == "1"
        board.click(".overlay [data-close-overlay]")  # back to the game from the lobby
        wanda.screenshot(path=os.path.join(OUT, "watch-watcher.png"))
        board.screenshot(path=os.path.join(OUT, "watch-board.png"))
        board.click("#watchers-button")
        board.wait_for_selector(".overlay.watchers >> text=Wanda")
        board.screenshot(path=os.path.join(OUT, "watch-list.png"))
        board.click(".overlay.watchers [data-close-overlay]")

        # D-221: Wanda's own eye window has her name to change and Fullscreen (a watcher has no settings), and says the
        # table's board lets her play, not "Settings".
        wb = wanda.frame_locator("#board")
        wb.locator("#watchers-button").click()
        wb.locator(".overlay.watchers >> text=Your name").wait_for(timeout=5000)
        note = wb.locator(".overlay.watchers p.faint").inner_text()
        assert "ask the table" in note and "Settings" not in note, note
        wb.locator(".overlay.watchers [data-fs]").click()
        wb.locator(".overlay.watchers [data-fs]:has-text('Leave fullscreen')").wait_for(timeout=5000)
        wanda.screenshot(path=os.path.join(OUT, "watch-own-window.png"))
        wb.locator(".overlay.watchers [data-fs]").click()
        wb.locator(".overlay.watchers [data-fs]:has-text('Fullscreen')").wait_for(timeout=5000)
        for name in ("Wendy", "Wanda"):
            wb.locator(".overlay.watchers [data-watcher-name]").click()
            wb.locator(".overlay.name-pad input").fill(name)
            wb.locator(".overlay.name-pad [data-save]").click()
            wait(lambda: [w["name"] for w in api("GET", "/state")["watchers"]] == [name], 10, f"the watcher named {name}")
            wb.locator(f".overlay.watchers >> text=Your name: {name}").wait_for(timeout=5000)
        board.click("#watchers-button")
        board.wait_for_selector(".overlay.watchers >> text=Wanda")
        assert board.locator(".overlay.watchers >> text=Your name").count() == 0, "the table's board shows a watcher's own rows"
        board.click(".overlay.watchers [data-close-overlay]")
        wb.locator(".overlay.watchers [data-close-overlay]").click()

        # Exchange the AI player for Wanda: her page opens a deck, and she plays.
        ai = next(x for x in players().values() if x["kind"] == "ai")
        board.click("#settings-button")
        board.click(f".overlay.settings [data-exchange='{ai['id']}']")
        board.click(".overlay.exchange [data-ex=watcher]")
        wanda.wait_for_selector("#play:not(.watching)", timeout=20000)
        deck = wanda.frame_locator("#deck")
        deck.locator("[data-guess=heads]").wait_for(timeout=20000)
        wait(lambda: players().get("Wanda", {}).get("seat") == ai["seat"], 10, "Wanda in the AI's seat")
        board.wait_for_selector(".overlay.exchange", state="detached", timeout=10000)
        assert board.locator("#watchers-button").is_hidden()
        wanda.screenshot(path=os.path.join(OUT, "watch-playing.png"))

        # Back to an AI player: Wanda watches again.
        board.click(f".overlay.settings [data-exchange='{players()['Wanda']['id']}']")
        board.click(".overlay.exchange [data-ex=ai]")
        board.click(".dialog-backdrop [data-x=yes]")
        wanda.wait_for_selector("#play.watching #watch-note:not([hidden])", timeout=20000)
        board.wait_for_selector("#watchers-button:not([hidden])")

        # Removed: the watcher's page says so and stays disconnected.
        board.click(".overlay.settings [data-watcher-remove]")
        board.click(".dialog-backdrop [data-x=yes]")
        wanda.wait_for_selector("#wait:not([hidden]) >> text=You were removed", timeout=15000)
        board.wait_for_selector("#watchers-button", state="hidden")
        wanda.screenshot(path=os.path.join(OUT, "watch-removed.png"))

        # Settings › Joining also invites someone remote (D-169): during a game, as a watcher.
        board.wait_for_selector(".overlay.settings button[data-invite=watch]:has-text('Invite a watcher')")
        assert "Someone remote, as a watcher" in board.inner_text(".overlay.settings")
        board.screenshot(path=os.path.join(OUT, "watch-settings-joining.png"))
        board.click(".overlay.settings button[data-invite=watch]")
        board.wait_for_selector(".panel.invite input[name=watch]:checked")
        board.click(".panel.invite [data-x=close]")
finally:
    host.terminate()
    cloud.terminate()
if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("watch: ok")
