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
        if "no longer current" not in phone.inner_text("h1"):
            problems.append(f"the phone's heading for an old code: {phone.inner_text('h1')!r}")
        phone.screenshot(path=os.path.join(OUT, "join-restart-phone.png"))
        # It takes the code the board shows now, typed (D-309): a wrong one is said and the field stays; the right
        # one (in small letters too) leads to the name form, and the phone takes a seat.
        phone.fill("#code input[name=code]", "ZZZZ9999")
        phone.click("#code button[type=submit]")
        wait(lambda: "not the board's current code" in phone.inner_text("#code-error"), 5, "a wrong code to be refused")
        phone.fill("#code input[name=code]", new.rsplit("/", 1)[-1].lower())
        phone.click("#code button[type=submit]")
        phone.wait_for_selector("#join input[name=name]", timeout=10000)
        phone.fill("#join input[name=name]", "Late")
        phone.click("#join button[type=submit]")
        phone.wait_for_selector(".who h1")
        # Without any code, the page asks for it the same way.
        bare = b.new_page(viewport={"width": 390, "height": 844})
        bare.goto(old.split("/j/")[0] + "/deck/")
        bare.wait_for_selector("#code input[name=code]")
        if "Join the table" not in bare.inner_text("h1"):
            problems.append(f"the page without a code: {bare.inner_text('h1')!r}")
        b.close()
finally:
    host.terminate()

problems += errors
if problems:
    print("join-restart: FAILED\n  " + "\n  ".join(problems))
    sys.exit(1)
print("join-restart: ok")
