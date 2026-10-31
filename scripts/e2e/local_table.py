"""Browser check of scripts/local-table.sh (D-243): started as on a developer's computer (without updating or opening a
browser, no cloud service), the board's QR code carries an address of this computer's network, not localhost, and a
phone that opens it gets the name form. It also may not warn that the address does not answer.
  python3 scripts/e2e/local_table.py out/
"""
import os, re, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright
from common import REPO, wait, wait_http, watch, errors

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
PORT = 8145
problems = []
log_path = os.path.join(OUT, "local-table.log")
env = dict(os.environ, PORT=str(PORT), CLOUD_URL="", DATA_DIR=tempfile.mkdtemp(prefix="e2e-local-table-"), TABLE_NAME="E2E Table")
env.pop("PUBLIC_URL", None)  # the script finds it, as on a developer's computer
with open(log_path, "w") as log:
    proc = subprocess.Popen(["bash", "scripts/local-table.sh", "--no-pull", "--no-open"], cwd=REPO, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
try:
    wait_http(f"http://127.0.0.1:{PORT}/health", 300)  # it may install the dependencies first
    with sync_playwright() as p:
        b = p.chromium.launch()
        board = b.new_page(viewport={"width": 1280, "height": 800})
        watch(board, "board")
        board.goto(f"http://localhost:{PORT}/board/")
        board.locator("aside.join img").wait_for()
        url = board.locator("aside.join .url").inner_text().strip()
        if not re.match(rf"^http://\d+\.\d+\.\d+\.\d+:{PORT}/j/[A-Z0-9]+$", url):
            problems.append(f"the QR code carries {url!r}, not this computer's network address and port {PORT}")
        elif url.startswith("http://127.") or "localhost" in url:
            problems.append(f"the QR code carries a local-only address: {url}")
        # Encoded in the QR image as shown.
        src = board.locator("aside.join img").get_attribute("src") or ""
        if urllib.request.unquote(src.split("u=", 1)[-1]) != url:
            problems.append(f"the QR image encodes {src}, not the address under it ({url})")
        board.screenshot(path=os.path.join(OUT, "local-table-board.png"))

        # A phone opens the address from the QR code.
        phone = b.new_page(viewport={"width": 390, "height": 844})
        watch(phone, "phone")
        phone.goto(url)
        phone.locator("input[name=name]").wait_for(timeout=10000)
        if phone.locator(".banner, #top .error").count() and phone.locator("#top").inner_text().strip():
            problems.append(f"the phone shows a warning: {phone.locator('#top').inner_text()}")
        phone.screenshot(path=os.path.join(OUT, "local-table-phone.png"))
        b.close()
    time.sleep(1)
finally:
    os.killpg(proc.pid, 15)
    proc.wait()

out = open(log_path).read()
if "does not answer on this computer" in out:
    problems.append("the script warned that the QR code's address does not answer")
problems += errors
if problems:
    print("local-table: FAILED\n  " + "\n  ".join(problems) + f"\n  (log: {log_path})")
    sys.exit(1)
print("local-table: ok")
