"""Helpers shared by the browser end-to-end checks (play.py, layout.py, admin.py, remote.py).
The scripts run as `python3 scripts/e2e/<name>.py`, so this module is importable as `common`.
"""
import json, os, subprocess, tempfile, time, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# the dev Table Host that run-all.sh starts for play.py and layout.py
BASE = os.environ.get("BASE", "http://127.0.0.1:8090")
KEY = os.environ.get("TABLE_KEY", "devkey")
# browser console errors and uncaught exceptions, collected by watch()
errors = []


def call(base, method, path, body=None, headers=None):
    """A JSON request; returns the parsed answer ({} when empty)."""
    req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b"{}")


def api(method, path, body=None, base=BASE, key=KEY):
    """The board control API of a Table Host."""
    return call(base, method, "/api/v1" + path, body, {"x-table-key": key})


def watch(page, label, ignore=()):
    """Record the page's console errors and uncaught exceptions in `errors`, except messages containing an `ignore` text."""
    def console(m):
        if m.type == "error" and not any(i in m.text for i in ignore):
            errors.append(f"{label}: {m.text}")
    page.on("console", console)
    page.on("pageerror", lambda e: errors.append(f"{label}: {e}"))


def wait(fn, secs=20, what="condition"):
    """Poll fn until it returns something truthy and return that; fail after secs."""
    end = time.time() + secs
    while True:
        v = fn()
        if v:
            return v
        if time.time() > end:
            raise AssertionError(f"timed out waiting for {what}")
        time.sleep(0.1)


def wait_http(url, secs=15):
    """Wait until url answers (e.g. a service's /health)."""
    def up():
        try:
            urllib.request.urlopen(url, timeout=1)
            return True
        except Exception:
            return False
    wait(up, secs, url)


def start_cloud(port, **env):
    """Start a cloud service on port and wait for its /health. No deploy-time game repositories unless a check asks
    for them (GAME_REPOS_FILE), so the checks never reach the real GitHub."""
    env.setdefault("GAME_REPOS_FILE", "none")
    proc = subprocess.Popen(["node", "apps/cloud/src/main.ts"], cwd=REPO, env=dict(os.environ, PORT=str(port), **env))
    wait_http(f"http://127.0.0.1:{port}/health")
    return proc


def start_table(port, **env):
    """Start a Table Host on port with a fresh data directory and wait for its /health."""
    env.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="e2e-table-"))
    proc = subprocess.Popen(["node", "apps/table-host/src/main.ts"], cwd=REPO, env=dict(os.environ, PORT=str(port), **env))
    wait_http(f"http://127.0.0.1:{port}/health")
    return proc


def join_deck(page, url, name, on_form=None):
    """Open a join URL on a phone page, join by name and wait for the lobby (name line). on_form(page) runs on the join form."""
    page.goto(url)
    if on_form:
        on_form(page)
    page.fill("input[name=name]", name)
    page.click("button[type=submit]")
    page.wait_for_selector(".who h1")
    return page


def reset(base=BASE, key=KEY):
    """Back to an empty idle lobby facing south: end and close any game, remove every player."""
    st = api("GET", "/state", base=base, key=key)
    if st["phase"] in ("active", "paused"):
        api("POST", "/game/end", {}, base=base, key=key)
        wait(lambda: api("GET", "/state", base=base, key=key)["phase"] not in ("active", "paused"), 5, "the game to end")
    if api("GET", "/state", base=base, key=key)["phase"] != "idle":
        api("POST", "/game/close", {}, base=base, key=key)
    for p in api("GET", "/state", base=base, key=key)["players"]:
        api("DELETE", f"/players/{p['id']}", base=base, key=key)
    if api("GET", "/state", base=base, key=key)["frontEdge"] != "south":
        api("POST", "/rotate", {"degrees": 180}, base=base, key=key)


def pick_game(page, game_id):
    """Click a game's tile on the board, paging through the games until it is shown."""
    tile = page.locator(f"button.tile[data-game={game_id}]")
    for _ in range(10):
        if tile.count():
            return tile.click()
        page.locator(".pager button[data-page='1']").click()
    raise AssertionError(f"no tile for {game_id} on any page")
