"""Browser check (D-166): exchanging a player for a remote player shows the invite as a link and as a QR code.
A cloud service and a Table Host of their own (ports 8195/8196). Ann and Ben play Coin Flip; on the board Settings ›
Players › Ann (the name), "A remote player": the window shows the invite's QR code and link.
  python3 scripts/e2e/exchange_remote.py out/
"""
import os, sys, time
from playwright.sync_api import sync_playwright
from common import call, join_deck, start_cloud, start_table, wait
OUT=sys.argv[1] if len(sys.argv) > 1 else "e2e-out"; os.makedirs(OUT, exist_ok=True)
ADMIN="admin-token-for-e2e-0001"; CLOUD, TABLE="http://127.0.0.1:8195","http://127.0.0.1:8196"
cloud=start_cloud(8195, ADMIN_TOKEN=ADMIN, PUBLIC_URL=CLOUD, ICE_SERVERS="[]")
host=start_table(8196, PUBLIC_URL=TABLE, TABLE_KEY="k", CLOUD_URL=CLOUD)
api=lambda m,p,b=None: call(TABLE,m,"/api/v1"+p,b,{"x-table-key":"k"})
try:
    code=wait(lambda: api("GET","/state")["cloud"].get("pairingCode"),15,"code")
    call(CLOUD,"POST",f"/admin/api/tables/pair/{code}",{},{"authorization":f"Bearer {ADMIN}"})
    wait(lambda: api("GET","/state")["cloud"]["status"]=="online"); time.sleep(1)
    with sync_playwright() as p:
        b=p.chromium.launch(); board=b.new_page(viewport={"width":1920,"height":1080}); board.goto(TABLE+"/board/")
        ds=[join_deck(b.new_page(), api("GET","/join")["url"], n) for n in ["Ann","Ben"]]
        api("POST","/game/select",{"gameId":"coin-flip","settings":{"rounds":20,"roundSeconds":0}})
        for d in ds: d.click("#ready")
        wait(lambda: all(x["ready"] for x in api("GET","/state")["players"]),10,"ready")
        api("POST","/game/start"); wait(lambda: api("GET","/state")["phase"]=="active",10,"game")
        board.click("#settings-button")
        ann=[x for x in api("GET","/state")["players"] if x["name"]=="Ann"][0]
        board.click(f".overlay.settings [data-exchange='{ann['id']}']")
        board.click(".overlay.exchange [data-ex=remote]")
        board.wait_for_selector(".overlay.exchange .join-big img")
        board.wait_for_function("() => document.querySelector('.overlay.exchange .join-big img').naturalWidth > 0")
        board.screenshot(path=os.path.join(OUT,"exchange-remote-qr.png"))
        assert board.locator(".overlay.exchange .url").first.inner_text().startswith(CLOUD + "/i/"), "invite link missing"
        assert not board.locator(".overlay.settings .exchange-btn").count(), "no Exchange buttons in the settings any more"
        print("exchange-remote: ok")
finally:
    host.terminate(); cloud.terminate()
