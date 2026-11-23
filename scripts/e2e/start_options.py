"""Browser check of the start's options for the table's screen (--screensaver, --pointer, --sound; D-319):

  - a table started with them: the board's settings show them (the pointer hidden, the volume, the screensaver's
    minutes) and they hold (the sound's level, the pointer in fullscreen, the screensaver after its minutes), though
    this browser kept other values; nothing is written to what the browser keeps;
  - a setting changed on the board is kept, and holds for the rest of that start, a reload included;
  - the next start begins with its options again; a start without options has what the browser keeps.

One table at a time on port 8159 (what a browser keeps is per address).
  python3 scripts/e2e/start_options.py out/
"""
import os, sys, tempfile
from playwright.sync_api import sync_playwright
from common import errors, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
PORT = 8159
HOME = f"http://127.0.0.1:{PORT}"
DATA = tempfile.mkdtemp(prefix="e2e-start-options-")
LEVEL = """async () => { const c = new OfflineAudioContext(1, 256, 8000); const s = c.createConstantSource();
  s.connect(c.destination); s.start(); const b = await c.startRendering(); return Math.round(b.getChannelData(0)[200] * 100); }"""
KEPT = "() => ['gametable.hidePointer', 'gametable.volume', 'gametable.screensaver'].map((k) => localStorage.getItem(k))"


def start(**options):
    return start_table(PORT, TABLE_KEY="start-options-e2e", DATA_DIR=DATA, **options)


def stop(proc):
    proc.terminate()
    proc.wait()


def settings(page):
    """The board's settings as they show: (hide the pointer, volume in percent, screensaver on, its text)."""
    page.goto(HOME + "/board/")
    page.wait_for_selector("button.tile")
    page.click("#settings-button")
    page.wait_for_selector(".overlay.settings input[data-volume]")
    o = page.locator(".overlay.settings")
    return (o.locator("button[data-hide-pointer].on").count() == 1, int(o.locator("input[data-volume]").input_value()),
            o.locator("button[data-screensaver].on").count() == 1, o.locator(".row", has=page.locator("button[data-screensaver]")).inner_text())


table = start(TABLE_SCREENSAVER="2", TABLE_POINTER="off", TABLE_SOUND="40")
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={"width": 1920, "height": 1080}, screen={"width": 2560, "height": 1440})
        page = ctx.new_page()
        watch(page, "board", ignore=("WebSocket", "ERR_CONNECTION_REFUSED", "Failed to load resource", "Failed to fetch"))

        # This browser kept the opposite of what the start asks for.
        page.goto(HOME + "/board/")
        page.evaluate("() => { localStorage.setItem('gametable.hidePointer', '0'); localStorage.setItem('gametable.volume', '0.9'); localStorage.setItem('gametable.screensaver', '0'); }")
        hide, volume, saver, text = settings(page)
        page.screenshot(path=os.path.join(OUT, "start-options-settings.png"))
        assert hide, "--pointer off: the settings don't show the pointer as hidden"
        assert volume == 40, f"--sound 40: the settings show {volume}"
        assert saver and "after 2 minutes" in text, f"--screensaver 2: the settings show {text!r}"
        assert page.evaluate(LEVEL) == 40, "--sound 40: the sound is not at 40 %"
        assert page.evaluate(KEPT) == ["0", "0.9", "0"], f"the start's options were saved: {page.evaluate(KEPT)}"
        page.evaluate("() => document.documentElement.requestFullscreen()")
        page.wait_for_function("document.documentElement.classList.contains('gt-pointer-hidden')")
        page.evaluate("() => document.exitFullscreen()")
        page.wait_for_function("!document.fullscreenElement")

        # The screensaver after its two minutes (the page's clock run forward).
        page.goto("about:blank")  # one board at a time
        timed = ctx.new_page()
        timed.clock.install()
        timed.goto(HOME + "/board/")
        timed.wait_for_selector("button.tile")
        timed.click("#settings-button")  # (the lobby state has arrived: the settings show the start's minutes)
        timed.wait_for_selector(".overlay.settings >> text=after 2 minutes")
        timed.click(".overlay.settings [data-close-overlay]")
        timed.clock.run_for("01:30")
        assert timed.locator("#gt-saver").count() == 0, "the screensaver came before its two minutes"
        timed.clock.run_for("00:45")
        timed.wait_for_selector("#gt-saver.on")
        timed.close()
        settings(page)

        # Changed on the board: kept, and it holds for the rest of this start. The others stay the start's.
        page.locator(".overlay.settings input[data-volume]").fill("70")
        assert page.evaluate(KEPT) == ["0", "0.7", "0"], f"the change on the board was not kept as it was made: {page.evaluate(KEPT)}"
        hide, volume, saver, text = settings(page)
        assert volume == 70 and hide and saver, f"after a reload: volume {volume}, pointer hidden {hide}, screensaver {saver}"

        # The next start begins with its options again.
        # A board left open (a kiosk browser) takes the next start's options too, and drops those of the start before.
        stop(table)
        table = start(TABLE_SOUND="20")
        wait(lambda: page.evaluate(LEVEL) == 20, 40, "the open board to take the next start's --sound 20")
        assert not page.evaluate("() => document.documentElement.classList.contains('gt-pointer-hidden')")
        hide, volume, saver, text = settings(page)
        assert volume == 20, f"the next start's --sound 20 shows as {volume}"
        assert not hide and not saver and "after an hour" in text, f"options not given come from the browser: pointer hidden {hide}, screensaver {saver}, {text!r}"
        assert page.evaluate(KEPT) == ["0", "0.7", "0"]

        # A start without options: what the browser keeps.
        stop(table)
        table = start()
        wait(lambda: page.evaluate(LEVEL) == 70, 40, "the open board to go back to what the browser keeps")
        hide, volume, saver, text = settings(page)
        assert (hide, volume, saver) == (False, 70, False), f"without options: pointer hidden {hide}, volume {volume}, screensaver {saver}"
        # And a browser that keeps nothing shows the pointer (D-319), plays at full volume, and has the screensaver.
        page.evaluate("() => localStorage.clear()")
        hide, volume, saver, text = settings(page)
        assert (hide, volume, saver) == (False, 100, True), f"to begin with: pointer hidden {hide}, volume {volume}, screensaver {saver}"
        assert not errors, errors
        br.close()
    print("start options: OK")
finally:
    stop(table)
