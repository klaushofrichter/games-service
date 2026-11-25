"""Browser check of the board's screensaver (D-298), with the page's clock run forward instead of waiting an hour:

  - after an hour without input the window goes black with a clock, and the board underneath stops being painted;
    again after the next hour without input;
  - an hour less a minute, with a key pressed in between, does not;
  - the tap that wakes the board brings it back and does nothing else (the game tile under it isn't opened);
  - Settings › Display › Screensaver Off: no screensaver, also after hours; the choice is kept after a reload.

  python3 scripts/e2e/screensaver.py out/
"""
import os, sys
from playwright.sync_api import sync_playwright
from common import api, errors, join_deck, start_table, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
PORT = 8149
HOME = f"http://127.0.0.1:{PORT}"
CHROMIUM = os.environ.get("CHROMIUM_PATH")

proc = start_table(PORT, TABLE_KEY="saver-e2e-key", PUBLIC_URL=HOME)
A = lambda m, path: api(m, path, base=HOME, key="saver-e2e-key")
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

        # And again after another hour: it came only once per page before (the timer was never set again).
        page.clock.run_for("59:00")
        assert saver.count() == 0, "the screensaver came back before another hour without input"
        page.clock.run_for("02:00")
        page.wait_for_selector("#gt-saver.on")
        page.keyboard.press("Shift")
        assert saver.count() == 0, "a key did not end the screensaver"
        page.wait_for_timeout(800)  # the rest of the waking input is swallowed for a moment

        # The phones at the table rest with the board (D-328): a clock and a line saying the board rests. A touch on
        # the phone wakes the phone only (the touch presses nothing); a minute later it rests again; the board waking
        # wakes every phone. A remote player's phone does not rest.
        phone = br.new_page(viewport={"width": 390, "height": 844}, has_touch=True)
        watch(phone, "phone")
        phone.clock.install()
        join_deck(phone, A("GET", "/join")["url"], "Ann")
        rest = phone.locator("#phone-rest")
        assert rest.count() == 0, "the phone rests while the board is awake"
        page.clock.run_for("01:01:00")
        page.wait_for_selector("#gt-saver.on")
        phone.wait_for_selector("#phone-rest.on", timeout=10000)
        assert "board is resting" in phone.locator("#phone-rest .why").inner_text()
        assert phone.locator("#phone-rest .time").inner_text().strip(), "the phone's screensaver shows no clock"
        phone.wait_for_timeout(2500)  # (the fade to black runs in real time)
        assert phone.evaluate("() => getComputedStyle(document.getElementById('phone-rest')).opacity") == "1", "the phone's screensaver is not black"
        assert phone.locator("#phone-rest .time").evaluate("(e) => e.getBoundingClientRect().height") < 100, "the clock wraps onto two lines"
        phone.screenshot(path=os.path.join(OUT, "screensaver-phone.png"))
        ready = phone.locator("#ready")
        box = ready.bounding_box() if ready.count() else None
        phone.mouse.click(box["x"] + 10, box["y"] + 10) if box else phone.mouse.click(195, 420)
        assert rest.count() == 0, "a touch did not wake the phone"
        assert page.locator("#gt-saver").count() == 1, "a touch on the phone woke the board"
        phone.wait_for_timeout(300)
        assert not any(p.get("ready") for p in A("GET", "/state")["players"]), "the waking touch also pressed Ready"
        phone.clock.run_for("00:50")
        assert rest.count() == 0, "the phone rested again before a minute"
        phone.clock.run_for("00:15")
        phone.wait_for_selector("#phone-rest.on")
        # The board wakes: so does the phone.
        page.keyboard.press("Shift")
        phone.wait_for_selector("#phone-rest", state="detached", timeout=10000)
        assert page.locator("#gt-saver").count() == 0
        phone.close()
        page.wait_for_timeout(800)

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
