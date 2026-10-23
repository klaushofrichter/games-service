"""Browser check of the board's sound in a browser that allows it only after a touch (D-195), as browsers do for a board
opened anywhere but the table's own kiosk: an iPad, another computer, the table's address on the network.

  - a board in such a browser says "Tap to turn the sound on"; it does not with the sound switched off;
  - a finger's tap on the board (touchscreen: pointerdown alone does not count) turns the sound on and the hint goes;
  - a browser that allows sound from the start (the kiosk) never shows the hint.

  python3 scripts/e2e/sound_hint.py out/
"""
import os, sys, time
from playwright.sync_api import sync_playwright
from common import KEY, api, errors, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
PORT = 8138
BASE = f"http://127.0.0.1:{PORT}"
CHROMIUM = os.environ.get("CHROMIUM_PATH")
EXE = {"executable_path": CHROMIUM} if CHROMIUM else {}


def a(method, path, body=None):
    return api(method, path, body, base=BASE)


# Headless Chromium plays sound without a touch whatever its autoplay flag (and Playwright's evaluate counts as a
# gesture), so this page's audio follows the rule of a browser that does not: it starts suspended and resumes only while
# a real pointerup, touchend, click or key is being handled, not a finger's pointerdown, as Chrome and Safari decide it.
STRICT = """(() => {
  let allowed = false;
  for (const t of ["pointerup", "touchend", "click", "keydown"])
    window.addEventListener(t, (e) => { if (e.isTrusted) { allowed = true; setTimeout(() => (allowed = false)); } }, true);
  const Real = window.AudioContext;
  window.AudioContext = class extends Real {
    constructor(...a) { super(...a); super.suspend(); (window.testAudio ??= []).push(this); }
    resume() { return allowed ? super.resume() : new Promise(() => {}); }
  };
})();"""


def audio_state(page):
    return page.evaluate("window.testAudio?.[0]?.state")


proc = start_table(PORT, TABLE_KEY=KEY)
try:
    with sync_playwright() as p:
        # Sound only after a touch, as on an iPad or any page that is not the kiosk's.
        strict = p.chromium.launch(**EXE)
        ctx = strict.new_context(viewport={"width": 1180, "height": 820}, has_touch=True)
        ctx.add_init_script(STRICT)
        board = ctx.new_page()
        watch(board, "board")
        board.goto(BASE + "/board/")
        board.wait_for_selector("button.tile")
        board.wait_for_selector("#sound-hint:not([hidden])", timeout=5000)
        assert "Tap to turn the sound on" in board.inner_text("#sound-hint")
        assert audio_state(board) != "running"
        board.screenshot(path=os.path.join(OUT, "sound-hint.png"))

        # Sound switched off at this table: no hint.
        a("POST", "/display", {"sound": False})
        board.wait_for_selector("#sound-hint", state="hidden")
        a("POST", "/display", {"sound": True})
        board.wait_for_selector("#sound-hint:not([hidden])")

        # A finger's pointerdown alone is no permission: the old wake-up on pointerdown left the sound off.
        board.evaluate("document.body.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerType: 'touch'}))")
        time.sleep(0.3)
        assert audio_state(board) != "running"
        # A finger's tap on an empty spot of the board turns it on.
        board.touchscreen.tap(590, 780)
        wait(lambda: audio_state(board) == "running", 5, "the sound to run after a tap")
        board.wait_for_selector("#sound-hint", state="hidden")
        strict.close()

        # A browser that plays sound from the start (the table's kiosk): never a hint.
        kiosk = p.chromium.launch(**EXE)
        page = kiosk.new_page(viewport={"width": 1920, "height": 1080})
        watch(page, "kiosk board")
        page.goto(BASE + "/board/")
        page.wait_for_selector("button.tile")
        time.sleep(2.2)
        assert page.locator("#sound-hint").is_hidden(), "the kiosk shows the sound hint"
        kiosk.close()
finally:
    proc.terminate()
if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("ok: the board's sound waits for a touch, and says so")
