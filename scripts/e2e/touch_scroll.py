"""Browser check of scrolling made for a finger (D-306): the board's Settings and Advanced windows on a screen too low
to show them whole.

  - a wide bar of its own at the window's right edge (twice the browser's bar), the browser's own bar gone;
  - dragging the bar's thumb scrolls, a tap on the track below it turns a page;
  - one finger dragged across the window scrolls it, two fingers too (the content follows their middle);
  - a drag that starts on a button does not press it; a tap still does; the volume slider keeps its own touch;
  - with the lobby turned to face north the window is upside down, and the content still follows the fingers;
  - Done stays in the window, clear of the bar.

A Table Host of its own (port 8153).
  python3 scripts/e2e/touch_scroll.py out/
"""
import os, sys
from playwright.sync_api import sync_playwright
from common import api, errors, open_board, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
PORT = 8153
BASE = f"http://127.0.0.1:{PORT}"
KEY = "touch-scroll-e2e"


def a(method, path, body=None):
    return api(method, path, body, base=BASE, key=KEY)


proc = start_table(PORT, TABLE_KEY=KEY, PUBLIC_URL=BASE)
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={"width": 1280, "height": 560}, has_touch=True)
        page = ctx.new_page()
        watch(page, "board")
        open_board(page, BASE + "/board/")
        cdp = ctx.new_cdp_session(page)

        def touch(kind, points):
            cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(points)]})

        def drag(starts, dy, steps=8):
            """Fingers down at `starts`, moved by dy (screen pixels, down is positive) in steps, and lifted."""
            touch("touchStart", starts)
            for k in range(1, steps + 1):
                touch("touchMove", [(x, y + dy * k / steps) for x, y in starts])
            touch("touchEnd", [])
            page.wait_for_timeout(700)  # (it runs on a little, and settles)

        top = lambda sel: page.evaluate("(s) => document.querySelector(s).scrollTop", sel)

        for which, button, sel in (("settings", "#settings-button", ".overlay.settings .panel"), ("advanced", "#tools-button", ".overlay.advanced .panel")):
            page.click(button)
            page.wait_for_selector(f"{sel}.touch-scroll.scrolls")
            m = page.evaluate("""(s) => { const p = document.querySelector(s), b = p.querySelector('.scroll-bar').getBoundingClientRect(), r = p.getBoundingClientRect(),
              done = p.querySelector('[data-close-overlay]').getBoundingClientRect();
              return { bar: b.width, barRight: r.right - b.right, barLeft: b.left, native: p.offsetWidth - p.clientWidth, own: getComputedStyle(p).scrollbarWidth, doneRight: done.right, doneBottom: done.bottom, bottom: r.bottom,
                       room: p.scrollHeight - p.clientHeight }; }""", sel)
            assert 26 <= m["bar"] <= 32, f"{which}: the bar is {m['bar']} px wide, not twice the browser's 14"
            assert m["native"] <= 4, f"{which}: the browser's own scrollbar still takes {m['native']} px"
            assert m["own"] == "none", f"{which}: the browser's own scrollbar shows beside the bar (scrollbar-width {m['own']})"
            assert 0 <= m["barRight"] <= 12, f"{which}: the bar is not at the window's right edge: {m}"
            assert m["doneRight"] <= m["barLeft"] - 4 and m["doneBottom"] <= m["bottom"], f"{which}: Done is under the bar or outside the window: {m}"
            assert m["room"] > 80, f"{which}: the window has nothing to scroll at this size: {m}"

            # The thumb, dragged with the mouse (a touchscreen may reach the browser as one).
            t = page.locator(f"{sel} .scroll-thumb").bounding_box()
            page.mouse.move(t["x"] + t["width"] / 2, t["y"] + 20)
            page.mouse.down()
            page.mouse.move(t["x"] + t["width"] / 2, t["y"] + 20 + 60, steps=5)
            page.mouse.up()
            assert top(sel) > 20, f"{which}: dragging the thumb did not scroll ({top(sel)})"
            page.evaluate("(s) => (document.querySelector(s).scrollTop = 0)", sel)
            # A tap on the track below the thumb: a page down.
            bar = page.locator(f"{sel} .scroll-bar").bounding_box()
            page.mouse.click(bar["x"] + bar["width"] / 2, bar["y"] + bar["height"] - 6)
            assert top(sel) > 20, f"{which}: a tap on the track did not turn the page ({top(sel)})"
            page.evaluate("(s) => (document.querySelector(s).scrollTop = 0)", sel)

            # One finger across the window, then two: the content follows.
            r = page.locator(sel).bounding_box()
            cx, cy = r["x"] + r["width"] * 0.4, r["y"] + r["height"] * 0.6
            drag([(cx, cy)], -120)
            one = top(sel)
            assert one >= 100, f"{which}: one finger dragged up by 120 px scrolled by {one}"
            page.evaluate("(s) => (document.querySelector(s).scrollTop = 0)", sel)
            drag([(cx - 40, cy), (cx + 40, cy + 10)], -120)
            two = top(sel)
            assert two >= 100, f"{which}: two fingers dragged up by 120 px scrolled by {two}"
            drag([(cx - 40, cy), (cx + 40, cy)], 60)
            assert top(sel) < two - 30, f"{which}: two fingers dragged down did not scroll back ({two} -> {top(sel)})"
            page.screenshot(path=os.path.join(OUT, f"touch-scroll-{which}.png"))
            page.evaluate("(s) => (document.querySelector(s).scrollTop = 0)", sel)

            if which == "settings":
                # A drag that starts on a button does not press it; a tap does. The slider keeps its own touch.
                btn = page.locator(".overlay.settings button[data-sound]")  # Sound effects, On
                b = btn.bounding_box()
                drag([(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)], -80)
                page.wait_for_timeout(300)
                assert a("GET", "/state")["display"].get("sound", True) is not False, "a drag that started on a button pressed it"
                assert top(sel) >= 60, f"a drag that started on a button did not scroll ({top(sel)})"
                page.evaluate("(s) => (document.querySelector(s).scrollTop = 0)", sel)
                vol = page.locator(".overlay.settings input[data-volume]").bounding_box()
                drag([(vol["x"] + vol["width"] / 2, vol["y"] + vol["height"] / 2)], -80)
                assert top(sel) == 0, "a drag on the volume slider scrolled the window"
                # After a finger has scrolled the window, the next tap on a field in it still counts: a finger's pan
                # ends without a click, and "that was a drag" must not swallow the tap that follows. (The events are
                # made here: a pan that the browser ends with no click, then a press and a click on the slider.)
                tapped = page.evaluate("""() => {
                  const panel = document.querySelector('.overlay.settings .panel'), field = panel.querySelector('input[data-volume]');
                  const r = panel.getBoundingClientRect(), x = r.left + r.width * 0.4, y = r.top + r.height * 0.6;
                  const ev = (type, target, cx, cy) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: cy }));
                  const under = document.elementFromPoint(x, y);
                  ev('pointerdown', under, x, y);
                  for (let k = 1; k <= 6; k++) ev('pointermove', under, x, y - 15 * k);
                  ev('pointerup', under, x, y - 90);
                  let heard = false;
                  field.addEventListener('click', () => (heard = true), { once: true });
                  const f = field.getBoundingClientRect();
                  ev('pointerdown', field, f.left + 5, f.top + 5);
                  ev('pointerup', field, f.left + 5, f.top + 5);
                  field.click();
                  return heard;
                }""")
                assert tapped, "after a finger scrolled the window, the next tap on a field in it was swallowed"
                page.wait_for_timeout(700)
                page.evaluate("(s) => (document.querySelector(s).scrollTop = 0)", sel)
                # Turned to face north: the window is upside down, and the content still follows the fingers.
                a("POST", "/face", {"edge": "north"})
                page.wait_for_function("(s) => getComputedStyle(document.querySelector(s)).transform.startsWith('matrix(-1')", arg=sel)
                page.wait_for_timeout(500)
                r = page.locator(sel).bounding_box()
                cx, cy = r["x"] + r["width"] * 0.6, r["y"] + r["height"] * 0.4
                drag([(cx - 40, cy), (cx + 40, cy)], 120)  # down on the screen is up for this window
                north = top(sel)
                assert north >= 100, f"facing north, two fingers dragged down on the screen scrolled by {north}"
                page.screenshot(path=os.path.join(OUT, "touch-scroll-north.png"))
                a("POST", "/face", {"edge": "south"})
                page.wait_for_function("(s) => !getComputedStyle(document.querySelector(s)).transform.startsWith('matrix(-1')", arg=sel)
                page.wait_for_timeout(500)
                # A tap still presses.
                page.evaluate("(s) => (document.querySelector(s).scrollTop = 0)", sel)
                b = btn.bounding_box()
                page.touchscreen.tap(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
                wait(lambda: a("GET", "/state")["display"].get("sound") is False, 5, "a tap on Sound effects to switch them off")
                a("POST", "/display", {"sound": True})
            if which == "advanced":
                # A list that scrolls inside the window (as Live status has) gets the bar and the fingers too, and
                # takes them while it has something to scroll: the window around it stays where it is.
                page.evaluate("""(s) => { const p = document.querySelector(s), l = document.createElement('div');
                  l.className = 'live-trace'; l.id = 'e2e-inner'; l.style.cssText = 'max-height:200px;overflow:auto';
                  l.innerHTML = Array.from({ length: 60 }, (_, i) => `<div>line ${i}</div>`).join('');
                  p.insertBefore(l, p.children[2]); p.scrollTop = 0; }""", sel)
                page.wait_for_selector("#e2e-inner.touch-scroll.scrolls .scroll-bar:not([hidden])")
                r = page.locator("#e2e-inner").bounding_box()
                drag([(r["x"] + r["width"] / 2, r["y"] + r["height"] - 30)], -100)
                inner = top("#e2e-inner")
                assert inner >= 80 and top(sel) == 0, f"a drag on a list inside the window: the list scrolled by {inner}, the window by {top(sel)}"
                page.evaluate("() => document.getElementById('e2e-inner').remove()")
            page.click(f"{sel} [data-close-overlay]")
            wait(lambda: page.locator(sel).count() == 0, 5, f"the {which} window to close")
        br.close()
finally:
    proc.terminate()
if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("ok: scrolling for a finger")
