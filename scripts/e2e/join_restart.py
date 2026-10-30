"""Browser check of the join code across a restart of the Table Host (D-241): every start makes a new code, so a board
left open must not show the old one while the table is gone. The QR code, the code and its link hide, a note says the
board is connecting, and the new code shows once the table answers; a phone that scans an old code is told why.
  python3 scripts/e2e/join_restart.py out/
"""
import os, sys, tempfile
from urllib.parse import unquote
from playwright.sync_api import sync_playwright
from common import call, start_table, wait, watch, errors

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
TABLE = "http://127.0.0.1:8144"
ENV = dict(PUBLIC_URL=TABLE, TABLE_KEY="k", DATA_DIR=tempfile.mkdtemp(prefix="e2e-table-"))
join = lambda: call(TABLE, "GET", "/api/v1/join", headers={"x-table-key": "k"})["url"]
problems = []

host = start_table(8144, **ENV)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        board = b.new_page(viewport={"width": 1280, "height": 800})
        watch(board, "board", ignore=("WebSocket", "ERR_CONNECTION_REFUSED", "Failed to load resource"))
        board.goto(TABLE + "/board/")
        qr = board.locator("aside.join img")
        qr.wait_for()
        shown = lambda: unquote((qr.get_attribute("src") or "").split("u=", 1)[-1])
        old = join()
        if shown() != old:
            problems.append(f"the board shows {shown()}, not the table's code {old}")

        # The table stops: the code on the board may be a dead one now.
        host.terminate()
        host.wait()
        wait(lambda: board.evaluate("() => document.body.classList.contains('offline')"), 10, "the board to notice the table is gone")
        if qr.is_visible() or board.locator("aside.join .code").is_visible():
            problems.append("the board still shows the join code while the table is gone")
        if not board.locator("aside.join .offline-note").is_visible():
            problems.append("no note that the board is connecting")
        board.screenshot(path=os.path.join(OUT, "join-restart-offline.png"))

        # It starts again with a new code: the board shows that one.
        host = start_table(8144, **ENV)
        new = join()
        if new == old:
            problems.append("the restarted table kept its old code")
        wait(lambda: qr.is_visible() and shown() == new, 15, "the board to show the new code")
        if board.locator("aside.join .offline-note").is_visible():
            problems.append("the connecting note stayed after the table answered")
        board.screenshot(path=os.path.join(OUT, "join-restart-back.png"))

        # A phone with the old code learns why it no longer works.
        phone = b.new_page(viewport={"width": 390, "height": 844})
        phone.goto(old)
        wait(lambda: "restarted" in phone.locator("body").inner_text(), 10, "the phone to say the code is old")
        phone.screenshot(path=os.path.join(OUT, "join-restart-phone.png"))
        b.close()
finally:
    host.terminate()

problems += errors
if problems:
    print("join-restart: FAILED\n  " + "\n  ".join(problems))
    sys.exit(1)
print("join-restart: ok")
