"""Screenshots of the public games for the website (D-176): a Table Host with the built-in games and the games of
extra-games plays each game with AI players (and a phone where a game has one), and the boards (1600 x 900) and phones
(500 px wide) are saved as WebP in apps/cloud/public/site/. Needs Pillow and a checkout of extra-games.
  python3 scripts/site-screenshots.py ../extra-games            # every game
  python3 scripts/site-screenshots.py ../extra-games chess      # only some
"""
import os, shutil, sys, tempfile, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "e2e"))
from PIL import Image
from playwright.sync_api import sync_playwright
from common import call, start_table

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
EXTRA = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(REPO, "..", "extra-games")
ONLY = sys.argv[2:] or None
SITE = os.path.join(REPO, "apps", "cloud", "public", "site")
OUT = tempfile.mkdtemp(prefix="site-shots-")
GAMES = tempfile.mkdtemp(prefix="site-games-")
for g in ["coin-flip", "holdem", "pachisi", "roulette"]:
    os.symlink(os.path.join(REPO, "games", g), os.path.join(GAMES, g))
for g in ["chess", "liars-dice", "backgammon"]:
    os.symlink(os.path.join(EXTRA, "games", g), os.path.join(GAMES, g))
PORT = 8177
BASE = f"http://127.0.0.1:{PORT}"
proc = start_table(PORT, TABLE_KEY="k", PUBLIC_URL="http://192.168.1.20:8080", AI_DELAY_MS="350",
                   GAMES_DIR=GAMES, TABLE_NAME="Game Table")


def a(method, path, body=None):
    return call(BASE, method, "/api/v1" + path, body, {"x-table-key": "k"})


def reset():
    st = a("GET", "/state")
    if st["phase"] in ("active", "paused"):
        a("POST", "/game/end", {})
        time.sleep(1)
    if a("GET", "/state")["phase"] != "idle":
        a("POST", "/game/close", {})
    for p in a("GET", "/state")["players"]:
        try:
            a("DELETE", f"/players/{p['id']}")
        except Exception:
            pass


# game, settings, seats, humans (phone names), ais, seconds to wait after start
PLAN = [
    ("roulette", {}, 6, ["Klaus"], 4, 9),
    ("holdem", {}, 6, ["Klaus"], 5, 4),
    ("pachisi", {}, 4, [], 4, 25),
    ("coin-flip", {"rounds": 5}, 6, ["Klaus"], 4, 4),
    ("chess", {}, 2, [], 2, 9),
    ("liars-dice", {}, 4, ["Klaus"], 3, 6),
    ("backgammon", {}, 2, [], 2, 11),
]

try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        board = b.new_page(viewport={"width": 1920, "height": 1080})
        board.goto(BASE + "/board/")
        board.wait_for_selector("text=Pick a game")
        board.add_style_tag(content="#tools-button.dev::after { display: none !important; }")
        # A lobby with free seats and the QR code (the AI-only games below need the developer setting, D-118; its
        # DEV tag is hidden above).
        if not ONLY:
            a("POST", "/layout", {"seats": 8})
            ph = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
            ph.goto(a("GET", "/join")["url"].replace("192.168.1.20:8080", f"127.0.0.1:{PORT}"))
            ph.fill("input[name=name]", "Klaus")
            ph.click("button[type=submit]")
            ph.wait_for_selector(".who h1")
            for _ in range(3):
                a("POST", "/ai", {})
            a("POST", "/game/select", {"gameId": "holdem", "settings": {}})
            time.sleep(1.5)
            board.screenshot(path=os.path.join(OUT, "lobby-open.png"))
            ph.screenshot(path=os.path.join(OUT, "lobby-phone.png"))
            ph.close()
        a("POST", "/developer", {"allowNoLocalPlayer": True})
        for game, settings, seats, humans, ais, secs in PLAN:
            if ONLY and game not in ONLY:
                continue
            reset()
            try:
                a("POST", "/layout", {"seats": seats})
            except Exception as e:
                print("layout", game, e)
            phones = []
            for name in humans:
                ph = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
                ph.goto(a("GET", "/join")["url"].replace("192.168.1.20:8080", f"127.0.0.1:{PORT}"))
                ph.fill("input[name=name]", name)
                ph.click("button[type=submit]")
                ph.wait_for_selector(".who h1")
                phones.append(ph)
            for _ in range(ais):
                a("POST", "/ai", {})
            a("POST", "/game/select", {"gameId": game, "settings": settings})
            for ph in phones:
                ph.click("#ready")
            time.sleep(1.5)
            board.screenshot(path=os.path.join(OUT, f"{game}-lobby.png"))
            if phones:
                phones[0].screenshot(path=os.path.join(OUT, f"{game}-phone-lobby.png"))
            a("POST", "/game/start", {})
            time.sleep(secs)
            if game == "holdem":
                for _ in range(2):
                    try:
                        phones[0].locator(".he-call:not([disabled])").click(timeout=20000)
                    except Exception as e:
                        print("call", e)
                    time.sleep(4)
            board.screenshot(path=os.path.join(OUT, f"{game}-board.png"))
            for ph in phones:
                ph.screenshot(path=os.path.join(OUT, f"{game}-phone.png"))
                ph.close()
            print("shot", game, a("GET", "/state")["phase"])
        b.close()
finally:
    proc.terminate()
    shutil.rmtree(GAMES, ignore_errors=True)


def save(name, out, size):
    path = os.path.join(OUT, name)
    if os.path.exists(path):
        im = Image.open(path).convert("RGB")
        im.thumbnail(size)
        im.save(os.path.join(SITE, out), "WEBP", quality=80, method=6)


for game, *_ in PLAN:
    save(f"{game}-board.png", f"{game}.webp", (1600, 900))
    save(f"{game}-phone.png", f"{game}-phone.webp", (500, 1100))
if not ONLY:
    save("lobby-open.png", "lobby.webp", (1600, 900))
    save("lobby-phone.png", "lobby-phone.webp", (500, 1100))
print(f"saved in {SITE}")
