"""Browser check of the public website (D-176): the page at "/" of a cloud service, at a desktop and a phone width.
No console errors and no horizontal scrolling; every image loads; the admin link sits in the top right corner; the
game cards open the close-up and the filters narrow them; the lobby demo steps through its scenes; the signed-out note
shows after logout's redirect. Screenshots of the hero and each section.
Starts its own cloud service (port 8189).
  python3 scripts/e2e/website.py out/
"""
import os, sys
from playwright.sync_api import sync_playwright
from common import errors, start_cloud, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
BASE = "http://127.0.0.1:8189"
proc = start_cloud(8189, ADMIN_TOKEN="w" * 20, PUBLIC_URL=BASE, APP_VERSION="2026.10.21.9")

try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for width, height in [(1440, 900), (390, 844)]:
            page = b.new_page(viewport={"width": width, "height": height})
            watch(page, f"website {width}")
            page.goto(BASE + "/")
            page.wait_for_selector("h1")
            page.evaluate("document.documentElement.style.scrollBehavior = 'auto'")  # jumps, not smooth scrolling
            assert page.locator("text=2026.10.21.9").count() == 1, "the version label"
            # Scroll through so every lazy image loads and every section reveals.
            for y in range(0, page.evaluate("document.body.scrollHeight"), 500):
                page.evaluate(f"window.scrollTo(0, {y})")
                page.wait_for_timeout(120)
            page.wait_for_timeout(800)
            broken = page.evaluate("[...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute('src')).map((i) => i.src)")
            assert not broken, f"images that did not load: {broken}"
            wide = page.evaluate("document.documentElement.scrollWidth - innerWidth")
            assert wide <= 0, f"the page scrolls sideways by {wide}px at {width}px"
            hidden = page.evaluate("[...document.querySelectorAll('.rv')].filter((e) => getComputedStyle(e).opacity === '0').length")
            assert hidden == 0, f"{hidden} elements never revealed at {width}px"
            # The PREVIEW / DRAFT sash (D-177) stays in the top right corner while one scrolls, and its band covers
            # neither the admin link nor the GitHub link: each corner of theirs lies on the page's side of the band.
            sash = page.locator(".preview-sash").bounding_box()
            assert sash and sash["y"] == 0 and abs(sash["x"] + sash["width"] - width) < 1, f"the sash is not in the corner: {sash}"
            clear = page.evaluate("""() => {
                const band = document.querySelector('.preview-sash span'), r = band.getBoundingClientRect();
                const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
                const half = band.offsetHeight * new DOMMatrix(getComputedStyle(band.parentElement).transform).a / 2;
                const gap = (sel) => { const a = document.querySelector(sel).getBoundingClientRect();
                    return Math.min(...[[a.left, a.top], [a.right, a.top], [a.left, a.bottom], [a.right, a.bottom]].map(([x, y]) => ((y - cy) - (x - cx)) / Math.SQRT2 - half)); };
                return { admin: gap('#admin-link'), github: gap('.top .gh') };
            }""")
            assert clear["admin"] > 4 and (clear["github"] > 4 or not page.locator(".top .gh").is_visible()), f"the sash covers the top bar at {width}px: {clear}"
            if width >= 1000:
                page.evaluate("window.scrollTo(0, 0)")
                page.wait_for_timeout(400)
                box = page.locator("#admin-link").bounding_box()
                assert box and box["x"] > width * 0.8 and box["y"] < 60, f"the admin link is not in the top right corner: {box}"
                assert page.get_attribute("#admin-link", "href") == "/admin"
                page.screenshot(path=os.path.join(OUT, "website-hero.png"))
                # The games: filters and the close-up.
                page.locator("#games").scroll_into_view_if_needed()
                page.click(".filters [data-f=extra]")
                assert page.locator(".game:not(.hide)").count() == 3, "extra-games has three games"
                page.click(".filters [data-f=built-in]")
                assert page.locator(".game:not(.hide)").count() == 4, "four built-in games"
                page.click(".filters [data-f=all]")
                page.click(".game[data-i='0']")
                page.wait_for_selector("#lightbox.open")
                assert page.inner_text("#lb-name") == "Hold'em"
                page.screenshot(path=os.path.join(OUT, "website-game.png"))
                page.keyboard.press("Escape")
                page.wait_for_selector("#lightbox.open", state="detached")
                # Statistics and awards (D-178): the real window's screenshot, and one game's awards at a time.
                page.locator("#awards").scroll_into_view_if_needed()
                assert page.locator("#awards [data-aw-list]:visible").count() == 1, "one game's awards"
                page.click("#awards [data-aw=chess]")
                assert page.locator("#awards [data-aw-list=chess]:visible >> text=Homebody").count() == 1, "the chess awards"
                assert page.locator("#awards [data-aw-list=holdem]:visible").count() == 0
                page.screenshot(path=os.path.join(OUT, "website-awards.png"))
                # The lobby demo: a click on a step shows its scene.
                page.locator("#demo").scroll_into_view_if_needed()
                page.click(".step[data-i='5']")
                page.wait_for_selector("#mini-eye.on")
                page.click(".step[data-i='6']")
                page.wait_for_selector("#mini-deck.on")
                page.locator("#demo").screenshot(path=os.path.join(OUT, "website-lobby.png"))
                for sid in ["build", "install", "table"]:
                    page.locator(f"#{sid}").scroll_into_view_if_needed()
                    page.wait_for_timeout(600)
                    page.screenshot(path=os.path.join(OUT, f"website-{sid}.png"))
            else:
                page.evaluate("window.scrollTo(0, 0)")
                page.wait_for_timeout(300)
                page.screenshot(path=os.path.join(OUT, "website-phone.png"))
            page.close()
        page = b.new_page()
        page.goto(BASE + "/?signed-out=1")
        page.wait_for_selector("text=You are signed out")
        b.close()
finally:
    proc.terminate()
if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("website: ok")
