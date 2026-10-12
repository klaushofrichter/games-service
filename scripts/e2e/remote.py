"""Browser end-to-end check of remote play (phase 1c): the local board creates an invite, a second
browser opens the invite page, joins by name, and gets the board and its private deck over a WebRTC
data channel to the table. Also checks the board-control switch and reconnecting after a reload.
  python3 scripts/e2e/remote.py out/
"""
import json, os, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
ADMIN = "admin-token-for-e2e-0001"
CLOUD, TABLE = "http://127.0.0.1:8095", "http://127.0.0.1:8096"
errors = []

cloud = subprocess.Popen(["node", "apps/cloud/src/main.ts"], cwd=REPO,
                         env=dict(os.environ, ADMIN_TOKEN=ADMIN, PORT="8095", PUBLIC_URL=CLOUD, ICE_SERVERS="[]"))
time.sleep(1.5)
data = tempfile.mkdtemp(prefix="remote-e2e-")
host = subprocess.Popen(["node", "apps/table-host/src/main.ts"], cwd=REPO,
                        env=dict(os.environ, PORT="8096", TABLE_KEY="k", TABLE_NAME="Living room", CLOUD_URL=CLOUD, DATA_DIR=data))
time.sleep(2.5)


def call(base, method, path, body=None, headers=None):
    req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json", **(headers or {})})
    return json.loads(urllib.request.urlopen(req).read() or b"{}")


def state():
    return call(TABLE, "GET", "/api/v1/state", headers={"x-table-key": "k"})


def wait(fn, secs=20):
    end = time.time() + secs
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(0.25)
    raise AssertionError("timed out")


def watch(page, label):
    page.on("console", lambda m: m.type == "error" and errors.append(f"{label}: {m.text}"))
    page.on("pageerror", lambda e: errors.append(f"{label}: {e}"))


try:
    code = state()["cloud"]["pairingCode"]
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

        # remote board control: rotate from the remote board, then the table switches control off
        before = state()["frontEdge"]
        rboard.locator("button[data-rotate='180']").first.click()
        wait(lambda: state()["frontEdge"] != before)
        board.uncheck(".invite input[name=control]")
        wait(lambda: not state()["remote"]["boardControl"])
        rboard.locator("text=view only").wait_for(timeout=10000)
        rboard.locator("button[data-rotate='180']").first.click()
        rboard.locator(".toast").wait_for(timeout=5000)
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
