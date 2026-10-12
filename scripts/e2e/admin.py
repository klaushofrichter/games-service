"""Browser end-to-end check of the cloud admin portal: sign in, approve a waiting table, issue a
download token, change retention. Starts its own cloud service and table host.
  python3 scripts/e2e/admin.py out/
"""
import json, os, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
ADMIN = "admin-token-for-e2e-0001"
errors = []

cloud = subprocess.Popen(["node", "apps/cloud/src/main.ts"], cwd=REPO, env=dict(os.environ, ADMIN_TOKEN=ADMIN, PORT="8093", PUBLIC_URL="http://127.0.0.1:8093"))
time.sleep(1.5)
data = tempfile.mkdtemp(prefix="admin-e2e-")
host = subprocess.Popen(["node", "apps/table-host/src/main.ts"], cwd=REPO,
                        env=dict(os.environ, PORT="8094", TABLE_KEY="k", TABLE_NAME="Living room", CLOUD_URL="http://127.0.0.1:8093", DATA_DIR=data))
time.sleep(2.5)


def state():
    req = urllib.request.Request("http://127.0.0.1:8094/api/v1/state", headers={"x-table-key": "k"})
    return json.loads(urllib.request.urlopen(req).read())


try:
    code = state()["cloud"]["pairingCode"]
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={"width": 1280, "height": 900})
        # the deliberate wrong-token sign-in below logs one expected 401
        page.on("console", lambda m: m.type == "error" and "status of 401" not in m.text and errors.append(m.text))
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto("http://127.0.0.1:8093/admin")
        page.fill("#token", "wrong-token")
        page.click("#signin-form button")
        page.wait_for_selector("#signin-msg:has-text('not accepted')")
        page.fill("#token", ADMIN)
        page.click("#signin-form button")
        page.wait_for_selector(f"text={code}")
        page.screenshot(path=os.path.join(OUT, "admin-pending.png"))
        page.fill("#pair-code", code.lower())
        page.click("#pair-form button")
        page.wait_for_selector("#pair-msg.ok")
        for _ in range(40):
            if state()["cloud"]["status"] == "online":
                break
            time.sleep(0.5)
        assert state()["cloud"]["status"] == "online", state()["cloud"]
        page.wait_for_timeout(1000)
        page.reload()
        page.wait_for_selector(".pill.approved")
        page.fill("#dl-game", "roulette")
        page.click("#dl-form button")
        page.wait_for_selector("#dl-msg .mono")
        page.fill("#ret-days", "30")
        page.click("#ret-form button")
        page.wait_for_selector("#ret-msg.ok")
        page.screenshot(path=os.path.join(OUT, "admin-approved.png"), full_page=True)
        b.close()
finally:
    host.terminate()
    cloud.terminate()

if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("ok: admin portal")
