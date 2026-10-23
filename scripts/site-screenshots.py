"""Screenshots of the public games for the website (D-176): a Table Host with the built-in games and the games of
extra-games plays each game with AI players (and a phone where a game has one), and the boards (1600 x 900), the phones
(500 px wide), the statistics window after a game of Hold'em (D-178) and the Game Viewer with a simulation (D-180)
are saved as WebP in apps/cloud/public/site/.
Needs Pillow and a checkout of extra-games.
  python3 scripts/site-screenshots.py ../extra-games            # every game
  python3 scripts/site-screenshots.py ../extra-games chess      # only some
  python3 scripts/site-screenshots.py ../extra-games statistics # the statistics window after a game of Hold'em
  python3 scripts/site-screenshots.py ../extra-games viewer     # the Game Viewer with a Hold'em simulation
"""
import json, os, shutil, sys, tempfile, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "e2e"))
from PIL import Image
from playwright.sync_api import sync_playwright
from common import call, start_cloud, start_table, wait

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
EXTRA = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(REPO, "..", "extra-games")
ONLY = sys.argv[2:] or None
SITE = os.path.join(REPO, "apps", "cloud", "public", "site")
OUT = tempfile.mkdtemp(prefix="site-shots-")
GAMES = tempfile.mkdtemp(prefix="site-games-")
for g in ["coin-flip", "holdem", "pachisi", "roulette"]:
    os.symlink(os.path.join(REPO, "games", g), os.path.join(GAMES, g))
for g in ["chess", "liars-dice", "backgammon", "mexican-train", "last-card"]:
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
    ("mexican-train", {"rounds": 3, "turnSeconds": 0}, 6, ["Klaus"], 5, 240),
    ("last-card", {"turnSeconds": 0, "tapToPlay": True}, 6, ["Klaus"], 5, 60),
]

# Last Card (extra-games): a point of a card on the phone that no other card covers (the hand overlaps).
SPOT = """e => { const r = e.getBoundingClientRect();
  for (const fy of [0.3, 0.5, 0.15]) for (const fx of [0.3, 0.15, 0.5]) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy, t = document.elementFromPoint(x, y);
    if (t && e.contains(t)) return [x, y]; }
  return null; }"""

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
            if game == "mexican-train":
                # Klaus plays from the phone (a tile that fits, then a highlighted train, else Draw or Done) until the
                # trains have grown, then stops on a turn of theirs with a tile picked: with no turn limit the game
                # waits there, so both looks below show the same moment.
                ph, end = phones[0], time.time() + secs
                while time.time() < end:
                    if ph.locator(".mtd-status.go").count():
                        ok = ph.locator(".mtd-tile.ok")
                        if ok.count():
                            ok.first.click()
                            if board.locator(".mt-root .mt-tile").count() >= 40:
                                break
                            hit = ph.locator(".mtd-train.hit")
                            (hit.first.click(force=True) if hit.count() else ok.first.click())
                        elif ph.locator(".mtd-done:not([hidden])").count():
                            ph.locator(".mtd-done").click()
                        elif ph.locator(".mtd-draw:not([hidden]):not([disabled])").count():
                            ph.locator(".mtd-draw").click()
                    time.sleep(0.4)
                time.sleep(1.5)
            elif game == "last-card":
                # Klaus plays from the phone (a tap plays a card that fits; a wild takes the first colour; else Draw,
                # then Keep) for a while, then stops on a turn of theirs with cards that fit: with no turn limit the
                # game waits there.
                ph, end, plays = phones[0], time.time() + secs, 0
                while time.time() < end:
                    pick = ph.locator(".lcd-pick:not([hidden]) [data-color]")
                    if pick.count():
                        pick.first.click()
                    elif ph.locator(".lcd-card.ok").count() and not ph.locator(".lcd-result:not([hidden])").count():
                        if plays >= 4 and board.locator(".lc-pile > div").count() >= 6:
                            break
                        spot = ph.locator(".lcd-card.ok").first.evaluate(SPOT)
                        if spot:
                            ph.mouse.click(*spot)
                            plays += 1
                    elif ph.locator(".lcd-keep:not([hidden])").count():
                        ph.locator(".lcd-keep").click()
                    elif ph.locator(".lcd-draw:not([disabled])").count() and "your turn" in ph.inner_text(".lcd-status").lower():
                        ph.locator(".lcd-draw").click()
                    time.sleep(0.5)
                time.sleep(2)
            else:
                time.sleep(secs)
            if game == "holdem":
                for _ in range(2):
                    try:
                        phones[0].locator(".he-call:not([disabled])").click(timeout=20000)
                    except Exception as e:
                        print("call", e)
                    time.sleep(4)
            board.screenshot(path=os.path.join(OUT, f"{game}-board.png"))
            if game == "mexican-train":
                # The same moment with other preferences, for the website's demo block (D-186).
                a("POST", "/game/prefs", {"prefs": {"background": "lava", "faces": "numbers"}})
                time.sleep(2.5)
                board.screenshot(path=os.path.join(OUT, "mexican-train-lava-board.png"))
            for ph in phones:
                ph.screenshot(path=os.path.join(OUT, f"{game}-phone.png"))
            if game == "last-card" and phones:
                # The sling (D-189), for the website: a card held half off the top of the phone, and the board showing it
                # coming in at Klaus's seat while the finger is still down.
                ph, end = phones[0], time.time() + 60
                while time.time() < end and not ph.locator(".lcd-card.ok").count():  # until a turn with a card that fits
                    if ph.locator(".lcd-keep:not([hidden])").count():
                        ph.locator(".lcd-keep").click()
                    elif ph.locator(".lcd-draw:not([disabled])").count() and "your turn" in ph.inner_text(".lcd-status").lower():
                        ph.locator(".lcd-draw").click()
                    time.sleep(0.5)
                time.sleep(1.5)
                spot = ph.locator(".lcd-card.ok").first.evaluate(SPOT) if ph.locator(".lcd-card.ok").count() else None
                if spot:
                    x, y = spot
                    ph.mouse.move(x, y)
                    ph.mouse.down()
                    top = 46  # past the top of the phone: the board shows only the part that has left it
                    for k in range(1, 21):
                        ph.mouse.move(x + k * 2, y + (top - 40 - y) * k / 20)
                        time.sleep(0.03)
                    time.sleep(0.8)
                    ph.screenshot(path=os.path.join(OUT, "last-card-sling-phone.png"))
                    board.screenshot(path=os.path.join(OUT, "last-card-sling-board.png"))
                    box = board.evaluate("(() => { const r = document.querySelector('.sling-item')?.getBoundingClientRect(); return r && r.width ? [r.x, r.y, r.width, r.height] : null; })()")
                    with open(os.path.join(OUT, "last-card-sling.json"), "w") as f:
                        json.dump(box, f)
                    for k in range(20, -1, -1):  # back down into the hand: nothing is played
                        ph.mouse.move(x + k * 2, y + (top - 40 - y) * k / 20)
                        time.sleep(0.02)
                    ph.mouse.up()
            for ph in phones:
                ph.close()
            print("shot", game, a("GET", "/state")["phase"])
        # The statistics window (D-140, D-178): eight hands of Hold'em with six AI players, played to the end.
        if not ONLY or "statistics" in ONLY:
            reset()
            a("POST", "/layout", {"seats": 6})
            for _ in range(6):
                a("POST", "/ai", {})
            a("POST", "/game/select", {"gameId": "holdem", "settings": {"hands": 8}})
            time.sleep(1)
            a("POST", "/game/start", {})
            wait(lambda: a("GET", "/state")["phase"] == "finished", 600, "the Hold'em game to end")
            board.click("#stats-button", timeout=60000)
            board.wait_for_selector(".overlay.statistics .stats-panel")
            time.sleep(1)
            board.screenshot(path=os.path.join(OUT, "statistics-board.png"))
            print("shot statistics", [x["title"] for x in a("GET", "/state")["summary"].get("awards", [])])
        # The Game Viewer (D-180): the move list of a Hold'em simulation, twenty games with six AI players, at move 19.
        if not ONLY or "viewer" in ONLY:
            reset()
            a("POST", "/simulation", {"gameId": "holdem", "players": 6, "games": 20, "seed": 42, "settings": {"hands": 10}})
            board.click("#tools-button")
            board.click(".overlay.advanced button[data-adv=logs]")
            board.wait_for_selector(".vtable.logs tbody tr")
            board.locator(".vtable.logs tbody tr").nth(0).click()
            board.wait_for_selector(".vtable.moves tbody tr[data-line]")
            # The page where the second hand starts: the timer between hands moves the game's clock on (D-181).
            board.fill("form.goto input", "19")
            board.click("form.goto button")
            board.wait_for_selector(".vtable.moves tr.target td.n:text-is('19')")
            time.sleep(0.5)
            board.screenshot(path=os.path.join(OUT, "viewer-board.png"))
            board.click("button[data-close]")
            print("shot viewer")
        b.close()
        # The admin console (D-186): a service with extra-games, two tables (one approved by its pairing code, one by
        # an access code), a spare code, a download token, and logs of games and simulations from both tables.
        if not ONLY or "admin" in ONLY:
            CLOUD, ADMIN = "http://127.0.0.1:8178", "site-admin-token-0123456789"
            AUTH = {"authorization": f"Bearer {ADMIN}"}
            repos = os.path.join(OUT, "repos.json")
            with open(repos, "w") as f:
                json.dump({"repos": [{"repo": "klaushofrichter/extra-games", "ref": "production"}]}, f)
            cloud = start_cloud(8178, PUBLIC_URL=CLOUD, ADMIN_TOKEN=ADMIN, GAME_REPOS_FILE=repos, NODE_USE_ENV_PROXY="1",
                                DATA_DIR=tempfile.mkdtemp(prefix="site-cloud-"))
            ad = lambda m, path, body=None: call(CLOUD, m, "/admin/api" + path, body, AUTH)
            wait(lambda: ad("GET", "/repos")["repos"][0].get("bundle"), 60, "extra-games at the service")
            code = ad("POST", "/codes", {"label": "Den", "validity": "year", "scope": {"kind": "repos", "repos": ["klaushofrichter/extra-games"]}})["code"]
            ad("POST", "/codes", {"label": "Office", "validity": "month", "scope": {"kind": "none"}})
            living = start_table(8179, TABLE_KEY="k", TABLE_NAME="Living room", CLOUD_URL=CLOUD, AI_DELAY_MS="100", PUBLIC_URL="http://127.0.0.1:8179")
            den = start_table(8180, TABLE_KEY="k", TABLE_NAME="Den", CLOUD_URL=CLOUD, AI_DELAY_MS="100", TABLE_CODE=code, PUBLIC_URL="http://127.0.0.1:8180")
            tb = lambda port, m, path, body=None: call(f"http://127.0.0.1:{port}", m, "/api/v1" + path, body, {"x-table-key": "k"})
            pairing = wait(lambda: tb(8179, "GET", "/state")["cloud"].get("pairingCode"), 20, "the pairing code")
            ad("POST", f"/tables/pair/{pairing}", {"repos": ["extra-games"]})
            for port in (8179, 8180):
                wait(lambda: tb(port, "GET", "/state")["cloud"]["status"] == "online", 20, "the table to be online")
                wait(lambda: any(g["id"] == "mexican-train" for g in tb(port, "GET", "/games")), 60, "extra-games on the table")
            # A game of AI players on each table, then simulations.
            for port, game, settings in ((8179, "coin-flip", {"rounds": 3, "roundSeconds": 0}), (8180, "liars-dice", {})):
                tb(port, "POST", "/developer", {"allowNoLocalPlayer": True})
                for _ in range(4):
                    tb(port, "POST", "/ai", {})
                tb(port, "POST", "/game/select", {"gameId": game, "settings": settings})
                tb(port, "POST", "/game/start", {})
            tb(8179, "POST", "/simulation", {"gameId": "holdem", "players": 6, "games": 3, "seed": 7})
            tb(8180, "POST", "/simulation", {"gameId": "mexican-train", "players": 4, "games": 2, "seed": 7})
            tb(8179, "POST", "/simulation", {"gameId": "backgammon", "players": 2, "games": 2, "seed": 7})
            wait(lambda: len([l for l in ad("GET", "/logs") if not l["simulation"]]) >= 2, 180, "the played games' logs")
            wait(lambda: all(t["metrics"]["gamesPlayed"] for t in ad("GET", "/tables")), 60, "both tables' games counted")
            ad("POST", "/download-tokens", {"label": "Claude session", "gameId": "mexican-train", "hours": 168})
            ab = p.chromium.launch()  # a fresh browser: the board's has been animating for minutes
            page = ab.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
            page.goto(CLOUD + "/admin")
            page.fill("#token", ADMIN)
            page.click("#signin-form button")
            page.wait_for_selector("#tables tr")
            page.wait_for_timeout(1500)
            # The overview and the tables, then the game logs (the access codes and repositories in between are left
            # out, to keep the picture short).
            page.screenshot(path=os.path.join(OUT, "admin-top.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 640})
            page.locator("section:has(#logs)").screenshot(path=os.path.join(OUT, "admin-logs.png"))
            ab.close()
            for pr in (living, den, cloud):
                pr.terminate()
            print("shot admin")
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
save("mexican-train-lava-board.png", "mexican-train-lava.webp", (1600, 900))
save("last-card-sling-phone.png", "last-card-sling-phone.webp", (500, 1100))
# The board around the incoming card: its seat, and toward the middle of the table (the board is 1920 x 1080).
if os.path.exists(os.path.join(OUT, "last-card-sling.json")):
    box = json.load(open(os.path.join(OUT, "last-card-sling.json")))
    if box:
        cx, cy = box[0] + box[2] / 2, box[1] + box[3] / 2
        cx, cy = cx + (960 - cx) * 0.35, cy + (540 - cy) * 0.35  # a little toward the pile
        w, h = 1120, 630
        l = int(min(max(cx - w / 2, 0), 1920 - w)); t = int(min(max(cy - h / 2, 0), 1080 - h))
        im = Image.open(os.path.join(OUT, "last-card-sling-board.png")).convert("RGB").crop((l, t, l + w, t + h))
        im.save(os.path.join(SITE, "last-card-sling.webp"), "WEBP", quality=82, method=6)
if not ONLY:
    save("lobby-open.png", "lobby.webp", (1600, 900))
# The window and a little of the table around it (the board is 1920 x 1080).
if os.path.exists(os.path.join(OUT, "statistics-board.png")):
    im = Image.open(os.path.join(OUT, "statistics-board.png")).convert("RGB").crop((350, 30, 1570, 1050))
    im.save(os.path.join(SITE, "statistics.webp"), "WEBP", quality=80, method=6)
# The viewer's panel, down to its fifteenth move (the board is 1920 x 1080).
if os.path.exists(os.path.join(OUT, "viewer-board.png")):
    im = Image.open(os.path.join(OUT, "viewer-board.png")).convert("RGB").crop((181, 45, 1739, 820))
    im.thumbnail((1400, 800))
    im.save(os.path.join(SITE, "game-viewer.webp"), "WEBP", quality=82, method=6)
    save("lobby-phone.png", "lobby-phone.webp", (500, 1100))
# The console: its overview and tables, and its game logs below.
if os.path.exists(os.path.join(OUT, "admin-logs.png")):
    top = Image.open(os.path.join(OUT, "admin-top.png")).convert("RGB")
    logs = Image.open(os.path.join(OUT, "admin-logs.png")).convert("RGB")
    im = Image.new("RGB", (top.width, top.height + logs.height + 22), top.getpixel((5, top.height - 5)))
    im.paste(top, (0, 0))
    im.paste(logs, ((top.width - logs.width) // 2, top.height))
    im.thumbnail((1440, 1600))
    im.save(os.path.join(SITE, "admin.webp"), "WEBP", quality=82, method=6)
print(f"saved in {SITE}")
