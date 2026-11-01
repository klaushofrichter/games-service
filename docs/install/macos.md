# How to install Game Table on a Mac

Game Table on your own Mac: the board on the screen, and the players join with their phones on the same WiFi. It
runs **without the Game Table service**, so there are no remote players, and as many players here as a game takes.
You can [connect it to the service](#remote-players-the-game-table-service) later. It runs on Apple silicon and
Intel Macs with macOS 13.5 or later.

You get the built-in games, the games of
[extra-games](https://github.com/klaushofrichter/extra-games), and the private game repositories your GitHub
account can read.

## Install

1. Download **`game-table-macos.pkg`** from the release
   [Game Table for your computer](https://github.com/klaushofrichter/games-service/releases/tag/local-table).
2. Open it. The package isn't signed yet, so macOS says it can't be opened. Open **System Settings › Privacy &
   Security**, scroll down to the message about `game-table-macos.pkg`, and click **Open Anyway**.
3. Click through the installer. It puts **Game Table** in Applications, with its own Node.js.

## Start

Open **Game Table** from Applications or Launchpad. A Terminal window opens and shows the table's messages:

1. The first time, it asks for the **private game repositories**: type their names, like `my-game` or
   `owner/my-game`, separated by spaces. Press Enter alone if you have none. Next time Enter keeps the same list,
   and `-` clears it.
2. For private repositories it installs the GitHub CLI and lets you **sign in to GitHub**: it shows a code and opens
   the browser, where you enter it. You do this only once.
3. It downloads the games and opens the board in the browser.
4. When macOS asks whether `node` may accept incoming network connections, click **Allow**.

The players scan the QR code on the board with their phones. Their phones must be on the same WiFi, not on mobile
data.

Stop the table by closing the Terminal window, or with Ctrl+C.

## If phones can't join

- The firewall must let `node` in: System Settings › Network › Firewall › Options. Set `node` to *Allow incoming
  connections*.
- The QR code holds the Mac's address on the WiFi, like `http://192.168.1.20:8080`. Open that address in the phone's
  browser to check.

## Options

Run the starter in Terminal with options:

```sh
"/Applications/Game Table.app/Contents/Resources/game-table.command" --no-update
```

| Option | |
| --- | --- |
| `--no-update` | Start with the games downloaded last time (offline) |
| `--repos "a b"` | The private repositories, without asking (`--repos none`: none) |
| `--port 8081` | Another port, if 8080 is taken |
| `--no-open` | Don't open the browser |
| `--service`, `--code ABCD-EFGH` | Join the Game Table service, see below |

## Remote players: the Game Table service

The same installation can join the Game Table service at games.skylar.technology. The service lets players and
watchers join from elsewhere, and it can deliver games to the table. The table needs approval once:

- Start with an **access code** from the console: `game-table.command --code ABCD-EFGH`, or
- start with `--service`. The board then shows a pairing code, which the service's admin approves in the console.

The table keeps its approval, so later starts need only `--service`. Without `--service` it plays on its own again.

## Update and remove

- **Update the games:** every start brings the games up to date.
- **Update Game Table itself:** install the newest `game-table-macos.pkg`.
- **Remove:** drag *Game Table* from Applications to the Trash. Downloads and the table's data are in
  `~/Library/Application Support/Game Table`; delete that folder too to remove everything.

## Where things are

| | |
| --- | --- |
| `/Applications/Game Table.app` | The program: Node.js, the table host, the built-in games |
| `~/Library/Application Support/Game Table/repos` | The downloaded games |
| `~/Library/Application Support/Game Table/data` | The table's key, logs and saved games |
| `~/Library/Application Support/Game Table/tools/gh` | The GitHub CLI, if it was needed |

To develop games on a Mac, use `scripts/local-table.sh` from a clone of games-service instead (developer guide,
section 14).
