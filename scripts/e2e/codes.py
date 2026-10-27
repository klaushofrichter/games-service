"""Browser end-to-end check of pre-approved access codes (D-113) and the service's persistent state (D-114).
  python3 scripts/e2e/codes.py out/

The console creates a code and shows it once; the table's board takes it on its keypad (the board has no keyboard)
and is approved without a pairing code; the service restarts on the same DATA_DIR and the table carries on; a second
table started with TABLE_CODE is refused because the code is in use and says so on its board; Edit, Release and
Delete work in the console. Starts its own cloud service and two table hosts.
"""
import os, re, sys, tempfile, urllib.request
from playwright.sync_api import sync_playwright
from common import api, call, errors, start_cloud, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
CLOUD = "http://127.0.0.1:8101"
TABLE_A, TABLE_B = "http://127.0.0.1:8102", "http://127.0.0.1:8103"
ADMIN = "admin-token-for-e2e-codes"
DATA = tempfile.mkdtemp(prefix="e2e-cloud-")


def cloud_up():
    return start_cloud(8101, PUBLIC_URL=CLOUD, ADMIN_TOKEN=ADMIN, DATA_DIR=DATA)


def state(base):
    return api("GET", "/state", base=base, key="k")


cloud = cloud_up()
a = start_table(8102, TABLE_KEY="k", TABLE_NAME="Living room", CLOUD_URL=CLOUD)
b_host = None
try:
    wait(lambda: state(TABLE_A)["cloud"].get("pairingCode"), 20, "table A's pairing code")
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={"width": 1440, "height": 1000})
        ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=CLOUD)
        console = ctx.new_page()
        watch(console, "console", ignore=("status of 401",))  # /admin/api/me before signing in (development mode)
        console.goto(CLOUD + "/admin")
        console.fill("#token", ADMIN)
        console.click("#signin-form button")
        console.wait_for_selector("#codes-section")
        console.wait_for_selector("#code-scope input[value=none]")

        # Create a code: shown once, with a copy button.
        console.fill("#code-label", "Living room")
        console.select_option("#code-validity", "week")
        console.click("#code-form button.primary")
        console.wait_for_selector("#code-new")
        code = console.inner_text("#code-new")
        assert re.fullmatch(r"[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}", code), code
        console.click("#code-copy")
        console.wait_for_selector("#code-copy.done")
        # Copied without the dash (tables ignore it either way).
        assert console.evaluate("() => navigator.clipboard.readText()") == code.replace("-", ""), "copy button"
        console.wait_for_selector(f"[data-code-row] .codehint:has-text('{code[:2]}')")
        assert code not in console.inner_text("#codes"), "the list must not show the code"
        console.screenshot(path=os.path.join(OUT, "codes-created.png"), full_page=True)

        # The board: the waiting notice suggests a code; the keypad takes it.
        board = ctx.new_page()
        watch(board, "board A")
        board.set_viewport_size({"width": 1920, "height": 1080})
        board.goto(TABLE_A + "/board/")
        board.wait_for_selector(".cloud:has-text('or enter an access code')")
        board.click("#settings-button")
        board.wait_for_selector(".overlay.settings .settings-actions")
        assert board.locator(".overlay.settings .service").count() == 0, "the access code is still in the settings"
        board.click(".overlay.settings button[data-close-overlay]")
        # In Advanced since D-219: set up once, out of the way of the settings used while playing.
        board.click("#tools-button")
        board.wait_for_selector(".overlay.advanced .service:has-text('Access code')")
        board.click("button[data-access-code]")
        board.wait_for_selector(".overlay.code-pad")
        assert board.is_disabled("button[data-save]"), "Use this code needs eight characters"
        # Two characters by keyboard, a wrong one deleted, the rest by touch.
        board.keyboard.type(code[:2].lower() + "Z")
        board.click("button[data-back]")
        for ch in code.replace("-", "")[2:]:
            board.click(f".code-pad button[data-key='{ch}']")
        slots = lambda: board.inner_text(".code-pad .slots").replace("\n", "").replace("-", "")
        assert slots() == code.replace("-", "")
        board.screenshot(path=os.path.join(OUT, "codes-keypad.png"))
        # Pasting: Ctrl/⌘+V (with the dash) and the Paste button (without), and something that is not a code.
        ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=TABLE_A)
        board.click("button[data-clear]")
        board.evaluate("(t) => navigator.clipboard.writeText(t)", code.lower())
        board.keyboard.press("ControlOrMeta+V")
        board.wait_for_function("(c) => document.querySelector('.code-pad .slots').innerText.replace(/[\\n-]/g, '') === c", arg=code.replace("-", ""))
        board.click("button[data-clear]")
        board.evaluate("(t) => navigator.clipboard.writeText(t)", "not a code!")
        board.click("button[data-paste]")
        board.wait_for_selector(".toast:has-text('not an access code')")
        assert slots() == "", "a wrong paste leaves the slots empty"
        board.evaluate("(t) => navigator.clipboard.writeText(t)", code.replace("-", ""))
        board.click("button[data-paste]")
        board.wait_for_function("(c) => document.querySelector('.code-pad .slots').innerText.replace(/[\\n-]/g, '') === c", arg=code.replace("-", ""))
        assert board.is_enabled("button[data-save]")
        board.click("button[data-save]")
        wait(lambda: state(TABLE_A)["cloud"]["status"] == "online", 20, "table A to be approved by its code")
        wait(lambda: "expiresAt" in state(TABLE_A)["cloud"]["code"], 20, "the code's validity to reach the table")
        c = state(TABLE_A)["cloud"]["code"]
        assert {k: c[k] for k in ("hint", "source", "status")} == {"hint": code[:2], "source": "board", "status": "accepted"}, c
        # The keypad closes; the settings behind it show the code as accepted.
        board.wait_for_selector(".overlay.advanced .service .code-status.accepted:has-text('valid for 7 days')")
        board.screenshot(path=os.path.join(OUT, "codes-board-accepted.png"))
        board.click(".overlay.advanced button[data-close-overlay]")

        # The console shows the table on the code's row, and the code on the table's row.
        console.reload()
        console.wait_for_selector("[data-code-row]:has-text('Living room') .dot")
        console.wait_for_selector("#tables :text('from access code')")

        # Edit: a new label and validity; the table stays connected.
        console.click("button[data-code-edit]")
        console.fill("[data-edit-label]", "Living room table")
        console.select_option("[data-edit-validity]", "forever")
        console.click("button[data-edit-save]")
        console.wait_for_selector("#code-msg.ok")
        console.wait_for_selector("[data-code-row]:has-text('Living room table'):has-text('forever')")
        # The board hears the new validity at its next heartbeat.
        wait(lambda: state(TABLE_A)["cloud"]["code"].get("expiresAt", 0) is None, 30, "the board to hear 'forever'")
        board.click("#tools-button")
        board.wait_for_selector(".overlay.advanced .service .code-status.accepted:has-text('valid forever')")
        board.click(".overlay.advanced button[data-close-overlay]")

        # The service restarts (a deploy): with its DATA_DIR, the table carries on and the code is still listed.
        cloud.terminate()
        cloud.wait(10)
        cloud = cloud_up()
        wait(lambda: state(TABLE_A)["cloud"]["status"] == "online", 40, "table A to be online again after the restart")
        assert not state(TABLE_A)["cloud"].get("pairingCode"), "no new pairing after the restart"
        console.reload()
        console.wait_for_selector("[data-code-row]:has-text('Living room table')")

        # A second table with the same code (TABLE_CODE) is refused, and its board says why.
        b_host = start_table(8103, TABLE_KEY="k", TABLE_NAME="Den", CLOUD_URL=CLOUD, TABLE_CODE=code)
        wait(lambda: (state(TABLE_B)["cloud"].get("code") or {}).get("status") == "in-use", 20, "table B to hear the code is in use")
        assert state(TABLE_B)["cloud"]["status"] == "pending"
        board_b = ctx.new_page()
        watch(board_b, "board B")
        board_b.set_viewport_size({"width": 1920, "height": 1080})
        board_b.goto(TABLE_B + "/board/")
        board_b.wait_for_selector(".cloud:has-text('used by another table')")
        board_b.click("#tools-button")
        board_b.wait_for_selector(".service:has-text('set at start')")
        assert not board_b.query_selector("button[data-access-code]"), "a code given at start can't be changed on the board"
        board_b.screenshot(path=os.path.join(OUT, "codes-board-in-use.png"))
        board_b.close()
        console.reload()
        console.wait_for_selector("[data-code-row] :text('refused')")

        # Release: table A is disconnected, and table B takes the code at its next hello.
        console.once("dialog", lambda d: d.accept())
        console.click("button[data-code-release]")
        console.wait_for_selector("#code-msg.ok")
        wait(lambda: state(TABLE_A)["cloud"]["status"] == "revoked", 20, "table A to be disconnected by the release")
        wait(lambda: state(TABLE_B)["cloud"]["status"] == "online", 30, "table B to be approved with the released code")
        board.wait_for_selector(".cloud:has-text('disconnected')")

        # Delete: table B is disconnected too, and the list is empty.
        console.reload()
        console.wait_for_selector("[data-code-row]:has-text('Den')")
        console.once("dialog", lambda d: d.accept())
        console.click("button[data-code-delete]")
        console.wait_for_selector("#codes :text('No access codes yet')")
        wait(lambda: state(TABLE_B)["cloud"]["status"] == "revoked", 20, "table B to be disconnected by the delete")
        console.screenshot(path=os.path.join(OUT, "codes-console.png"), full_page=True)

        # Table A's board can remove the code it was given.
        board.click("#tools-button")
        board.click("button[data-access-code]")
        board.click("button[data-remove]")
        wait(lambda: state(TABLE_A)["cloud"].get("code") is None, 10, "the code to be removed")

        # Deleting records (D-115). A log from table B (still disconnected), a download token, then: delete the log,
        # revoke the token, delete table B with its logs.
        tok = call(CLOUD, "POST", "/admin/api/codes", {"validity": "week"}, {"authorization": f"Bearer {ADMIN}"})
        t = call(CLOUD, "POST", "/api/tables/hello", {"tableId": "t_e2e_log_owner_1", "name": "Log owner", "accessCode": tok["code"]})
        for lid, sim in (("log-e2e-1", 0), ("log-e2e-sim", 1)):
            req = urllib.request.Request(f"{CLOUD}/api/tables/logs/{lid}?gameId=coin-flip&simulation={sim}", data=b"zip", method="PUT",
                                         headers={"authorization": f"Bearer {t['tableToken']}"})
            urllib.request.urlopen(req).read()
        console.reload()
        console.fill("#dl-label", "e2e pipeline")
        console.click("#dl-form button.primary")
        console.wait_for_selector("#tokens :text('e2e pipeline')")
        console.once("dialog", lambda d: d.accept())
        console.click("button[data-token-revoke]")
        console.wait_for_selector("#tokens :text('No active download tokens')")
        console.wait_for_selector("#logs :text('log-e2e-sim')")
        console.once("dialog", lambda d: d.accept())
        console.click("#logs-delete-sims")
        console.wait_for_selector("#logs-msg:has-text('Deleted 1 simulation log')")
        console.once("dialog", lambda d: d.accept())
        console.click("button[data-log-delete='log-e2e-1']")
        console.wait_for_selector("#logs :text('No logs uploaded yet')")
        # Table B (disconnected by the delete above): Delete is offered, confirmed twice (the table, then its logs).
        answers = iter([True, False])
        console.on("dialog", lambda d: d.accept() if next(answers) else d.dismiss())
        console.click("button[data-table-delete]")
        console.wait_for_selector("#pair-msg:has-text('Deleted')")
        console.screenshot(path=os.path.join(OUT, "codes-records.png"), full_page=True)
        br.close()
finally:
    for proc in (b_host, a, cloud):
        if proc:
            proc.terminate()

if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("ok: access codes")
