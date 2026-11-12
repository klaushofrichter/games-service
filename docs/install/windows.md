# How to install Game Table on Windows

Game Table on your own Windows 11 computer: the board on the screen, and the players join with their phones on the
same network. It runs **without the Game Table service**, so there are no remote players, and as many players here as
a game takes. You can [connect it to the service](#remote-players-the-game-table-service) later.

You get the built-in games, the games of
[extra-games](https://github.com/klaushofrichter/extra-games), FM-1 Synth from
[synth-game](https://github.com/klaushofrichter/synth-game), and the private game repositories your GitHub
account can read.

This guide describes the newest package on the release page. An older installation can behave differently: compare
the version that `--version` shows (like `v2026.11.02.10 (22570a1)`) with the *Version* in the release notes, and install
the newest first.

## With an AI agent

Tell your agent: *"Read https://games.skylar.technology/docs/install/windows.md and install Game Table on this
computer."* For the agent:

- Do the steps in order and run each check. When one fails, stop and report it with its output instead of working
  around it.
- Never ask for a GitHub token or password, and never handle one. Signing in to GitHub, for private game repositories,
  is the person's: the starter shows a code, the person presses Enter in its window, and enters the code in the
  browser that opens.
- Leave the firewall question and network settings to the person: tell them what to allow (below) rather than
  changing settings yourself.
- At the end, report the board's address (the starter's `board:` line, `http://localhost:8080/board/`), the
  network address phones use (the `phones:` line, like `http://192.168.1.20:8080`), and how to start the table
  again. Don't report a join code (`/j/…`): each start makes a new one, so phones scan the QR code on the board.
  Leave the table for the person to start; it runs until its window is closed.

In PowerShell, as the person's own user (not as administrator):

```powershell
$f = Join-Path $env:TEMP "game-table-windows.exe"
Invoke-WebRequest -UseBasicParsing https://github.com/klaushofrichter/games-service/releases/download/local-table/game-table-windows.exe -OutFile $f
$sums = Join-Path $env:TEMP "game-table-SHA256SUMS.txt"
Invoke-WebRequest -UseBasicParsing https://github.com/klaushofrichter/games-service/releases/download/local-table/game-table-SHA256SUMS.txt -OutFile $sums
$want = ((Get-Content $sums | Where-Object { $_ -match ' game-table-windows\.exe$' }) -split ' ')[0]
if ((Get-FileHash $f).Hash -ne $want) { throw "Checksum mismatch: stop" }     # stops on a mismatch
Start-Process -Wait -FilePath $f -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CURRENTUSER"
Remove-Item $f, $sums     # the download isn't needed any more
$gt = Join-Path $env:LOCALAPPDATA "Programs\Game Table\game-table.cmd"
& $gt --repos none --smoke-test      # check: ends with SMOKE TEST PASSED
```

A silent install shows no SmartScreen warning. This installs a **table** for this computer, not a game service: a
game service (for remote players) runs on a server with Docker, a DNS name and HTTPS (see *Remote players* below).

- **The check:** `--smoke-test` starts the table for a moment, checks it and stops. It fails if a named repository
  couldn't be downloaded, so a missing game can't pass. It never asks a question and doesn't change the saved list of
  private repositories.
- **Port 8080 taken:** the check stops with *Port 8080 is in use …* and exit code 1, without `SMOKE TEST PASSED`.
  This one case isn't a failed installation, so carry on. The message says what holds the port: another Game Table
  (ask the person to close it, then run the check again), or another program. For another program, add `--port 8081`
  (or another free port) to every command, and tell the person to start with it too: the port isn't remembered.
- **Private repositories:** ask the person which ones they want, as `owner/name` (a name alone means
  `klaushofrichter/name`; see *Repositories of another organization*). If there are any, run the check with
  `--repos "owner/name1 owner/name2"` while the person is there to sign in to GitHub in the browser. Then `--version`
  lists every game with its version.
- **The person's first start:** checks with `--repos` don't save the list, so the first plain start asks for the
  private repositories. Tell the person, and which names to type (or Enter for none).

### Hints for AI agents: ports and the GitHub sign-in

These two caused most trouble in real installations.

**Ports and the network**

- A passing `--smoke-test`, the board on `localhost` and the join link opened on this computer prove only that the
  table runs. They don't prove that phones can reach it: a firewall can still block the port.
- Check whether a firewall is on: `Get-NetConnectionProfile` (the network must be *Private*) and `Get-NetFirewallProfile | Select Name, Enabled`. If it is, tell the person at the handoff, with the step from
  [Troubleshoot](#troubleshoot) for the port the table actually runs on. Leave the change itself to the person.
- Ask the person to check from a phone: `http://<address>:<port>/health` (the address and port from the starter's
  `phones:` line) shows `{"status":"ok", …}` when the phone can reach the table.
- A taken port 8080 isn't a failed installation (above): use the port the starter suggests in every command, and
  give the person that port too.
- Run the commands in a normal shell of the person's own user. A restricted or sandboxed agent shell can see other
  files (an old `games.json`) or another network than the person does.

**The GitHub sign-in (private repositories only)**

- First run `gh auth status`. If the GitHub CLI is signed in, the starter uses it silently, with no code and no
  browser step: the easiest way.
- If it isn't, don't start a sign-in in a window the person can't see or type into, such as your own tool's shell or
  a background terminal tab. The GitHub CLI shows a code and then **waits for Enter in that window**; approving the
  code in the browser alone doesn't finish it, and the table stays down until then.
- Instead, let the person do the first start with private repositories themselves, from the Start menu (*Game Table*), which opens a window: they type the
  repository names at the question (that list is saved; `--repos` isn't), press Enter when the GitHub CLI asks, and
  enter the code in the browser.
- Never ask for, read or pass on a token or a password.

## Install

1. Download **[`game-table-windows.exe`](https://github.com/klaushofrichter/games-service/releases/download/local-table/game-table-windows.exe)** (from the release
   [Game Table for your computer](https://github.com/klaushofrichter/games-service/releases/tag/local-table)).
   To check the download, compare `Get-FileHash $env:USERPROFILE\Downloads\game-table-windows.exe` in PowerShell with
   the SHA-256 in the release notes (PowerShell prints it in capitals; it's the same value).
2. Open it. The installer isn't signed yet, so Windows shows *Windows protected your PC*. Click **More info › Run
   anyway**.
3. Click through the installer. It installs for your user only, so it needs no administrator rights, and it brings
   its own Node.js.

### Check that it works

Optional: this starts a table for a moment on port 8080, checks it, and stops. Another table must not be running.
It asks nothing, uses the private repositories you named before, and fails if one of them can't be downloaded.

```
"%LOCALAPPDATA%\Programs\Game Table\game-table.cmd" --smoke-test
```

It ends with `SMOKE TEST PASSED`. If it says *Port 8080 is in use … by another program*, add another port, here and at
every start:

```
"%LOCALAPPDATA%\Programs\Game Table\game-table.cmd" --smoke-test --port 8081
```

## Start

Start **Game Table** from the Start menu or the desktop. A window opens and shows the table's messages:

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
4. When Windows asks whether *Node.js JavaScript Runtime* may communicate on networks, allow **Private networks**.

The players scan the QR code on the board with their phones. Their phones must be on the same network as this
computer: its WiFi, or a WiFi on the same router if the computer is wired. Not mobile data, and not a guest WiFi. If phones can't join, see [Troubleshoot](#troubleshoot): usually a firewall.

Stop the table by closing the window, or with Ctrl+C.

A private game repository must have a **`production` branch** with a **`games/` folder** in it; that is what the
starter downloads. One without them is left out with a note. `--branch main` takes another branch, for every
repository.

The starter remembers the private repositories, but **not the port**: if 8080 is taken on this computer, give
`--port` at every start.

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

The board can also show on another screen on the same network: a TV, a tablet or another computer. The board's own
address, `http://<address>:<port>/board/`, opens only on this computer; from anywhere else it answers 403. Use the
board's settings › *Board on another screen…*: it shows a QR code and the link. The link is
`http://<address>:<port>/board/screen?key=<table key>`, with the key from `%LOCALAPPDATA%\GameTable\data\table-key`. It works only from the same
network, and anyone with the key controls the table: give it only to your own screens.

## Troubleshoot

### Phones can't join

**Phones need the table's port open on this computer, and a check on the computer itself doesn't prove that it
is.** `--smoke-test`, the board on `localhost` and the join link opened on this computer all pass while a firewall
still keeps every phone out.

- **Check from a phone:** open `http://<this computer's address>:<port>/health` in the phone's browser (the address
  and port from the starter's `phones:` line, like `http://192.168.1.20:8080/health`). It shows `{"status":"ok", …}`
  when the phone can reach the table; if it doesn't load, something between them blocks the port.
- Is the network Private, and is the firewall on? In PowerShell, `Get-NetConnectionProfile` shows the network's
  *NetworkCategory* (Private or Public), and `Get-NetFirewallProfile | Select Name, Enabled` the firewall for each.
- **The network must be Private:** Settings › Network & internet › your network › *Network profile type* › Private.
  The table warns when it's Public.
- **Let Node.js in on Private networks:** Windows asks at the first start; allow **Private networks**. If that was
  missed: Windows Security › Firewall & network protection › *Allow an app through firewall* › Node.js JavaScript
  Runtime › Private.
- The QR code holds the computer's address on the network (WiFi or Ethernet) and the table's port, like `http://192.168.1.20:8080/j/ABCD`. Open
  that address in the phone's browser to check.
- Open the address exactly as the QR code has it. `/board/` answers 403 from another device, because the board is for
  this computer ([another screen](#the-board-on-another-screen) needs its own link).
- A VPN on this computer can change which address the QR code holds. Turn it off, or start with the address phones
  reach: `PUBLIC_URL=http://192.168.1.20:8080` in the environment.
- "Port 8080 is in use": the message says whether another Game Table holds it (close that one) or another program
  (start with `--port 8081`, at every start).

### GitHub sign-in

- **The sign-in waits for Enter.** The starter shows a code and waits until Enter is pressed **in its own window**; only
  then does it open the browser and wait for the code. Approving the code in the browser alone isn't enough.
- **Already signed in?** `gh auth status` shows the account. A signed-in GitHub CLI is used without any question, code or
  browser step: the easiest way to private games.
- **If the sign-in fails,** the table starts anyway with the public games and names the private repositories it left
  out. Start again to retry.
- **A private repository is left out with *no access*:** the signed-in account can't read it, it has no
  `production` branch with a `games/` folder, or its organization hasn't approved the GitHub CLI (see *Repositories of
  another organization*).

## Options

Add them to the starter in a terminal: `"%LOCALAPPDATA%\Programs\Game Table\game-table.cmd" --no-update`.

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

- Start with an **access code** from the console: `"%LOCALAPPDATA%\Programs\Game Table\game-table.cmd" --code ABCD-EFGH`, or
- start with `"%LOCALAPPDATA%\Programs\Game Table\game-table.cmd" --service`. The board then shows a pairing code, which the service's admin approves in
  the console.

The table keeps its approval, so later starts need only `--service`. Without `--service` it plays on its own again.
Every game's log is kept on the table, also without the service, and sent to the service once the table is
connected: the first start with `--service` also sends the logs of games played before. Delete the folder
`logs` in the table's `data` folder first if you don't want that.

## Update and remove

- **Update the games:** every start brings the games up to date.
- **Update Game Table itself:** stop the table, then install the newest `game-table-windows.exe` over the old one.
  Your games, the table's key and its logs stay.
- **Remove:** stop the table first (close its window, or Ctrl+C). Then Settings › Apps › Installed apps › *Game Table* › Uninstall. Downloads and the table's data stay in
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

Without the installer, one PowerShell script does the same: [`docs/runbooks/windows.md`](https://github.com/klaushofrichter/games-service/blob/main/docs/runbooks/windows.md).
