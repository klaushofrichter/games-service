# How to install Game Table on a Mac

Game Table on your own Mac: the board on the screen, and the players join with their phones on the same network. It
runs **without the Game Table service**, so there are no remote players, and as many players here as a game takes.
You can [connect it to the service](#remote-players-the-game-table-service) later. It runs on Apple silicon and
Intel Macs with macOS 13.5 or later.

You get the built-in games, the games of
[extra-games](https://github.com/klaushofrichter/extra-games), and the private game repositories your GitHub
account can read.

This guide describes the newest package on the release page. An older installation can behave differently: compare
the version that `--version` shows with the release notes' *Built from …* line, and install the newest first.

## With an AI agent

Tell your agent: *"Read https://games.skylar.technology/docs/install/macos.md and install Game Table on this
Mac."* For the agent:

- Do the steps in order and run each check. When one fails, stop and report it with its output instead of working
  around it.
- Never ask for a GitHub token or password, and never handle one. Signing in to GitHub, for private game repositories,
  is the person's: the starter shows a code and opens the browser, and the person enters it there.
- Leave the firewall question and network settings to the person: tell them what to allow (below) rather than
  changing settings yourself.
- At the end, report the board's address (the starter's `board:` line), the address in the QR code (the
  `[table-host] join:` line, like `http://192.168.1.20:8080/j/ABCD`), and how to start the
  table again. Leave the table for the person to start; it runs until its window is closed.

In Terminal:

```sh
dir="$(mktemp -d)"
curl -fL -o "$dir/game-table-macos.pkg" https://github.com/klaushofrichter/games-service/releases/download/local-table/game-table-macos.pkg
curl -fL -o "$dir/SHA256SUMS" https://github.com/klaushofrichter/games-service/releases/download/local-table/game-table-SHA256SUMS.txt
(cd "$dir" && grep ' game-table-macos.pkg$' SHA256SUMS | shasum -a 256 -c -)     # must say OK; stop if it doesn't
installer -pkg "$dir/game-table-macos.pkg" -target CurrentUserHomeDirectory     # no sudo: installs for this user
rm -rf "$dir"     # the download isn't needed any more
gt="$HOME/Applications/Game Table.app/Contents/Resources/game-table.command"
"$gt" --repos none --smoke-test      # check: ends with SMOKE TEST PASSED
```

The package isn't signed yet, so the checksum is its only check. A package installed this way gets no Gatekeeper warning and needs no administrator.

- **The check:** `--smoke-test` starts the table for a moment, checks it and stops. It fails if a named repository
  couldn't be downloaded, so a missing game can't pass. It never asks a question and doesn't change the saved list of
  private repositories.
- **Port 8080 taken:** this isn't a failed check, so carry on. The message says what holds the port: another Game
  Table (ask the person to close it), or another program. For another program, add `--port 8081` (or another free
  port) to every command, and tell the person to start with it too: the port isn't remembered.
- **Private repositories:** ask the person which ones they want, as `owner/name` (a name alone means
  `klaushofrichter/name`; see *Repositories of another organization*). If there are any, run the check with
  `--repos "owner/name1 owner/name2"` while the person is there to sign in to GitHub in the browser. Then `--version`
  lists every game with its version.
- **The person's first start:** checks with `--repos` don't save the list, so the first plain start asks for the
  private repositories. Tell the person, and which names to type (or Enter for none).
- **Don't open the app or script Terminal** to check: the app's window waits for the person's answers, and scripting
  Terminal needs a permission from the person. `--smoke-test` checks the same.

## Install

Game Table installs **for your user only**, into the *Applications* folder in your home folder
(`~/Applications`), so the installer needs no administrator. It keeps its downloads and data in your own folder too.
Another user of the Mac installs it for themselves.

On a Mac account that isn't an administrator (a *Standard* account), *Open Anyway* in step 2 may still ask for an
administrator's name and password. If it does, and no administrator is around, install in Terminal instead, which
skips that step: the commands in *With an AI agent* above.

1. Download **[`game-table-macos.pkg`](https://github.com/klaushofrichter/games-service/releases/download/local-table/game-table-macos.pkg)** (from the release
   [Game Table for your computer](https://github.com/klaushofrichter/games-service/releases/tag/local-table)).
   To check the download, compare `shasum -a 256 ~/Downloads/game-table-macos.pkg` with the SHA-256 in the release
   notes.
2. Open it. The package isn't signed yet, so when it was downloaded in the browser, macOS says it can't be opened.
   Open **System Settings › Privacy & Security**, scroll down to the message about `game-table-macos.pkg`, and click
   **Open Anyway**.
3. Click through the installer. It puts **Game Table** in the Applications folder of your home folder, with its own
   Node.js.

### Check that it works

Optional: this starts a table for a moment on port 8080, checks it, and stops. Another table must not be running.
It asks nothing, uses the private repositories you named before, and fails if one of them can't be downloaded.

```sh
~/Applications/"Game Table.app"/Contents/Resources/game-table.command --smoke-test
```

It ends with `SMOKE TEST PASSED`.

## Start

Open **Game Table** with Spotlight (Cmd+Space, then type *Game Table*), or from the Applications folder of your home
folder (Finder › Go › Home › Applications). Spotlight may need a moment to find it after the installation. You can
drag it to the Dock. A Terminal window opens and
shows the table's messages:

1. The first time, it asks for the **private game repositories**: type their names, like `my-game` or
   `owner/my-game`, separated by spaces. A name alone means `klaushofrichter/my-game`; anyone else's repository needs
   `owner/name`. Press Enter alone if you have none. Next time Enter keeps the same list,
   and `-` clears it. Only this answer is saved; `--repos` doesn't change it.
2. For private repositories it needs a **GitHub sign-in**:
   - If the GitHub CLI (`gh`) is already installed and signed in, the starter uses that account without asking. Check
     which one with `gh auth status`.
   - If the GitHub CLI is installed but not signed in, the starter uses it and signs you in. Otherwise it installs the
     GitHub CLI into its own folder first.
   - To sign in, it shows a code and asks you to **press Enter**: do, in the starter's window. That opens the browser,
     where you enter the code (or enter it at github.com/login/device on another device). The sign-in finishes only
     after Enter was pressed. You do this only once.
   - If the sign-in fails, the table starts anyway, with the public games, and says which private repositories were
     left out. Start again to retry.
3. It downloads the games and opens the board in the browser.
4. If the macOS firewall is on, macOS asks whether `node` may accept incoming network connections: click **Allow**.
   If the firewall is off, you won't be asked.

The players scan the QR code on the board with their phones. Their phones must be on the same network as this
Mac: its WiFi, or a WiFi on the same router if the Mac is wired. Not mobile data, and not a guest WiFi.

Stop the table by closing the Terminal window and clicking **Terminate** when Terminal asks whether to terminate the
running processes, or press Ctrl+C. Until you click Terminate, the table keeps running. Once it has stopped, the
window shows *[Process completed]*, and you can close it.

A private game repository must have a **`production` branch** with a **`games/` folder** in it; that is what the
starter downloads. One without them is left out with a note. `--branch main` takes another branch, for every
repository.

The starter remembers the private repositories, but **not the port**: if 8080 is taken on this Mac, give `--port` at
every start.

### Repositories of another organization

Game repositories can belong to any GitHub account or organization. Give their full name, `owner/name`, for example
`my-game-company/my-game`; a name alone always means `klaushofrichter/…`. Names from different owners can be mixed:
`my-game my-game-company/my-game`. Two repositories with the same name from different owners are kept apart.

- The GitHub account you sign in with must be able to read the repository.
- Many organizations let outside apps read their private repositories only after an owner approves them. If such a
  repository is left out with *no access*, ask an owner of the organization to approve the **GitHub CLI** (the
  organization's settings › *Third-party access* › *OAuth app policy*), or, if the organization uses single sign-on,
  authorize it at github.com › Settings › Applications › *Authorized OAuth Apps* › GitHub CLI.
- `gh auth status` shows which account the starter uses.

### The board on another screen

Opening the board a second time on this computer shows *The board is open in another window*, with a choice
of what to do.

The board can also show on another screen on the same network: a TV, an iPad or another computer. The board's own
address, `http://<address>:<port>/board/`, opens only on this Mac; from anywhere else it answers 403. Use the board's
settings › *Board on another screen…*: it shows a QR code and the link. The link is
`http://<address>:<port>/board/screen?key=<table key>`, with the key from `~/Library/Application Support/Game Table/data/table-key`. It works only from the
same network, and anyone with the key controls the table: give it only to your own screens.

## If phones can't join

- If the macOS firewall is on, it must let `node` in: System Settings › Network › Firewall › Options. Set `node` to
  *Allow incoming connections*. Changing that may need an administrator.
- The QR code holds the Mac's address on the network (WiFi or Ethernet) and the table's port, like `http://192.168.1.20:8080/j/ABCD`. Open that address in the phone's
  browser to check.
- Open the address exactly as the QR code has it. `/board/` answers 403 from another device, because the board is for
  this computer ([another screen](#the-board-on-another-screen) needs its own link).
- A VPN on this computer can change which address the QR code holds. Turn it off, or start with the address phones
  reach: `PUBLIC_URL=http://192.168.1.20:8080` in the environment.
- "Port 8080 is in use": the message says whether another Game Table holds it (close that one) or another program
  (start with `--port 8081`, at every start).

## Options

Run the starter in Terminal with options:

```sh
~/Applications/"Game Table.app"/Contents/Resources/game-table.command --no-update
```

| Option | |
| --- | --- |
| `--no-update` | Start with the games downloaded last time (offline) |
| `--repos "a b"` | The private repositories for this start, without asking (`--repos none`: none). The saved list stays as it is; it changes only when you answer the question |
| `--port 8081` | Another port, if 8080 is taken (not remembered: give it at every start) |
| `--no-open` | Don't open the browser |
| `--branch main` | Another branch of the game repositories (default `production`) |
| `--sign-in` | Download the public repositories with your GitHub sign-in too |
| `--home DIR` | Another folder for downloads and the table's data |
| `--service`, `--code ABCD-EFGH` | Join the Game Table service, see below |
| `--version` | The package's version, and every game on the table with its version and source |
| `--smoke-test` | Check the installation: start, check that the board answers and the games are there, stop; fails if a named repository is missing |
| `--expect-games a,b` | With `--smoke-test`: these games (their ids, as `--version` lists them) must be on the table |
| `--help` | All the options |

## Remote players: the Game Table service

The same installation can join the Game Table service at games.skylar.technology. The service lets players and
watchers join from elsewhere, and it can deliver games to the table. The table needs approval once:

- Start with an **access code** from the console: `~/Applications/"Game Table.app"/Contents/Resources/game-table.command --code ABCD-EFGH`, or
- start with `~/Applications/"Game Table.app"/Contents/Resources/game-table.command --service`. The board then shows a pairing code, which the service's admin approves in the
  console.

The table keeps its approval, so later starts need only `--service`. Without `--service` it plays on its own again.
Every game's log is kept on the table, also without the service, and sent to the service once the table is
connected: the first start with `--service` also sends the logs of games played before. Delete the folder
`logs` in the table's `data` folder first if you don't want that.

## Update and remove

- **Update the games:** every start brings the games up to date.
- **Update Game Table itself:** stop the table, then install the newest `game-table-macos.pkg`. Your games, the table's key
  and its logs stay.
- **An older Game Table in `/Applications`:** packages before November 2, 2026 installed for all users. Install the new
  one, then drag the old *Game Table* from `/Applications` to the Trash (that one asks for an administrator), so
  Spotlight finds only the new one.
- **Remove:** stop the table first (close its window, or Ctrl+C). Then drag *Game Table* from `~/Applications` to the Trash. macOS keeps a record of the installed package;
  `pkgutil --volume ~ --forget technology.skylar.game-table` removes that too. Downloads and the table's data are in
  `~/Library/Application Support/Game Table`; delete that folder too to remove everything.
- **GitHub sign-in:** removing Game Table leaves it behind. The GitHub CLI keeps its sign-in in `~/.config/gh`;
  `gh auth logout` (or `~/Library/Application Support/Game Table/tools/gh/bin/gh auth logout`) ends it.

## Where things are

| | |
| --- | --- |
| `~/Applications/Game Table.app` | The program: Node.js, the table host, the built-in games |
| `~/Applications/Game Table.app/Contents/Resources/MANIFEST.json` | The package: its version and build time, Node.js, and the built-in games with their versions |
| `~/Library/Application Support/Game Table/games.json` | Every game on the table at the last start: version, repository, commit, download time |
| `~/Library/Application Support/Game Table/private-repos.txt` | The private repositories you named |
| `~/Library/Application Support/Game Table/runtime` | A copy of the program the table runs from, with all games in `table-games` |
| `~/Library/Application Support/Game Table/repos` | The downloaded games |
| `~/Library/Application Support/Game Table/data` | The table's key, logs and saved games |
| `~/Library/Application Support/Game Table/tools/gh` | The GitHub CLI, if the starter installed it |

Disk space: about 400 MB with the public games; private games add their own size.

To develop games on a Mac, use `scripts/local-table.sh` from a clone of games-service instead ([developer guide](https://github.com/klaushofrichter/games-service/blob/main/docs/developers/game-development.md),
section 14).
