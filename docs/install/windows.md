# How to install Game Table on Windows

Game Table on your own Windows 11 computer: the board on the screen, and the players join with their phones on the
same WiFi. It runs **without the Game Table service**, so there are no remote players, and as many players here as
a game takes. You can [connect it to the service](#remote-players-the-game-table-service) later.

You get the built-in games, the games of
[extra-games](https://github.com/klaushofrichter/extra-games), and the private game repositories your GitHub
account can read.

## With an AI agent

Tell your agent: *"Read https://games.skylar.technology/docs/install/windows.md and install Game Table on this
computer."* For the agent:

- Do the steps in order and run each check. When one fails, stop and report it with its output instead of working
  around it.
- Never ask for a GitHub token or password, and never handle one. Signing in to GitHub, for private game repositories,
  is the person's: the starter shows a code and opens the browser, and the person enters it there.
- Leave the firewall question and network settings to the person: tell them what to allow (below) rather than
  changing settings yourself.
- At the end, report the board's address, the address in the QR code (the starter prints both), and how to start the
  table again. Leave the table for the person to start; it runs until its window is closed.

In PowerShell, as the person's own user (not as administrator):

```powershell
$f = Join-Path $env:TEMP "game-table-windows.exe"
Invoke-WebRequest -UseBasicParsing https://github.com/klaushofrichter/games-service/releases/download/local-table/game-table-windows.exe -OutFile $f
Start-Process -Wait -FilePath $f -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CURRENTUSER"
$gt = Join-Path $env:LOCALAPPDATA "Programs\Game Table\game-table.cmd"
& $gt --repos none --smoke-test      # check: ends with SMOKE TEST PASSED
```

A silent install shows no SmartScreen warning. Then ask the person which private game repositories they want (names
only). If there are any, start `& $gt --repos "name1 name2" --smoke-test` while the person is there to sign in to
GitHub in the browser. Then `& $gt --version` lists every game with its version.

## Install

1. Download **[`game-table-windows.exe`](https://github.com/klaushofrichter/games-service/releases/download/local-table/game-table-windows.exe)** (from the release
   [Game Table for your computer](https://github.com/klaushofrichter/games-service/releases/tag/local-table)).
   To check the download, compare `Get-FileHash $env:USERPROFILE\Downloads\game-table-windows.exe` in PowerShell with
   the SHA-256 in the release notes.
2. Open it. The installer isn't signed yet, so Windows shows *Windows protected your PC*. Click **More info › Run
   anyway**.
3. Click through the installer. It installs for your user only, so it needs no administrator rights, and it brings
   its own Node.js.

### Check that it works

Optional: this starts a table for a moment on port 8080, checks it, and stops. Another table must not be running.

```
"%LOCALAPPDATA%\Programs\Game Table\game-table.cmd" --smoke-test
```

It ends with `SMOKE TEST PASSED`.

## Start

Start **Game Table** from the Start menu or the desktop. A window opens and shows the table's messages:

1. The first time, it asks for the **private game repositories**: type their names, like `my-game` or
   `owner/my-game`, separated by spaces. A name alone means `klaushofrichter/my-game`; anyone else's repository needs
   `owner/name`. Press Enter alone if you have none. Next time Enter keeps the same list,
   and `-` clears it.
2. For private repositories it needs a **GitHub sign-in**:
   - If the GitHub CLI (`gh`) is already installed and signed in, the starter uses that account without asking. Check
     which one with `gh auth status`.
   - Otherwise it installs the GitHub CLI into its own folder and signs you in: it shows a code and opens the browser,
     where you enter it. You do this only once.
3. It downloads the games and opens the board in the browser.
4. When Windows asks whether *Node.js JavaScript Runtime* may communicate on networks, allow **Private networks**.

The players scan the QR code on the board with their phones. Their phones must be on the same network as this
computer: its WiFi, or a WiFi on the same router if the computer is wired. Not mobile data, and not a guest WiFi.

Stop the table by closing the window, or with Ctrl+C.

A private game repository must have a **`production` branch** with a **`games/` folder** in it; that is what the
starter downloads. One without them is left out with a note. `--branch main` takes another branch, for every
repository.

The starter remembers the private repositories, but **not the port**: if 8080 is taken on this computer, give
`--port` at every start.

### The board on another screen

The board can also show on another screen on the same network: a TV, a tablet or another computer. The board's own
address, `http://<address>:<port>/board/`, opens only on this computer; from anywhere else it answers 403. Use the
board's settings › *Board on another screen…*: it shows a QR code and the link (D-190). The link is
`http://<address>:<port>/board/screen?key=<table key>`, with the key from `%LOCALAPPDATA%\GameTable\data\table-key`. It works only from the same
network, and anyone with the key controls the table: give it only to your own screens.

## If phones can't join

- Windows must treat your WiFi as **Private**: Settings › Network & internet › your WiFi › *Network profile type* ›
  Private. The table warns when it's set to Public.
- Node.js must be allowed through the firewall for Private networks: Windows Security › Firewall & network
  protection › *Allow an app through firewall*.
- The QR code holds the computer's address on the WiFi and the table's port, like `http://192.168.1.20:8080`. Open
  that address in the phone's browser to check.
- Open the address exactly as the QR code has it. `/board/` answers 403 from another device, because the board is for
  this computer ([another screen](#the-board-on-another-screen) needs its own link).
- A VPN on this computer can change which address the QR code holds. Turn it off, or start with the address phones
  reach: `PUBLIC_URL=http://192.168.1.20:8080` in the environment.
- "Port 8080 is in use": another table is probably still running. Close it, or start with `--port 8081`.

## Options

Add them to the starter in a terminal: `"%LOCALAPPDATA%\Programs\Game Table\game-table.cmd" --no-update`.

| Option | |
| --- | --- |
| `--no-update` | Start with the games downloaded last time (offline) |
| `--repos "a b"` | The private repositories, without asking (`--repos none`: none) |
| `--port 8081` | Another port, if 8080 is taken (not remembered: give it at every start) |
| `--no-open` | Don't open the browser |
| `--branch main` | Another branch of the game repositories (default `production`) |
| `--sign-in` | Download the public repositories with your GitHub sign-in too |
| `--home DIR` | Another folder for downloads and the table's data |
| `--service`, `--code ABCD-EFGH` | Join the Game Table service, see below |
| `--version` | The package's version, and every game on the table with its version and source |
| `--smoke-test` | Check the installation: start, check that the board answers and the games are there, stop |
| `--help` | All the options |

## Remote players: the Game Table service

The same installation can join the Game Table service at games.skylar.technology. The service lets players and
watchers join from elsewhere, and it can deliver games to the table. The table needs approval once:

- Start with an **access code** from the console: `"%LOCALAPPDATA%\Programs\Game Table\game-table.cmd" --code ABCD-EFGH`, or
- start with `"%LOCALAPPDATA%\Programs\Game Table\game-table.cmd" --service`. The board then shows a pairing code, which the service's admin approves in
  the console.

The table keeps its approval, so later starts need only `--service`. Without `--service` it plays on its own again.

## Update and remove

- **Update the games:** every start brings the games up to date.
- **Update Game Table itself:** install the newest `game-table-windows.exe` over the old one.
- **Remove:** Settings › Apps › Installed apps › *Game Table* › Uninstall. Downloads and the table's data stay in
  `%LOCALAPPDATA%\GameTable`; delete that folder too to remove everything.
- **GitHub sign-in:** removing Game Table leaves it behind. The GitHub CLI keeps its sign-in in its own settings;
  `gh auth logout` (or `%LOCALAPPDATA%\GameTable\tools\gh\bin\gh.exe auth logout`) ends it.

## Where things are

| | |
| --- | --- |
| `%LOCALAPPDATA%\Programs\Game Table` | The program: Node.js, the table host, the built-in games |
| `%LOCALAPPDATA%\Programs\Game Table\MANIFEST.json` | The package: its version and build time, Node.js, and the built-in games with their versions |
| `%LOCALAPPDATA%\GameTable\games.json` | Every game on the table at the last start: version, repository, commit, download time |
| `%LOCALAPPDATA%\GameTable\private-repos.txt` | The private repositories you named |
| `%LOCALAPPDATA%\GameTable\runtime` | A copy of the program the table runs from, with all games in `table-games` |
| `%LOCALAPPDATA%\GameTable\repos` | The downloaded games |
| `%LOCALAPPDATA%\GameTable\data` | The table's key, logs and saved games |
| `%LOCALAPPDATA%\GameTable\tools\gh` | The GitHub CLI, if the starter installed it |

Disk space: about 450 MB with the public games; private games add their own size.

Without the installer, one PowerShell script does the same: [`docs/runbooks/windows.md`](../runbooks/windows.md).
