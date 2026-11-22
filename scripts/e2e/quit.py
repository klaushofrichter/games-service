"""Browser check of "Quit the table" (D-315): the way out of a browser that shows nothing but the board.

  - a table started as usual does not offer it;
  - a table started with TABLE_QUIT=1 (as the packages' starter does) has it in the Advanced window: it asks first,
    Cancel keeps the table, and Quit the table ends the table's program; the board says that it has quit.

Tables of its own (ports 8157, 8158).
  python3 scripts/e2e/quit.py out/
"""
import os, sys
from playwright.sync_api import sync_playwright
from common import api, errors, open_board, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
KEY = "quit-e2e"
plain = start_table(8157, TABLE_KEY=KEY, PUBLIC_URL="http://127.0.0.1:8157")
table = start_table(8158, TABLE_KEY=KEY, PUBLIC_URL="http://127.0.0.1:8158", TABLE_QUIT="1")
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        page = br.new_page(viewport={"width": 1280, "height": 800})
        watch(page, "board", ignore=("WebSocket", "ERR_CONNECTION_REFUSED", "Failed to load resource", "Failed to fetch"))
        open_board(page, "http://127.0.0.1:8157/board/")
        page.click("#tools-button")
        page.wait_for_selector(".overlay.advanced")
        assert page.locator(".overlay.advanced [data-adv=quit]").count() == 0, "a table not started for it offers Quit"

        open_board(page, "http://127.0.0.1:8158/board/")
        page.click("#tools-button")
        page.wait_for_selector(".overlay.advanced [data-adv=quit]")
        page.evaluate("() => document.querySelector('.overlay.advanced [data-adv=quit]').scrollIntoView({ block: 'center' })")
        page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(OUT, "quit-advanced.png"))
        page.click(".overlay.advanced [data-adv=quit]")
        page.wait_for_selector(".dialog-backdrop .dialog >> text=Quit the table?")
        page.click(".dialog-backdrop button[data-x=no]")
        page.wait_for_timeout(600)
        assert table.poll() is None and api("GET", "/state", base="http://127.0.0.1:8158", key=KEY)["phase"] == "idle", "Cancel quit the table"
        page.click("#tools-button")
        page.click(".overlay.advanced [data-adv=quit]")
        page.click(".dialog-backdrop button[data-x=yes]")
        page.wait_for_selector("#quit-note >> text=Game Table has quit")
        wait(lambda: table.poll() is not None, 10, "the table's program to end")
        assert table.returncode == 0, f"the table ended with {table.returncode}"
        assert plain.poll() is None, "the other table ended too"
        page.screenshot(path=os.path.join(OUT, "quit-done.png"))
        br.close()
finally:
    for proc in (plain, table):
        proc.terminate()
if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("ok: quit")
