"""Browser check of scripts/local-table.sh (D-243): started as on a developer's computer (without updating or opening a
browser, no cloud service), the board's QR code carries an address of this computer's network, not localhost, and a
phone that opens it gets the name form. It also may not warn that the address does not answer.
  python3 scripts/e2e/local_table.py out/
"""
import os, re, shutil, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright
from common import REPO, call, wait, wait_http, watch, errors

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
PORT = 8145
problems = []
log_path = os.path.join(OUT, "local-table.log")
# --offline --all-games (D-247): a folder beside it with another checkout of games, here a copy of the test game Duel.
others = tempfile.mkdtemp(prefix="e2e-checkouts-")
shutil.copytree(os.path.join(REPO, "tests", "fixtures", "local-seat", "duel"), os.path.join(others, "more-games", "games", "duel"))
env = dict(os.environ, PORT=str(PORT), DATA_DIR=tempfile.mkdtemp(prefix="e2e-local-table-"), TABLE_NAME="E2E Table", SHOW_TEST_GAMES="1")
env.pop("CLOUD_URL", None)  # --offline does it
env.pop("PUBLIC_URL", None)  # the script finds it, as on a developer's computer
with open(log_path, "w") as log:
    proc = subprocess.Popen(["bash", "scripts/local-table.sh", "--no-pull", "--no-open", "--offline", "--all-games", others], cwd=REPO, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
try:
    wait_http(f"http://127.0.0.1:{PORT}/health", 300)  # it may install the dependencies first
    # The other checkout's game is on the table; no live service (D-247).
    games = call(f"http://127.0.0.1:{PORT}", "GET", "/api/v1/games", headers={"x-table-key": open(os.path.join(env["DATA_DIR"], "table-key")).read().strip()})
    if not any(g["id"] == "duel" for g in games):
        problems.append(f"--all-games: the other checkout's game is missing: {[g['id'] for g in games]}")
    with sync_playwright() as p:
        b = p.chromium.launch()
        board = b.new_page(viewport={"width": 1280, "height": 800})
        watch(board, "board")
        board.goto(f"http://localhost:{PORT}/board/")
        # A local table says so once (D-251): no service, so no remote players; the games' checkouts with their branches.
        note = board.locator(".local-notice")
        note.wait_for(timeout=10000)
        text = note.inner_text()
        if "No Game Table service" not in text or "Remote players" not in text:
            problems.append(f"the local table's notice doesn't say there is no service: {text!r}")
        branch = subprocess.run(["git", "-C", REPO, "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True).stdout.strip()
        if os.path.basename(REPO) not in text or branch not in text:
            problems.append(f"the notice doesn't name this checkout ({os.path.basename(REPO)}, branch {branch}): {text!r}")
        board.screenshot(path=os.path.join(OUT, "local-table-notice.png"))
        note.locator("[data-x=ok]").click()
        board.reload()
        board.locator("aside.join img").wait_for()
        time.sleep(1)
        if board.locator(".local-notice").count():
            problems.append("the local table's notice came back after Got it")
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
if "service:   none" not in out:
    problems.append("--offline: the table still uses the live service")
if "does not answer on this computer" in out:
    problems.append("the script warned that the QR code's address does not answer")
problems += errors
if problems:
    print("local-table: FAILED\n  " + "\n  ".join(problems) + f"\n  (log: {log_path})")
    sys.exit(1)
print("local-table: ok")
