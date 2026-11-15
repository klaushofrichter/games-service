"""Browser check of the board's screensaver (D-298), with the page's clock run forward instead of waiting an hour:

  - after an hour without input the window goes black with a clock, and the board underneath stops being painted;
  - an hour less a minute, with a key pressed in between, does not;
  - the tap that wakes the board brings it back and does nothing else (the game tile under it isn't opened);
  - Settings › Display › Screensaver Off: no screensaver, also after hours; the choice is kept after a reload.

  python3 scripts/e2e/screensaver.py out/
"""
import os, sys
from playwright.sync_api import sync_playwright
from common import errors, start_table, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
PORT = 8149
HOME = f"http://127.0.0.1:{PORT}"
CHROMIUM = os.environ.get("CHROMIUM_PATH")

proc = start_table(PORT, TABLE_KEY="saver-e2e-key")
try:
    with sync_playwright() as p:
        br = p.chromium.launch(**({"executable_path": CHROMIUM} if CHROMIUM else {}))
        page = br.new_page(viewport={"width": 1920, "height": 1080})
        watch(page, "board")
        page.clock.install()
        page.goto(HOME + "/board/")
        page.wait_for_selector("button.tile")
        saver = page.locator("#gt-saver")

        # Input resets the hour.
        page.clock.run_for("45:00")
        page.keyboard.press("Shift")
        page.clock.run_for("45:00")
        assert saver.count() == 0, "the screensaver came before an hour without input"

        page.clock.run_for("16:00")
        page.wait_for_selector("#gt-saver.on")
        page.wait_for_function("document.documentElement.classList.contains('gt-saver-dark')")
        assert page.evaluate("() => getComputedStyle(document.getElementById('surface')).visibility") == "hidden", "the board is still painted under the screensaver"
        assert page.locator("#gt-saver .time").inner_text().strip(), "the screensaver shows no clock"
        page.screenshot(path=os.path.join(OUT, "screensaver.png"))

        # The waking tap lands on a game tile's place: the board comes back, the tile is not opened.
        box = page.locator("button.tile").first.bounding_box()
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        assert saver.count() == 0, "a tap did not end the screensaver"
        assert not page.evaluate("() => document.documentElement.classList.contains('gt-saver-dark')")
        page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(OUT, "screensaver-woken.png"))
        assert page.locator("#overlay-root > *").count() == 0, "the waking tap also opened " + page.locator("#overlay-root").inner_text()[:200]

        # Off in the settings: nothing after hours; kept after a reload.
        page.click("#settings-button")
        page.click(".overlay.settings button[data-screensaver]")
        assert page.locator(".overlay.settings button[data-screensaver]:not(.on)").count() == 1, "the switch shows Off"
        page.click(".overlay.settings button[data-close-overlay]")
        page.clock.run_for("03:00:00")
        assert saver.count() == 0, "the screensaver came while it is off"
        page.reload()
        page.wait_for_selector("button.tile")
        page.clock.run_for("02:00:00")
        assert saver.count() == 0, "the screensaver came after a reload while it is off"
        br.close()
finally:
    proc.terminate()
if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("ok: the screensaver")
