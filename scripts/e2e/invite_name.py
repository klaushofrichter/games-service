"""Browser check of the invite's player name (D-155): the lobby button reads "Invite remote player…"; the invite dialog
takes an optional name on the board's own keyboard (accented letters, a real keyboard for any script), at most 12
characters; the link carries it (?name=) and the invite page fills it in, still editable, also cut to 12 characters
(an emoji counts once).
  python3 scripts/e2e/invite_name.py out/
"""
import os, sys, time
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright
from common import call, start_cloud, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
ADMIN = "admin-token-for-e2e-0002"
CLOUD, TABLE = "http://127.0.0.1:8097", "http://127.0.0.1:8098"

cloud = start_cloud(8097, ADMIN_TOKEN=ADMIN, PUBLIC_URL=CLOUD, ICE_SERVERS="[]")
host = start_table(8098, PUBLIC_URL=TABLE, TABLE_KEY="k", CLOUD_URL=CLOUD)
state = lambda: call(TABLE, "GET", "/api/v1/state", headers={"x-table-key": "k"})

try:
    code = wait(lambda: state()["cloud"].get("pairingCode"), 15, "the pairing code")
    call(CLOUD, "POST", f"/admin/api/tables/pair/{code}", {}, {"authorization": f"Bearer {ADMIN}"})
    wait(lambda: state()["cloud"]["status"] == "online")
    with sync_playwright() as p:
        b = p.chromium.launch()
        board = b.new_page(viewport={"width": 1920, "height": 1080})
        watch(board, "board")
        board.goto(TABLE + "/board/")
        board.wait_for_selector("text=Pick a game")
        assert board.inner_text("button[data-invite]").strip() == "Invite remote player…", board.inner_text("button[data-invite]")
        board.click("button[data-invite]")
        board.wait_for_selector(".invite-body .code")
        plain = board.inner_text(".invite-body .url").strip()
        assert "?" not in plain, plain
        qr0 = board.inner_html(".invite-body .qr")

        # The board's keyboard: auto capital, then lower case; an accented key; the count.
        board.click(".invite-name button[data-x=name]")
        board.wait_for_selector(".name-pad .keys")
        for k in ["K", "l", "a", "u", "s"]:
            board.click(f".name-pad .keys button[data-key='{k}']")
        board.click(".name-pad .keys button[data-key=' ']")
        board.click(".name-pad .keys button[data-key='Ö']")  # capital again after a space
        assert board.input_value(".name-pad input") == "Klaus Ö", board.input_value(".name-pad input")
        board.screenshot(path=os.path.join(OUT, "invite-name-pad.png"))
        # A real keyboard types anything; the field stops at 12 characters and the keys turn off.
        board.click(".name-pad input")
        board.keyboard.press("End")
        board.keyboard.type("sterreich-日本語")
        v = board.input_value(".name-pad input")
        assert len(v) == 12 and v == "Klaus Österr", v
        assert board.inner_text(".name-pad .count") == "12/12"
        assert board.locator(".name-pad .keys button[data-key='a']").is_disabled()
        board.click(".name-pad button[data-back]")
        board.keyboard.type("日")
        assert board.input_value(".name-pad input") == "Klaus Österr"[:11] + "日", board.input_value(".name-pad input")
        board.click(".name-pad button[data-save]")
        board.wait_for_selector(".invite-name .name-value:not(.empty)")
        url = board.inner_text(".invite-body .url").strip()
        assert parse_qs(urlparse(url).query)["name"] == ["Klaus Öster日"], url
        wait(lambda: board.inner_html(".invite-body .qr") != qr0, 5, "the QR code with the name")
        board.screenshot(path=os.path.join(OUT, "invite-name-dialog.png"))

        remote = b.new_context(viewport={"width": 1180, "height": 820}).new_page()
        watch(remote, "remote")
        remote.goto(url)
        remote.wait_for_selector("#join input[name=name]")
        assert remote.input_value("#join input[name=name]") == "Klaus Öster日"
        remote.screenshot(path=os.path.join(OUT, "invite-name-remote.png"))
        # The player can change it; typing stops at 12 characters, an emoji counts once.
        remote.fill("#join input[name=name]", "")
        remote.type("#join input[name=name]", "😀" * 14)
        assert remote.input_value("#join input[name=name]") == "😀" * 12
        # A long name in the link is cut the same way.
        token = urlparse(url).path.rsplit("/", 1)[1]
        remote.goto(f"{CLOUD}/i/{token}?name=" + "Maximilianus%20der%20Zweite")
        remote.wait_for_selector("#join input[name=name]")
        assert remote.input_value("#join input[name=name]") == "Maximilianus", remote.input_value("#join input[name=name]")
        # Removing the name on the board gives the plain link again.
        board.click(".invite-name button[data-x=noname]")
        wait(lambda: board.inner_text(".invite-body .url").strip() == plain, 5, "the plain link")
        b.close()
    print("ok: invite name (D-155)")
finally:
    host.terminate()
    cloud.terminate()
