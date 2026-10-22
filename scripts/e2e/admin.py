"""Browser end-to-end check of the cloud admin portal with Google sign-in: anonymous visitors land on the public
page; a signed-in admin approves a waiting table, issues a download token and changes retention; logout really
logs out (200 signed-out page with a Sign in link, cookie gone, /admin no longer reachable). A second pass checks the
development mode (no Google, ADMIN_TOKEN only). Starts its own cloud services and table host.
  python3 scripts/e2e/admin.py out/

Google itself is not contacted: the test signs a session cookie with the service's COOKIE_SECRET, exactly as the
callback does after Google confirms an allowed account (the callback is covered by tests/auth.test.ts).
"""
import base64, hashlib, hmac, json, os, sys, time
from playwright.sync_api import sync_playwright
from common import api, errors, start_cloud, start_table, wait, watch

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


google_env = dict(GOOGLE_CLIENT_ID="40017202035-e2e.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET="e2e",
                  GOOGLE_REDIRECT_URI=CLOUD + "/auth/google/callback", ALLOWED_EMAILS=ADMIN_EMAIL, COOKIE_SECRET=SECRET)
cloud = start_cloud(8093, PUBLIC_URL=CLOUD, **google_env)
host = start_table(8094, TABLE_KEY="k", TABLE_NAME="Living room", CLOUD_URL=CLOUD)


def state():
    return api("GET", "/state", base="http://127.0.0.1:8094", key="k")


try:
    code = wait(lambda: state()["cloud"].get("pairingCode"), 15, "the pairing code")
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        watch(page, "admin")

        # Anonymous: /admin goes to the public page, which offers Google sign-in.
        page.goto(CLOUD + "/admin")
        assert page.url == CLOUD + "/", page.url
        assert page.get_attribute("#admin-link", "href") == "/auth/google/login"
        page.screenshot(path=os.path.join(OUT, "admin-anonymous.png"))

        # Signed in (the cookie Google's callback would have set).
        ctx.add_cookies([{"name": "games_admin", "value": session_cookie(ADMIN_EMAIL), "url": CLOUD, "httpOnly": True, "sameSite": "Lax"}])
        page.goto(CLOUD + "/admin")
        page.wait_for_selector(f"#who:has-text('{ADMIN_EMAIL}')")
        # Top bar: the icon (actually loaded), "Game Table Console" linked to the repository, and the version.
        assert page.get_attribute("header a.brand", "href") == "https://github.com/klaushofrichter/games-service"
        assert page.inner_text("header a.brand h1") == "Game Table Console"
        assert page.eval_on_selector("header a.brand img", "i => i.complete && i.naturalWidth > 0"), "favicon did not load"
        assert page.inner_text("header .version") == "dev", page.inner_text("header .version")
        assert page.eval_on_selector("link[rel=icon]", "l => l.href").endswith("/favicon.svg")
        page.wait_for_selector(f"text={code}")
        page.screenshot(path=os.path.join(OUT, "admin-pending.png"))
        page.fill("#pair-code", code.lower())
        page.click("#pair-form button")
        page.wait_for_selector("#pair-msg.ok")
        wait(lambda: state()["cloud"]["status"] == "online", 20, "the table to come online")
        page.wait_for_timeout(1000)
        page.reload()
        page.wait_for_selector(".pill.approved")
        page.fill("#dl-game", "roulette")
        page.click("#dl-form button")
        page.wait_for_selector("#dl-msg .mono")
        # the copy button puts exactly the shown link on the clipboard
        ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=CLOUD)
        page.click("#dl-copy")
        page.wait_for_selector("#dl-copy.done")
        link = page.inner_text("#dl-url")
        assert "/dl/" in link and page.evaluate("() => navigator.clipboard.readText()") == link, "copy button"
        # Disconnect, then Reconnect: the same table comes back online without a new pairing code (D-085)
        page.once("dialog", lambda d: d.accept())
        page.click("button[data-revoke]")
        page.wait_for_selector(".pill.revoked")
        wait(lambda: state()["cloud"]["status"] == "revoked", 20, "the table to see the disconnect")
        page.click("button[data-reconnect]")
        page.wait_for_selector(".pill.approved")
        wait(lambda: state()["cloud"]["status"] == "online", 30, "the table to reconnect")
        page.fill("#ret-days", "30")
        page.click("#ret-form button")
        page.wait_for_selector("#ret-msg.ok")
        page.screenshot(path=os.path.join(OUT, "admin-approved.png"), full_page=True)
        # D-105: scrollbars in the felt colours, not white. Fill the Game logs box past its height so it scrolls.
        box = page.locator("#logs").locator("xpath=ancestor::div[1]")
        page.evaluate("""() => { const t = document.getElementById('logs');
          t.innerHTML = Array.from({ length: 30 }, (_, k) => `<tr><td>log ${k}</td><td>-</td><td>-</td><td></td></tr>`).join(''); }""")
        assert box.evaluate("(e) => e.scrollHeight > e.clientHeight"), "the Game logs box should scroll"
        colors = box.evaluate("(e) => getComputedStyle(e).scrollbarColor")
        assert colors == "rgb(47, 100, 87) rgb(15, 42, 36)", f"Game logs scrollbar colours: {colors}"
        assert page.evaluate("() => getComputedStyle(document.documentElement).colorScheme") == "dark"
        box.screenshot(path=os.path.join(OUT, "admin-logs-scrollbar.png"))

        # Logout really logs out: a 200 page with a Sign in link, the cookie gone, /admin closed again.
        page.click("#signout")
        page.wait_for_selector("text=You are signed out")
        assert page.url == CLOUD + "/?signed-out=1", page.url
        assert page.get_attribute("#admin-link", "href") == "/auth/google/login"
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
dev = start_cloud(8097, PUBLIC_URL=DEV, ADMIN_TOKEN="admin-token-for-e2e-0001")
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page()
        watch(page, "dev admin", ignore=("status of 401",))
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
