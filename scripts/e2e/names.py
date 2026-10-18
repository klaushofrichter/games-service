"""Browser check of player names (D-148).
  python3 scripts/e2e/names.py out/

A Table Host of its own (port 8098). Ann joins. A second phone types "ann": the join form says the name is taken and
stays; with a long name it joins, cut to 12 characters. Ann opens Change name on her phone: a taken name is refused
in the sheet, a free one is taken and the board shows it.
"""
import os, sys
from playwright.sync_api import sync_playwright
from common import api, errors, join_deck, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
BASE = "http://127.0.0.1:8098"
KEY = "namesk"


def a(method, path, body=None):
    return api(method, path, body, base=BASE, key=KEY)


def names():
    return [p["name"] for p in a("GET", "/state")["players"]]


proc = start_table(8098, TABLE_KEY=KEY, PUBLIC_URL=BASE)
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        board = br.new_page(viewport={"width": 1920, "height": 1080})
        watch(board, "board")
        board.goto(BASE + "/board/")
        phone = lambda: br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True).new_page()
        url = a("GET", "/join")["url"]
        ann = phone()
        watch(ann, "Ann")
        join_deck(ann, url, "Ann")

        # A taken name: the form says so and stays, with the name still typed.
        ben = phone()
        watch(ben, "Ben")
        ben.goto(url)
        assert ben.get_attribute("input[name=name]", "maxlength") == "12"
        ben.fill("input[name=name]", "ann")
        ben.click("button[type=submit]")
        ben.wait_for_selector("#join-error:has-text('already at this table')")
        assert ben.input_value("input[name=name]") == "ann"
        ben.screenshot(path=os.path.join(OUT, "names-taken.png"))
        # A long name is cut to 12 characters (the field takes 12; the table cuts what gets past it too).
        ben.fill("input[name=name]", "Bartholomew Jr")
        assert ben.input_value("input[name=name]") == "Bartholomew "
        ben.click("button[type=submit]")
        ben.wait_for_selector(".who h1")
        wait(lambda: "Bartholomew" in names(), 5, "Ben joined")

        # Change name on Ann's phone: a taken name is refused in the sheet, a free one is taken.
        ann.click("button[data-rename]")
        ann.wait_for_selector(".rules-modal form#rename")
        ann.fill(".rules-modal input[name=name]", "bartholomew")
        ann.click(".rules-modal button[type=submit]")
        ann.wait_for_selector(".rules-modal .join-error:has-text('already at this table')")
        ann.fill(".rules-modal input[name=name]", "Annie")
        ann.click(".rules-modal button[type=submit]")
        ann.wait_for_selector(".rules-modal", state="detached")
        ann.wait_for_selector(".who h1:text-is('Annie')")
        board.wait_for_selector("#seats :text('Annie')")
        assert names() == ["Annie", "Bartholomew"], names()
        ann.screenshot(path=os.path.join(OUT, "names-renamed.png"))
        br.close()
    if errors:
        raise AssertionError("browser errors:\n" + "\n".join(errors))
    print("names: ok")
finally:
    proc.kill()
