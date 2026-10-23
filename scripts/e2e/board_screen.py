"""Browser check of the board on another screen (D-190): an iPad opens the board's link and takes the board over; the
table's own window says where it went and takes it back. The iPad is a browser reaching the table through a small relay
that connects from 127.0.0.2, so the table sees another device on its network, not its own computer.

  - another device gets no board without the link, nor with a wrong key;
  - the board's settings show the link and its QR code;
  - the link moves the board to the screen, and the screen keeps it after a reload (it is remembered);
  - the table's window shows "The board moved to another screen" with the screen's address, and "Show the board
    here" brings it back; the screen then says it moved back to the table's computer.

  python3 scripts/e2e/board_screen.py out/
"""
import os, socket, sys, threading, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
from common import errors, start_table, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
PORT = 8136
RELAY = 8137
KEY = "screen-e2e-key"
HOME = f"http://127.0.0.1:{PORT}"
SCREEN = f"http://127.0.0.2:{RELAY}"  # another device on the table's network, as far as the table can tell


def relay():
    """127.0.0.2:RELAY → the table, connecting from 127.0.0.2 (HTTP and WebSockets alike)."""
    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.2", RELAY))
    srv.listen(32)

    def pipe(a, b):
        try:
            while data := a.recv(65536):
                b.sendall(data)
        except OSError:
            pass
        finally:
            for x in (a, b):
                try:
                    x.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def serve():
        while True:
            c, _ = srv.accept()
            u = socket.socket()
            u.bind(("127.0.0.2", 0))
            u.connect(("127.0.0.1", PORT))
            threading.Thread(target=pipe, args=(c, u), daemon=True).start()
            threading.Thread(target=pipe, args=(u, c), daemon=True).start()

    threading.Thread(target=serve, daemon=True).start()
CHROMIUM = os.environ.get("CHROMIUM_PATH")


DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # straight to the table, never through a proxy


def status(url):
    try:
        return DIRECT.open(url, timeout=5).status
    except urllib.error.HTTPError as e:
        return e.code


proc = start_table(PORT, TABLE_KEY=KEY, PUBLIC_URL=SCREEN)
relay()
try:
    assert status(f"{SCREEN}/board/") == 403, "another device got the board without the link"
    assert status(f"{SCREEN}/board/screen?key=wrong") == 403, "a wrong key opened the board"
    with sync_playwright() as p:
        br = p.chromium.launch(**({"executable_path": CHROMIUM} if CHROMIUM else {}))
        home = br.new_page(viewport={"width": 1920, "height": 1080})
        watch(home, "table's window")
        home.goto(HOME + "/board/")
        home.wait_for_selector("button.tile")

        # The link and its QR code in the board's settings.
        home.click("#settings-button")
        home.click("button[data-screen]")
        home.wait_for_selector(".overlay.join-code img")
        home.wait_for_function("document.querySelector('.overlay.join-code img').complete && document.querySelector('.overlay.join-code img').naturalWidth > 0")
        link = home.inner_text(".overlay.join-code .join-big")
        assert f"{SCREEN}/board/screen?key=" in link, link
        home.screenshot(path=os.path.join(OUT, "screen-link.png"))
        home.click(".overlay.join-code [data-close-overlay]")
        home.click(".overlay.settings [data-close-overlay]")

        # The iPad opens the link: it gets the board at once, and the table's window says where it went.
        ipad_ctx = br.new_context(viewport={"width": 1180, "height": 820}, device_scale_factor=2, has_touch=True)
        ipad = ipad_ctx.new_page()
        watch(ipad, "iPad")
        ipad.goto(f"{SCREEN}/board/screen?key={KEY}")
        ipad.wait_for_selector("button.tile")
        assert "key=" not in ipad.url and "#screen" not in ipad.url, ipad.url
        home.wait_for_selector("text=The board moved to another screen")
        assert "127.0.0.2" in home.inner_text("body")
        home.screenshot(path=os.path.join(OUT, "screen-home-moved.png"))
        ipad.screenshot(path=os.path.join(OUT, "screen-ipad.png"))

        # Remembered: the iPad loads the board again without the link (the table window keeps its notice).
        ipad.goto(f"{SCREEN}/board/")
        ipad.wait_for_selector("button.tile")
        assert ipad.locator("text=board is only served").count() == 0

        # The table's computer takes it back; the iPad says so.
        home.click("button[data-elsewhere=here]")
        home.wait_for_selector("button.tile")
        ipad.wait_for_selector("text=The board moved back to the table's computer")
        ipad.screenshot(path=os.path.join(OUT, "screen-ipad-back.png"))
        br.close()
finally:
    proc.terminate()
if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("ok: the board on another screen")
