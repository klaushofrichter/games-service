# How to install Game Table on a Mac

Game Table on your own Mac: the board on the screen, and the players join with their phones on the same WiFi. It
runs **without the Game Table service**, so there are no remote players, and as many players here as a game takes.
You can [connect it to the service](#remote-players-the-game-table-service) later. It runs on Apple silicon and
Intel Macs with macOS 13.5 or later.

You get the built-in games, the games of
[extra-games](https://github.com/klaushofrichter/extra-games), and the private game repositories your GitHub
account can read.

## With an AI agent

Tell your agent: *"Read https://games.skylar.technology/docs/install/macos.md and install Game Table on this
Mac."* For the agent:

- Do the steps in order and run each check. When one fails, stop and report it with its output instead of working
  around it.
- Never ask for a GitHub token or password, and never handle one. Signing in to GitHub, for private game repositories,
  is the person's: the starter shows a code and opens the browser, and the person enters it there.
- Leave the firewall question and network settings to the person: tell them what to allow (below) rather than
  changing settings yourself.
- At the end, report the board's address, the address in the QR code (the starter prints both), and how to start the
  table again. Leave the table for the person to start; it runs until its window is closed.

In Terminal:

```sh
curl -fL -o /tmp/game-table-macos.pkg https://github.com/klaushofrichter/games-service/releases/download/local-table/game-table-macos.pkg
sudo installer -pkg /tmp/game-table-macos.pkg -target /     # asks for the person's password: let them type it
gt="/Applications/Game Table.app/Contents/Resources/game-table.command"
"$gt" --repos none --smoke-test      # check: ends with SMOKE TEST PASSED
```

A package downloaded with `curl` and installed with `installer` gets no Gatekeeper warning. If `sudo` isn't
possible, ask the person to open the package from Finder instead (see *Install*). Then ask the person which private
game repositories they want (names only). If there are any, start `"$gt" --repos "name1 name2" --smoke-test` while
the person is there to sign in to GitHub in the browser. Then `"$gt" --version` lists every game with its version.

## Install

**You need an administrator of this Mac for the installation.** The installer puts Game Table in Applications for all
users of the Mac, so macOS asks for an administrator's name and password, and *Open Anyway* may ask too. If your
account isn't an administrator, ask someone who is to enter theirs. You need this only to install, update or remove
the program. Playing doesn't: Game Table runs as your own user and keeps its downloads and data in your own folder,
so each user of the Mac has their own games and data.

1. Download **[`game-table-macos.pkg`](https://github.com/klaushofrichter/games-service/releases/download/local-table/game-table-macos.pkg)** (from the release
   [Game Table for your computer](https://github.com/klaushofrichter/games-service/releases/tag/local-table)).
   To check the download, compare `shasum -a 256 ~/Downloads/game-table-macos.pkg` with the SHA-256 in the release
   notes.
2. Open it. The package isn't signed yet, so when it was downloaded in the browser, macOS says it can't be opened.
   Open **System Settings › Privacy & Security**, scroll down to the message about `game-table-macos.pkg`, and click
   **Open Anyway**.
3. Click through the installer and enter the administrator's password when asked. It puts **Game Table** in
   Applications, with its own Node.js.

### Check that it works

Optional: this starts a table for a moment on port 8080, checks it, and stops. Another table must not be running.

```sh
"/Applications/Game Table.app/Contents/Resources/game-table.command" --smoke-test
```

It ends with `SMOKE TEST PASSED`.

## Start

Open **Game Table** from the Applications folder, or find it with Spotlight (Cmd+Space). A Terminal window opens and
shows the table's messages:

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
4. If the macOS firewall is on, macOS asks whether `node` may accept incoming network connections: click **Allow**.
   If the firewall is off, you won't be asked.

The players scan the QR code on the board with their phones. Their phones must be on the same network as this
Mac: its WiFi, or a WiFi on the same router if the Mac is wired. Not mobile data, and not a guest WiFi.

Stop the table by closing the Terminal window, or with Ctrl+C.

A private game repository must have a **`production` branch** with a **`games/` folder** in it; that is what the
starter downloads. One without them is left out with a note. `--branch main` takes another branch, for every
repository.

The starter remembers the private repositories, but **not the port**: if 8080 is taken on this Mac, give `--port` at
every start.

### The board on another screen

The board can also show on another screen on the same network: a TV, an iPad or another computer. The board's own
address, `http://<address>:<port>/board/`, opens only on this Mac; from anywhere else it answers 403. Use the board's
settings › *Board on another screen…*: it shows a QR code and the link (D-190). The link is
`http://<address>:<port>/board/screen?key=<table key>`, with the key from `~/Library/Application Support/Game Table/data/table-key`. It works only from the
same network, and anyone with the key controls the table: give it only to your own screens.

## If phones can't join

- If the macOS firewall is on, it must let `node` in: System Settings › Network › Firewall › Options. Set `node` to
  *Allow incoming connections*. Changing that may need an administrator.
- The QR code holds the Mac's address on the WiFi and the table's port, like `http://192.168.1.20:8080`. Open that address in the phone's
  browser to check.
- Open the address exactly as the QR code has it. `/board/` answers 403 from another device, because the board is for
  this computer ([another screen](#the-board-on-another-screen) needs its own link).
- A VPN on this computer can change which address the QR code holds. Turn it off, or start with the address phones
  reach: `PUBLIC_URL=http://192.168.1.20:8080` in the environment.
- "Port 8080 is in use": another table is probably still running. Close it, or start with `--port 8081`.

## Options

Run the starter in Terminal with options:

```sh
"/Applications/Game Table.app/Contents/Resources/game-table.command" --no-update
```

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

- Start with an **access code** from the console: `"/Applications/Game Table.app/Contents/Resources/game-table.command" --code ABCD-EFGH`, or
- start with `"/Applications/Game Table.app/Contents/Resources/game-table.command" --service`. The board then shows a pairing code, which the service's admin approves in the
  console.

The table keeps its approval, so later starts need only `--service`. Without `--service` it plays on its own again.

## Update and remove

- **Update the games:** every start brings the games up to date.
- **Update Game Table itself:** install the newest `game-table-macos.pkg`; it asks for an administrator again.
- **Remove:** drag *Game Table* from Applications to the Trash (it may ask for an administrator). macOS keeps a record
  of the installed package; `sudo pkgutil --forget technology.skylar.game-table` removes that too. Downloads and the table's data are in
  `~/Library/Application Support/Game Table`; delete that folder too to remove everything.
- **GitHub sign-in:** removing Game Table leaves it behind. The GitHub CLI keeps its sign-in in `~/.config/gh`;
  `gh auth logout` (or `~/Library/Application Support/Game Table/tools/gh/bin/gh auth logout`) ends it.

## Where things are

| | |
| --- | --- |
| `/Applications/Game Table.app` | The program: Node.js, the table host, the built-in games |
| `/Applications/Game Table.app/Contents/Resources/MANIFEST.json` | The package: its version and build time, Node.js, and the built-in games with their versions |
| `~/Library/Application Support/Game Table/games.json` | Every game on the table at the last start: version, repository, commit, download time |
| `~/Library/Application Support/Game Table/private-repos.txt` | The private repositories you named |
| `~/Library/Application Support/Game Table/runtime` | A copy of the program the table runs from, with all games in `table-games` |
| `~/Library/Application Support/Game Table/repos` | The downloaded games |
| `~/Library/Application Support/Game Table/data` | The table's key, logs and saved games |
| `~/Library/Application Support/Game Table/tools/gh` | The GitHub CLI, if the starter installed it |

Disk space: about 450 MB with the public games; private games add their own size.

To develop games on a Mac, use `scripts/local-table.sh` from a clone of games-service instead (developer guide,
section 14).
