"""Browser end-to-end check of the cloud admin portal with Google sign-in: anonymous visitors land on the public
page; a signed-in admin approves a waiting table, issues a download token and changes retention; logout really
logs out (200 signed-out page with a Sign in link, cookie gone, /admin no longer reachable). A second pass checks the
development mode (no Google, ADMIN_TOKEN only). Starts its own cloud services and table host.
  python3 scripts/e2e/admin.py out/

Google itself is not contacted: the test signs a session cookie with the service's COOKIE_SECRET, exactly as the
callback does after Google confirms an allowed account (the callback is covered by tests/auth.test.ts).
"""
import base64, hashlib, hmac, json, os, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
CLOUD = "http://127.0.0.1:8093"
SECRET = "e2e-cookie-secret-" + "0" * 40
ADMIN_EMAIL = "admin@example.com"
errors = []


def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def session_cookie(email, secret=SECRET):
    payload = b64u(json.dumps({"e": email, "x": int(time.time() * 1000) + 3600_000}, separators=(",", ":")).encode())
    return payload + "." + b64u(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest())


def wait_http(url):
    for _ in range(60):
        try:
            urllib.request.urlopen(url, timeout=1)
            return
        except Exception:
            time.sleep(0.25)
    raise RuntimeError(f"{url} did not come up")


google_env = dict(GOOGLE_CLIENT_ID="40017202035-e2e.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET="e2e",
                  GOOGLE_REDIRECT_URI=CLOUD + "/auth/google/callback", ALLOWED_EMAILS=ADMIN_EMAIL, COOKIE_SECRET=SECRET)
cloud = subprocess.Popen(["node", "apps/cloud/src/main.ts"], cwd=REPO, env=dict(os.environ, PORT="8093", PUBLIC_URL=CLOUD, **google_env))
wait_http(CLOUD + "/health")
data = tempfile.mkdtemp(prefix="admin-e2e-")
host = subprocess.Popen(["node", "apps/table-host/src/main.ts"], cwd=REPO,
                        env=dict(os.environ, PORT="8094", TABLE_KEY="k", TABLE_NAME="Living room", CLOUD_URL=CLOUD, DATA_DIR=data))
wait_http("http://127.0.0.1:8094/health")
time.sleep(1.5)


def state():
    req = urllib.request.Request("http://127.0.0.1:8094/api/v1/state", headers={"x-table-key": "k"})
    return json.loads(urllib.request.urlopen(req).read())


def watch(page):
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))


try:
    code = state()["cloud"]["pairingCode"]
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        watch(page)

        # Anonymous: /admin goes to the public page, which offers Google sign-in.
        page.goto(CLOUD + "/admin")
        assert page.url == CLOUD + "/", page.url
        assert page.get_attribute("a.btn", "href") == "/auth/google/login"
        page.screenshot(path=os.path.join(OUT, "admin-anonymous.png"))

        # Signed in (the cookie Google's callback would have set).
        ctx.add_cookies([{"name": "games_admin", "value": session_cookie(ADMIN_EMAIL), "url": CLOUD, "httpOnly": True, "sameSite": "Lax"}])
        page.goto(CLOUD + "/admin")
        page.wait_for_selector(f"#who:has-text('{ADMIN_EMAIL}')")
        page.wait_for_selector(f"text={code}")
        page.screenshot(path=os.path.join(OUT, "admin-pending.png"))
        page.fill("#pair-code", code.lower())
        page.click("#pair-form button")
        page.wait_for_selector("#pair-msg.ok")
        for _ in range(40):
            if state()["cloud"]["status"] == "online":
                break
            time.sleep(0.5)
        assert state()["cloud"]["status"] == "online", state()["cloud"]
        page.wait_for_timeout(1000)
        page.reload()
        page.wait_for_selector(".pill.approved")
        page.fill("#dl-game", "roulette")
        page.click("#dl-form button")
        page.wait_for_selector("#dl-msg .mono")
        page.fill("#ret-days", "30")
        page.click("#ret-form button")
        page.wait_for_selector("#ret-msg.ok")
        page.screenshot(path=os.path.join(OUT, "admin-approved.png"), full_page=True)

        # Logout really logs out: a 200 page with a Sign in link, the cookie gone, /admin closed again.
        page.click("#signout")
        page.wait_for_selector("text=You are signed out")
        assert page.url == CLOUD + "/?signed-out=1", page.url
        assert page.get_attribute("a.btn", "href") == "/auth/google/login"
        assert not [c for c in ctx.cookies() if c["name"] == "games_admin"], ctx.cookies()
        page.screenshot(path=os.path.join(OUT, "admin-signed-out.png"))
        page.go_back()
        page.wait_for_load_state()
        assert not page.is_visible("#app"), "the back button brought the portal back"
        page.goto(CLOUD + "/admin")
        assert page.url == CLOUD + "/", page.url

        # A cookie for someone not on the allow-list does not open the portal.
        ctx.add_cookies([{"name": "games_admin", "value": session_cookie("someone@example.com"), "url": CLOUD}])
        page.goto(CLOUD + "/admin")
        assert page.url == CLOUD + "/", page.url
        b.close()
finally:
    host.terminate()
    cloud.terminate()

# Development mode: no Google, the portal asks for ADMIN_TOKEN.
DEV = "http://127.0.0.1:8097"
dev = subprocess.Popen(["node", "apps/cloud/src/main.ts"], cwd=REPO, env=dict(os.environ, PORT="8097", PUBLIC_URL=DEV, ADMIN_TOKEN="admin-token-for-e2e-0001"))
try:
    wait_http(DEV + "/health")
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page()
        page.on("console", lambda m: m.type == "error" and "status of 401" not in m.text and errors.append(m.text))
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(DEV + "/admin")
        page.fill("#token", "wrong-token")
        page.click("#signin-form button")
        page.wait_for_selector("#signin-msg:has-text('not accepted')")
        page.fill("#token", "admin-token-for-e2e-0001")
        page.click("#signin-form button")
        page.wait_for_selector("#metrics .tile")
        page.click("#signout")
        page.wait_for_selector("#signin-form")
        b.close()
finally:
    dev.terminate()

if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("ok: admin portal")
