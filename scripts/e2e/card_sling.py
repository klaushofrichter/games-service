"""EXPERIMENT (card sling): a phone drags a card a third off its top, then flings it onto the pile, then draws one.
Screenshots of the board and the phone at each stage, and the gesture rate the board received.
  python3 scripts/e2e/card_sling.py out/
"""
import os, sys, time
from playwright.sync_api import sync_playwright
from common import api, errors, join_deck, start_table, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
PORT = 8133
BASE = f"http://127.0.0.1:{PORT}"
CHROMIUM = os.environ.get("CHROMIUM_PATH")


def a(m, p, b=None):
    return api(m, p, b, base=BASE, key="k")


proc = start_table(PORT, TABLE_KEY="k", PUBLIC_URL=BASE, AI_DELAY_MS="150")
try:
    with sync_playwright() as p:
        br = p.chromium.launch(**({"executable_path": CHROMIUM} if CHROMIUM else {}))
        board = br.new_page(viewport={"width": 1920, "height": 1080})
        watch(board, "board")
        # Count the gestures the board receives.
        board.add_init_script("""(() => { const W = window.WebSocket; window.__g = 0;
          window.WebSocket = function (...a) { const ws = new W(...a); ws.addEventListener('message', (e) => { if (String(e.data).includes('"type":"gesture"')) window.__g++; }); return ws; };
          window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, W); })()""")
        board.goto(BASE + "/board/")
        board.wait_for_selector("button.tile")
        phone = br.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        watch(phone, "phone")
        join_deck(phone, a("GET", "/join")["url"], "Klaus")
        a("POST", "/layout", {"seats": 4})
        a("POST", "/ai", {})
        a("POST", "/ai", {})
        a("POST", "/game/select", {"gameId": "card-sling", "settings": {"aiSeconds": 8}})
        phone.click("#ready")
        time.sleep(0.4)
        a("POST", "/game/start", {})
        phone.wait_for_selector(".csd-card")
        board.wait_for_selector(".cs-root .kit-plate")
        time.sleep(0.8)

        card = phone.locator(".csd-card").nth(3)
        b = card.bounding_box()
        x, y = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
        top = phone.evaluate("document.querySelector('.csd').getBoundingClientRect().top")
        # 1. A third out: the card's top goes a third of its height above the game area's top.
        third = y - (b["y"] - top) - b["height"] / 3
        phone.mouse.move(x, y)
        phone.mouse.down()
        steps = 30
        for i in range(1, steps + 1):
            phone.mouse.move(x + 30 * i / steps, y + (third - y) * i / steps)
            time.sleep(0.016)
        time.sleep(0.4)
        phone.screenshot(path=os.path.join(OUT, "sling-1-phone-third.png"))
        board.screenshot(path=os.path.join(OUT, "sling-1-board-third.png"))
        shown = board.evaluate("(() => { const c = [...document.querySelectorAll('.cs-card')].find(e => e.style.visibility === 'visible'); return c ? c.style.transform : null })()")
        print("board slot while a third out:", shown)
        assert shown, "the board shows nothing at the seat"
        # 2. Back down a little and fling it up: it leaves and flies to the pile.
        for i in range(1, 6):
            phone.mouse.move(x + 30, third - 40 * i)
            time.sleep(0.008)
        phone.mouse.up()
        time.sleep(0.22)
        board.screenshot(path=os.path.join(OUT, "sling-2-board-flying.png"))
        time.sleep(0.9)
        board.screenshot(path=os.path.join(OUT, "sling-3-board-landed.png"))
        assert board.locator(".cs-on-pile").count() >= 1, "the card is on the pile"
        assert phone.locator(".csd-card").count() == 6
        # 3. Draw: the card flies to the seat, then comes in at the top of the phone.
        phone.click(".csd-draw")
        time.sleep(0.25)
        board.screenshot(path=os.path.join(OUT, "sling-4-board-draw.png"))
        time.sleep(0.25)
        phone.screenshot(path=os.path.join(OUT, "sling-5-phone-draw.png"))
        time.sleep(0.8)
        assert phone.locator(".csd-card").count() == 7
        print("gestures received by the board:", board.evaluate("window.__g"))
        # 4. An AI player's card flies in from its seat.
        board.wait_for_selector(".cs-flying", timeout=20000)
        time.sleep(0.15)
        board.screenshot(path=os.path.join(OUT, "sling-6-board-ai.png"))
        br.close()
finally:
    proc.terminate()
if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("ok: card sling")
