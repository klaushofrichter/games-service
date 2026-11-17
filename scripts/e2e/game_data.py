"""Browser check of game data (D-302): what a game keeps on the table between games, with the test game Keeper
(tests/fixtures/store-games), whose board and phone show a list of favourites kept through `ctx.store`.

  - the board adds a favourite and the phone shows it; the phone adds one and the board shows it;
  - the table restarts: the favourites are still there in the next game;
  - Advanced › Game data lists Keeper; Export saves a file named with the date and time, holding the favourites;
    Delete (after asking) empties the list; Import of the exported file (after asking) brings it back, and the game
    shows the favourites again;
  - a game without `storage` gets no store.

A Table Host of its own (port 8152), without the cloud service.
  python3 scripts/e2e/game_data.py out/
"""
import json, os, re, sys, tempfile
from playwright.sync_api import sync_playwright
from common import REPO, call, errors, join_deck, open_board, start_table, wait, watch

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
PORT = 8152
BASE = f"http://127.0.0.1:{PORT}"
KEY = "game-data-e2e"
DATA = tempfile.mkdtemp(prefix="e2e-game-data-")
GAMES = os.path.join(REPO, "tests", "fixtures", "store-games")


def a(method, path, body=None):
    return call(BASE, method, "/api/v1" + path, body, {"x-table-key": KEY})


def start():
    return start_table(PORT, TABLE_KEY=KEY, PUBLIC_URL=BASE, GAMES_DIR=GAMES, SHOW_TEST_GAMES="1", DATA_DIR=DATA)


def play(game, phone):
    """Choose the game and start it with the phone's player."""
    a("POST", "/game/select", {"gameId": game})
    wait(lambda: phone.locator("#ready").count() > 0, 10, "the phone's Ready button")
    phone.locator("#ready").click()
    wait(lambda: all(p["ready"] for p in a("GET", "/state")["players"]), 10, "the player to be ready")
    a("POST", "/game/start")


proc = start()
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        board = br.new_page(viewport={"width": 1600, "height": 900})
        watch(board, "board", ignore=("status of 400",))  # the file that is no game data, refused on purpose
        open_board(board, BASE + "/board/")
        ctx = br.new_context(viewport={"width": 390, "height": 780}, has_touch=True)
        phone = ctx.new_page()
        watch(phone, "phone")
        join_deck(phone, a("GET", "/join")["url"], "Ann")
        blist, plist = board.locator("#game-layer .keeper-list"), phone.locator(".keeper-list")

        # A game without `storage` gets no store.
        play("forgetful", phone)
        blist.wait_for(timeout=15000)
        wait(lambda: blist.inner_text() == "no store" and plist.inner_text() == "no store", 10, "Forgetful to show it has no store")
        a("POST", "/game/end")
        a("POST", "/game/close")

        # The board and the phone share the favourites.
        play("keeper", phone)
        wait(lambda: blist.count() and blist.inner_text() == "none" and plist.inner_text() == "none", 15, "Keeper without favourites")
        board.locator("#game-layer .keeper-add").click()
        wait(lambda: plist.inner_text() == "board 1", 10, "the board's favourite on the phone")
        phone.locator(".keeper-add").click()
        wait(lambda: blist.inner_text() == "board 1, phone 2", 10, "the phone's favourite on the board")
        board.screenshot(path=os.path.join(OUT, "game-data-keeper.png"))
        a("POST", "/game/end")
        a("POST", "/game/close")

        # The table restarts: its data folder keeps them.
        proc.terminate()
        proc.wait(10)
        with open(os.path.join(DATA, "game-data", "keeper.json")) as f:
            assert json.load(f)["data"] == {"favourites": ["board 1", "phone 2"]}, "the file on the table's computer"
        proc = start()
        open_board(board, BASE + "/board/")
        wait(lambda: any(pl["name"] == "Ann" and pl["connected"] for pl in a("GET", "/state")["players"]) or phone.locator("input[name=name]").count() > 0, 20, "the phone back at the table")
        if phone.locator("input[name=name]").count():
            join_deck(phone, a("GET", "/join")["url"], "Ann")  # a restarted table knows no sessions
        play("keeper", phone)
        wait(lambda: blist.count() and blist.inner_text() == "board 1, phone 2" and plist.inner_text() == "board 1, phone 2", 15, "the favourites after a restart")
        a("POST", "/game/end")
        a("POST", "/game/close")

        # Advanced › Game data: the list, Export, Delete, Import.
        board.click("#tools-button")
        board.click(".overlay.advanced [data-adv=data]")
        row = board.locator(".overlay.game-data .row[data-game=keeper]")
        row.wait_for()
        assert "Keeper" in row.inner_text() and "1 entry" in row.inner_text(), row.inner_text()
        board.screenshot(path=os.path.join(OUT, "game-data-window.png"))
        with board.expect_download() as dl:
            row.locator("button[data-export]").click()
        name = dl.value.suggested_filename
        assert re.match(r"^gametable-keeper-\d{4}-\d{2}-\d{2}-\d{6}\.json$", name), f"the export's file name: {name}"
        saved = os.path.join(OUT, name)
        dl.value.save_as(saved)
        with open(saved) as f:
            exported = json.load(f)
        assert exported["gameId"] == "keeper" and exported["data"] == {"favourites": ["board 1", "phone 2"]} and exported["format"] == 1, exported

        row.locator("button[data-delete]").click()
        board.locator(".dialog-backdrop .dialog").wait_for()
        assert "Delete the data of Keeper?" in board.locator(".dialog-backdrop .dialog").inner_text()
        board.click(".dialog-backdrop button[data-x=yes]")
        board.wait_for_selector(".overlay.game-data .game-data-list >> text=No game keeps anything")
        assert a("GET", "/game-data")["games"] == []
        assert not os.path.exists(os.path.join(DATA, "game-data", "keeper.json")) or wait(lambda: not os.path.exists(os.path.join(DATA, "game-data", "keeper.json")), 5, "the file to go")

        # A file that is none is refused, in words.
        junk = os.path.join(OUT, "not-game-data.json")
        with open(junk, "w") as f:
            f.write('{"hello": "world"}')
        board.set_input_files(".overlay.game-data input[type=file]", junk)
        board.wait_for_selector(".toast >> text=not a game data file")
        board.set_input_files(".overlay.game-data input[type=file]", saved)
        dialog = board.locator(".dialog-backdrop .dialog")
        dialog.wait_for()
        text = dialog.inner_text()
        assert "Import the data of Keeper?" in text and "1 entry" in text and "keeps nothing for the game yet" in text, text
        board.click(".dialog-backdrop button[data-x=yes]")
        row.wait_for()
        assert a("GET", "/game-data/keeper")["data"] == {"favourites": ["board 1", "phone 2"]}
        board.click(".overlay.game-data [data-close-overlay]")

        play("keeper", phone)
        wait(lambda: blist.count() and blist.inner_text() == "board 1, phone 2", 15, "the imported favourites in the game")
        br.close()
finally:
    proc.terminate()
if errors:
    print("BROWSER ERRORS:\n" + "\n".join(errors))
    sys.exit(1)
print("ok: game data")
