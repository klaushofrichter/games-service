"""Browser end-to-end check of game logs (D-116).
  python3 scripts/e2e/logs.py out/

A simulation started from the board's dialog says how its games ended and reaches the console; a game played with a
phone reaches the console with its players and end; a game the table stops in the middle of reaches it after the
table's next start, marked interrupted. The console's filters narrow the list, and a downloaded zip has its README.
Starts its own cloud service and table host.
"""
import io, json, os, sys, tempfile, urllib.request, zipfile
from playwright.sync_api import sync_playwright
from common import api, call, errors, join_deck, start_cloud, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
CLOUD = "http://127.0.0.1:8111"
TABLE = "http://127.0.0.1:8112"
ADMIN = "admin-token-for-e2e-logs"
TABLE_DATA = tempfile.mkdtemp(prefix="e2e-logs-table-")
AUTH = {"authorization": f"Bearer {ADMIN}"}


def table_up():
    return start_table(8112, TABLE_KEY="k", TABLE_NAME="Den", CLOUD_URL=CLOUD, DATA_DIR=TABLE_DATA, PUBLIC_URL=TABLE)


def state():
    return api("GET", "/state", base=TABLE, key="k")


def service_logs():
    return call(CLOUD, "GET", "/admin/api/logs", headers=AUTH)


cloud = start_cloud(8111, PUBLIC_URL=CLOUD, ADMIN_TOKEN=ADMIN, DATA_DIR=tempfile.mkdtemp(prefix="e2e-logs-cloud-"))
host = table_up()
try:
    code = wait(lambda: state()["cloud"].get("pairingCode"), 20, "the pairing code")
    call(CLOUD, "POST", f"/admin/api/tables/pair/{code}", headers=AUTH)
    wait(lambda: state()["cloud"]["status"] == "online", 20, "the table to be online")
    with sync_playwright() as p:
        br = p.chromium.launch()
        board = br.new_page(viewport={"width": 1920, "height": 1080})
        watch(board, "board")
        board.goto(TABLE + "/board/")
        board.wait_for_selector("#tools-button:not([hidden])")

        # 1. A simulation from the board's dialog (under Advanced, D-128): the dialog says how the games ended.
        board.click("#tools-button")
        board.click("button[data-adv=sim]")
        board.select_option("select[name=game]", "coin-flip")
        # Numbers on the board's number pad (D-252).
        for name, value in [("players", "2"), ("games", "3")]:
            board.click(f"input[name={name}]")
            board.locator(".overlay.number-pad [data-clear]").click()
            board.keyboard.type(value)
            board.keyboard.press("Enter")
            board.wait_for_selector(".overlay.number-pad", state="detached")
            assert board.input_value(f"input[name={name}]") == value
        board.click("button[data-x=run]")
        board.click(".dialog button[data-x=yes]")
        board.wait_for_selector(".out:has-text('3 finished')")
        assert "queued for upload" in board.inner_text(".out"), board.inner_text(".out")
        board.screenshot(path=os.path.join(OUT, "logs-simulation-dialog.png"))
        board.click("button[data-x=close]")
        wait(lambda: any(l["simulation"] for l in service_logs()), 20, "the simulation's log at the service")

        # 2. A game with a phone: Ann and an AI, one round.
        phone = br.new_page(viewport={"width": 390, "height": 844})
        watch(phone, "phone")
        join_deck(phone, api("GET", "/join", base=TABLE, key="k")["url"], "Ann")
        api("POST", "/ai", {}, base=TABLE, key="k")
        api("POST", "/game/select", {"gameId": "coin-flip", "settings": {"rounds": 1, "roundSeconds": 0}}, base=TABLE, key="k")
        phone.click("#ready")
        wait(lambda: all(pl["ready"] for pl in state()["players"]), 10, "everyone ready")
        api("POST", "/game/start", {}, base=TABLE, key="k")
        phone.wait_for_selector("[data-guess=heads]:not([disabled])")
        phone.click("[data-guess=heads]")
        played = wait(lambda: next((l for l in service_logs() if not l["simulation"]), None), 30, "the game's log at the service")
        assert played["endReason"] == "finished" and [pl["name"] for pl in played["players"]][0] == "Ann", played

        # 3. A game the table stops in the middle of: its log arrives after the next start, marked interrupted.
        api("POST", "/game/close", {}, base=TABLE, key="k")
        api("POST", "/game/select", {"gameId": "coin-flip", "settings": {"rounds": 5, "roundSeconds": 0}}, base=TABLE, key="k")
        phone.click("#ready")
        wait(lambda: all(pl["ready"] for pl in state()["players"]), 10, "everyone ready again")
        api("POST", "/game/start", {}, base=TABLE, key="k")
        phone.wait_for_selector("[data-guess=tails]:not([disabled])")
        phone.click("[data-guess=tails]")
        wait(lambda: os.listdir(os.path.join(TABLE_DATA, "logs", "running")), 10, "the running log on disk")
        phone.close()
        board.close()  # their sockets would only report the lost table
        host.kill()  # no shutdown: like pulling the plug
        host.wait()
        host = table_up()
        stopped = wait(lambda: next((l for l in service_logs() if l.get("endReason") == "interrupted"), None), 30, "the interrupted game's log")

        # 4. The console: all three, with their metadata; the filters narrow the list; a download has its README.
        console = br.new_page(viewport={"width": 1440, "height": 1000})
        watch(console, "console", ignore=("status of 401",))
        console.goto(CLOUD + "/admin")
        console.fill("#token", ADMIN)
        console.click("#signin-form button")
        console.wait_for_selector(f"#logs [data-log='{stopped['id']}']")
        text = console.inner_text("#logs")
        for want in ("Coin Flip", "3 finished", "Ann", "finished", "interrupted", "Den"):
            assert want in text, f"the console's logs should show {want!r}: {text}"
        console.select_option("#lf-kind", "1")
        console.wait_for_selector("#logs-count:has-text('1 of 3 logs')")
        assert "interrupted" not in console.inner_text("#logs")
        console.select_option("#lf-kind", "")
        console.fill("#lf-from", "2001-01-01")
        console.fill("#lf-to", "2001-01-02")
        console.wait_for_selector("#logs :text('No logs match these filters.')")
        console.fill("#lf-from", "")
        console.fill("#lf-to", "")
        console.wait_for_selector("#logs-count:has-text('3 logs')")
        console.screenshot(path=os.path.join(OUT, "logs-console.png"), full_page=True)

        with console.expect_download() as dl:
            console.click(f"button[data-log='{played['id']}']")
        z = zipfile.ZipFile(io.BytesIO(open(dl.value.path(), "rb").read()))
        assert sorted(z.namelist()) == ["README.md", "game-001.jsonl", "game-001.moves.jsonl", "game-001.state.json", "run.json"], z.namelist()  # the move list since D-120
        run = json.loads(z.read("run.json"))
        assert run["format"] == "gametable-log/2" and run["verify"]["ok"] == 1, run
        br.close()
    if errors:
        raise AssertionError("browser errors:\n" + "\n".join(errors))
    print("logs: ok")
finally:
    host.kill()
    cloud.kill()
