# How to install Game Table on Windows

Game Table on your own Windows 11 computer: the board on the screen, and the players join with their phones on the
same WiFi. It runs **without the Game Table service**, so there are no remote players, and as many players here as
a game takes. You can [connect it to the service](#remote-players-the-game-table-service) later.

You get the built-in games, the games of
[extra-games](https://github.com/klaushofrichter/extra-games), and the private game repositories your GitHub
account can read.

## Install

1. Download **`game-table-windows.exe`** from the release
   [Game Table for your computer](https://github.com/klaushofrichter/games-service/releases/tag/local-table).
2. Open it. The installer isn't signed yet, so Windows shows *Windows protected your PC*. Click **More info › Run
   anyway**.
3. Click through the installer. It installs for your user only, so it needs no administrator rights, and it brings
   its own Node.js.

## Start

Start **Game Table** from the Start menu or the desktop. A window opens and shows the table's messages:

1. The first time, it asks for the **private game repositories**: type their names, like `my-game` or
   `owner/my-game`, separated by spaces. Press Enter alone if you have none. Next time Enter keeps the same list,
   and `-` clears it.
2. For private repositories it installs the GitHub CLI and lets you **sign in to GitHub**: it shows a code and opens
   the browser, where you enter it. You do this only once.
3. It downloads the games and opens the board in the browser.
4. When Windows asks whether *Node.js JavaScript Runtime* may communicate on networks, allow **Private networks**.

The players scan the QR code on the board with their phones. Their phones must be on the same WiFi, not on mobile
data.

Stop the table by closing the window, or with Ctrl+C.

## If phones can't join

- Windows must treat your WiFi as **Private**: Settings › Network & internet › your WiFi › *Network profile type* ›
  Private. The table warns when it's set to Public.
- Node.js must be allowed through the firewall for Private networks: Windows Security › Firewall & network
  protection › *Allow an app through firewall*.
- The QR code holds the computer's address on the WiFi, like `http://192.168.1.20:8080`. Open that address in the
  phone's browser to check.

## Options

Add them to the starter in a terminal: `"%LOCALAPPDATA%\Programs\Game Table\game-table.cmd" --no-update`.

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

- Start with an **access code** from the console: `game-table.cmd --code ABCD-EFGH`, or
- start with `game-table.cmd --service`. The board then shows a pairing code, which the service's admin approves in
  the console.

The table keeps its approval, so later starts need only `--service`. Without `--service` it plays on its own again.

## Update and remove

- **Update the games:** every start brings the games up to date.
- **Update Game Table itself:** install the newest `game-table-windows.exe` over the old one.
- **Remove:** Settings › Apps › Installed apps › *Game Table* › Uninstall. Downloads and the table's data stay in
  `%LOCALAPPDATA%\GameTable`; delete that folder too to remove everything.

## Where things are

| | |
| --- | --- |
| `%LOCALAPPDATA%\Programs\Game Table` | The program: Node.js, the table host, the built-in games |
| `%LOCALAPPDATA%\GameTable\repos` | The downloaded games |
| `%LOCALAPPDATA%\GameTable\data` | The table's key, logs and saved games |
| `%LOCALAPPDATA%\GameTable\tools\gh` | The GitHub CLI, if it was needed |

Without the installer, one PowerShell script does the same: [`docs/runbooks/windows.md`](../runbooks/windows.md).
