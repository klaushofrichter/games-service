"""Browser end-to-end check of extra-game repositories (D-097), the whole chain:

  a fake GitHub serves a PRIVATE repository (needs the token) with a game in it
  -> the service lists it from the start, from deploy/game-repos.json (D-098), marked "deploy config", not removable
  -> the console approves a table with the repository ticked
  -> the table's board shows the game, marked "extra"
  -> a remote player, through an invite, sees it on their board too, chooses it and plays it with a local phone
  -> unticking the repository on the table's row removes the game; ticking brings it back
  -> a repository added in the console ("until restart") serves the table instead, and Remove takes the game away

Starts its own fake GitHub, cloud service (development sign-in with ADMIN_TOKEN) and table host.
  python3 scripts/e2e/extra.py out/
"""
import http.server, io, os, re, sys, tarfile, threading, time
from playwright.sync_api import sync_playwright
from common import REPO, api, call, errors, join_deck, start_cloud, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
ADMIN = "admin-token-for-e2e-0002"
TOKEN = "github_pat_e2e_fake_token"
GITHUB_PORT, CLOUD_PORT, TABLE_PORT = 8097, 8098, 8099
CLOUD, TABLE = f"http://127.0.0.1:{CLOUD_PORT}", f"http://127.0.0.1:{TABLE_PORT}"
FIXTURE = os.path.join(REPO, "scripts", "e2e", "fixtures", "extra-repo")
fetches = []


def tarball(sha):
    """The fixture repository as GitHub's tarball endpoint serves it: everything under '<owner>-<name>-<sha>/'."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.PAX_FORMAT) as tar:
        top = f"klaushofrichter-extra-games-{sha}"
        for root, _dirs, files in os.walk(FIXTURE):
            for f in sorted(files):
                path = os.path.join(root, f)
                tar.add(path, arcname=f"{top}/{os.path.relpath(path, FIXTURE)}")
        readme = b"# not a game: stays out of the bundle\n"
        info = tarfile.TarInfo(f"{top}/README.md")
        info.size = len(readme)
        tar.addfile(info, io.BytesIO(readme))
    return buf.getvalue()


class FakeGitHub(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        m = re.match(r"^/repos/klaushofrichter/extra-games/tarball/(production|main)$", self.path)
        # Private: without the token GitHub answers 404, as it does for a private repository.
        if not m or self.headers.get("authorization") != f"Bearer {TOKEN}":
            self.send_response(404)
            self.end_headers()
            return self.wfile.write(b'{"message":"Not Found"}')
        fetches.append(time.time())
        body = tarball("e2e0001")
        self.send_response(200)
        self.send_header("content-type", "application/x-gzip")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


github = http.server.ThreadingHTTPServer(("127.0.0.1", GITHUB_PORT), FakeGitHub)
threading.Thread(target=github.serve_forever, daemon=True).start()
cloud = start_cloud(CLOUD_PORT, ADMIN_TOKEN=ADMIN, PUBLIC_URL=CLOUD, ICE_SERVERS="[]", GAME_REPO_TOKEN=TOKEN,
                    GAME_REPO_API_URL=f"http://127.0.0.1:{GITHUB_PORT}", GAME_REPOS_FILE=os.path.join(REPO, "deploy", "game-repos.json"))
host = start_table(TABLE_PORT, PUBLIC_URL=TABLE, TABLE_KEY="k", TABLE_NAME="Den", CLOUD_URL=CLOUD, AI_DELAY_MS="200")


def t(method, path, body=None):
    return api(method, path, body, base=TABLE, key="k")


def table_games():
    return {g["id"]: g for g in t("GET", "/games")}


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, f"extra-{name}.png"))


try:
    code = wait(lambda: t("GET", "/state")["cloud"].get("pairingCode"), 15, "the pairing code")
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--disable-features=WebRtcHideLocalIpsWithMdns"])

        # ----- console: the deploy-time repository is there from the start -----
        console = b.new_page(viewport={"width": 1400, "height": 1000})
        # Development mode asks /admin/api/me before signing in, which answers 401: expected, as in admin.py.
        watch(console, "console", ignore=("status of 401",))
        console.on("dialog", lambda d: d.accept())  # the Remove confirmation
        console.goto(CLOUD + "/admin")
        console.fill("#token", ADMIN)
        console.click("#signin-form button")
        console.wait_for_selector("#repo-form")
        assert "GAME_REPO_TOKEN" in console.inner_text("#repo-token")
        console.wait_for_selector("#repos >> text=Dice Duel")
        row = console.locator("#repos tr", has_text="extra-games@production")
        assert "deploy config" in row.inner_text() and "commit e2e0001" in row.inner_text(), row.inner_text()
        assert row.locator("button[data-repo-remove]").count() == 0, "a deploy-time repository must not offer Remove"
        assert fetches, "the console never asked GitHub"

        # ----- approve the table with the repository ticked -----
        console.wait_for_selector("#pair-repos input[value=extra-games]")
        console.fill("#pair-code", code)
        console.check("#pair-repos input[value=extra-games]")
        shot(console, "console-approve")
        console.click("#pair-form button.primary")
        console.wait_for_selector("#pair-msg >> text=with games from extra-games")
        wait(lambda: t("GET", "/state")["cloud"]["status"] == "online", 20, "the table online")
        wait(lambda: "dice-duel" in table_games(), 20, "the extra game on the table")
        assert table_games()["dice-duel"].get("extra") is True
        assert "roulette" in table_games() and not table_games()["roulette"].get("extra")
        console.wait_for_selector("[data-table-repos] input[value=extra-games]:checked")
        shot(console, "console-table-row")

        # ----- the local board -----
        board = b.new_page(viewport={"width": 1600, "height": 900})
        watch(board, "local board")
        board.goto(TABLE + "/board/")
        board.wait_for_selector("text=Pick a game")

        def tile_on_board(page_or_frame, gid="dice-duel"):
            """Page through the game tiles looking for gid; True if found (ends on page 1)."""
            loc = page_or_frame.locator
            for _ in range(2):  # the pager may need to wrap around from wherever it was
                while loc(".pager button[data-page='-1']").count() and loc(".pager button[data-page='-1']").is_enabled():
                    loc(".pager button[data-page='-1']").click()
                for _ in range(10):
                    if loc(f"button.tile[data-game={gid}]").count():
                        return True
                    nxt = loc(".pager button[data-page='1']")
                    if not nxt.count() or not nxt.is_enabled():
                        break
                    nxt.click()
            return False

        assert wait(lambda: tile_on_board(board), 10, "the Dice Duel tile on the local board")
        assert "extra" in board.inner_text("button.tile[data-game=dice-duel]")
        shot(board, "local-board-tile")

        # ----- untick and tick again on the table's row -----
        console.uncheck("[data-table-repos] input[value=extra-games]")
        wait(lambda: "dice-duel" not in table_games(), 20, "the game to leave the table")
        wait(lambda: not tile_on_board(board), 10, "the tile to leave the board")
        console.check("[data-table-repos] input[value=extra-games]")
        wait(lambda: "dice-duel" in table_games(), 20, "the game to come back")

        # ----- a remote player sees and plays it -----
        local = b.new_context(viewport={"width": 390, "height": 844}).new_page()
        watch(local, "local phone")
        join_deck(local, t("GET", "/join")["url"], "Klaus")
        board.click("button[data-invite]")
        board.wait_for_selector(".invite-body .code")
        invite = board.inner_text(".invite-body .code").strip()
        board.click(".invite button[data-x=close]")
        remote = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
        watch(remote, "remote")
        remote.goto(f"{CLOUD}/i/{invite}")
        remote.fill("#join input[name=name]", "Rita")
        remote.click("#join button[type=submit]")
        remote.wait_for_selector("#play:not([hidden])", timeout=30000)
        # The remote board is a frame of the invite page, filled over the WebRTC channel.
        rboard = remote.frame_locator("#board")
        rboard.locator("text=Pick a game").wait_for(timeout=30000)
        assert wait(lambda: tile_on_board(rboard), 10, "the Dice Duel tile on the remote board")
        shot(remote, "remote-board-tile")
        # The remote player chooses it (choosing games is on the remote allowlist, D-057).
        rboard.locator("button.tile[data-game=dice-duel]").click()
        rboard.locator(".dialog [data-x=yes]").click()
        wait(lambda: (t("GET", "/state").get("game") or {}).get("id") == "dice-duel", 10, "Dice Duel chosen")
        rdeck = remote.frame_locator("#deck")
        rdeck.locator("#ready").click()
        local.click("#ready")
        wait(lambda: all(p_["ready"] for p_ in t("GET", "/state")["players"] if p_["seat"] is not None), 10, "everyone ready")
        t("POST", "/game/start")
        rdeck.locator(".dd-roll").click(timeout=20000)
        local.locator(".dd-roll").click(timeout=20000)
        wait(lambda: t("GET", "/state")["phase"] == "finished", 20, "the game to finish")
        summary = t("GET", "/state")["summary"]["text"]
        assert re.search(r"rolled [1-6]\.$", summary), summary
        time.sleep(0.6)
        shot(remote, "remote-played")
        shot(board, "local-board-played")
        t("POST", "/game/close")

        # ----- a repository added in the console lasts until the restart, and Remove takes it away -----
        console.fill("#repo-name", "klaushofrichter/extra-games")
        console.fill("#repo-ref", "main")
        console.click("#repo-form button")
        console.wait_for_selector("#repos >> text=extra-games@main")
        added = console.locator("#repos tr", has_text="extra-games@main")
        assert "until restart" in added.inner_text(), added.inner_text()
        console.uncheck("[data-table-repos] input[value=extra-games]")
        console.check("[data-table-repos] input[value=extra-games-2]")
        wait(lambda: "dice-duel" in table_games() and console.locator("[data-table-repos] input[value=extra-games]:not(:checked)").count(), 20, "the game from the console-added repository")
        shot(console, "console-added")
        console.click("button[data-repo-remove=extra-games-2]")
        wait(lambda: "dice-duel" not in table_games(), 20, "the game to leave after Remove")
        console.wait_for_selector("#repos >> text=extra-games@production")
        assert console.locator("#repos >> text=extra-games@main").count() == 0
        shot(console, "console-removed")
        b.close()
finally:
    host.terminate()
    cloud.terminate()
    github.shutdown()

if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print(f"ok: extra-game repositories: deploy-time list, installed at approval, shown and played remotely, console-added one removed; screenshots in {OUT}")
