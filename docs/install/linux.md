# How to install Game Table on Linux

Game Table on your own Linux computer (x64 or arm64, such as a Raspberry Pi 4 or 5 with a 64-bit system): the board
in the browser, and the players join with their phones on the same network. It runs **without the Game Table
service**, so there are no remote players, and as many players here as a game takes. You can
[connect it to the service](#remote-players-the-game-table-service) later.

You get the built-in games, the games of
[extra-games](https://github.com/klaushofrichter/extra-games), and the private game repositories your GitHub
account can read.

This guide describes the newest package on the release page. An older installation can behave differently: compare
the version that `--version` shows (like `v2026.11.02.10 (22570a1)`) with the *Version* in the release notes, and install
the newest first.

## With an AI agent

Tell your agent: *"Read https://games.skylar.technology/docs/install/linux.md and install Game Table on this
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

In a shell, as the person's own user:

```sh
dir="$(mktemp -d)"
curl -fL -o "$dir/game-table-linux.tar.gz" https://github.com/klaushofrichter/games-service/releases/download/local-table/game-table-linux.tar.gz
curl -fL -o "$dir/SHA256SUMS" https://github.com/klaushofrichter/games-service/releases/download/local-table/game-table-SHA256SUMS.txt
(cd "$dir" && grep ' game-table-linux.tar.gz$' SHA256SUMS | sha256sum -c -)     # must say OK; stop if it doesn't
mkdir -p ~/apps && tar -xzf "$dir/game-table-linux.tar.gz" -C ~/apps
rm -rf "$dir"     # the download isn't needed any more
~/apps/game-table/game-table --repos none --smoke-test      # check: ends with SMOKE TEST PASSED
```

If the check says libatomic is missing, it names the
command for the system (it needs `sudo`, so ask the person).

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
- **No desktop, or not the person's session:** on a computer without a desktop (a server, Raspberry Pi OS Lite), or
  when you work from another session (SSH, or while the desktop is locked), start with `--no-open`. The starter opens
  a browser only on an active, unlocked desktop of this user, since opening one elsewhere can take over a browser
  that is already running. The person opens the board themselves, or shows it on another screen (below).

### Hints for AI agents: ports and the GitHub sign-in

These two caused most trouble in real installations.

**Ports and the network**

- A passing `--smoke-test`, the board on `localhost` and the join link opened on this computer prove only that the
  table runs. They don't prove that phones can reach it: a firewall can still block the port.
- Check whether a firewall is on: `systemctl is-active ufw` or `systemctl is-active firewalld` (no `sudo` needed). If it is, tell the person at the handoff, with the step from
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
- Instead, let the person do the first start with private repositories themselves, from a terminal of their own: `~/apps/game-table/game-table`: they type the
  repository names at the question (that list is saved; `--repos` isn't), press Enter when the GitHub CLI asks, and
  enter the code in the browser.
- Never ask for, read or pass on a token or a password.

## Install

Download **[`game-table-linux.tar.gz`](https://github.com/klaushofrichter/games-service/releases/download/local-table/game-table-linux.tar.gz)** (from the release
[Game Table for your computer](https://github.com/klaushofrichter/games-service/releases/tag/local-table)). To check
the download, compare `sha256sum ~/Downloads/game-table-linux.tar.gz` with the SHA-256 in the release notes. Unpack it,
for example into `~/apps`:

```sh
mkdir -p ~/apps
tar -xzf ~/Downloads/game-table-linux.tar.gz -C ~/apps
```

It brings its own Node.js. The one system library it needs is **libatomic**, which most desktop systems have; if
not, the start says so, and you install it once:

```sh
sudo apt install libatomic1     # Debian, Ubuntu, Raspberry Pi OS
sudo dnf install libatomic      # Fedora, RHEL
```

### Check that it works

Optional: this starts a table for a moment on port 8080, checks it, and stops. Another table must not be running.
It asks nothing, uses the private repositories you named before, and fails if one of them can't be downloaded.

```sh
~/apps/game-table/game-table --smoke-test
```

It ends with `SMOKE TEST PASSED`. If it says *Port 8080 is in use … by another program*, add another port, here and at
every start:

```sh
~/apps/game-table/game-table --smoke-test --port 8081
```

## Start

```sh
~/apps/game-table/game-table
```

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

A private game repository must have a **`production` branch** with a **`games/` folder** in it; that is what the
starter downloads. One without them is left out with a note. `--branch main` takes another branch, for every
repository.

The players scan the QR code on the board with their phones. Their phones must be on the same network as this
computer: its WiFi, or a WiFi on the same router if the computer is wired. Not mobile data, and not a guest WiFi. If phones can't join, see [Troubleshoot](#troubleshoot): usually a firewall.

Stop the table with Ctrl+C.

The starter remembers the private repositories, but **not the port**: if 8080 is taken on this computer, give
`--port` at every start, in a menu entry or service too.

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

### A menu entry

Save this as `~/.local/share/applications/game-table.desktop`, with your path in it (and `--port 8081` if 8080 is
taken):

```ini
[Desktop Entry]
Type=Application
Name=Game Table
Exec=/home/YOU/apps/game-table/game-table --port 8080
Terminal=true
Categories=Game;
```

### Running without a terminal (a service)

On a computer without a screen, or to keep the table running after you log out, run it as a `systemd` user service.
Save this as `~/.config/systemd/user/game-table.service`, with your path and port:

```ini
[Unit]
Description=Game Table
After=network-online.target

[Service]
ExecStart=%h/apps/game-table/game-table --no-open --port 8080
Restart=on-failure

[Install]
WantedBy=default.target
```

Start it once in a terminal first, so that it asks for the private repositories and signs in to GitHub. Then:

```sh
systemctl --user daemon-reload
systemctl --user enable --now game-table
loginctl enable-linger "$USER"        # keeps it running when you are logged out, and starts it at boot
journalctl --user -u game-table -f    # its log
```

### The board on another screen

Opening the board a second time on this computer shows *The board is open in another window*, with a choice
of what to do.

With `--no-open`, or on a computer without a screen, show the board on another screen on the same network: a TV, a
tablet or another computer. The board itself, `http://<address>:<port>/board/`, opens only on this computer; from
anywhere else it answers 403. Another screen needs the board's own link, which carries the table's key:

- On the board: its settings › *Board on another screen…* shows a QR code and the link.
- Without a screen here: `http://<address>:<port>/board/screen?key=<table key>`, with the key from
  `~/.local/share/game-table/data/table-key`.

The link works only from the same network, and anyone with the key controls the table: give it only to your own
screens.

## Troubleshoot

### Phones can't join

**Phones need the table's port open on this computer, and a check on the computer itself doesn't prove that it
is.** `--smoke-test`, the board on `localhost` and the join link opened on this computer all pass while a firewall
still keeps every phone out.

- **Check from a phone:** open `http://<this computer's address>:<port>/health` in the phone's browser (the address
  and port from the starter's `phones:` line, like `http://192.168.1.20:8080/health`). It shows `{"status":"ok", …}`
  when the phone can reach the table; if it doesn't load, something between them blocks the port.
- Is a firewall on? `systemctl is-active ufw` (Debian, Ubuntu, Raspberry Pi OS) or `systemctl is-active firewalld`
  (Fedora) says `active` when it is. These need no `sudo`; reading or changing the rules does.
- **Open the table's port to your home network only** (here 8081 and a home network of `192.168.1.x`; use your port
  and network):

  ```sh
  sudo ufw allow from 192.168.1.0/24 to any port 8081 proto tcp          # ufw
  sudo ufw delete allow from 192.168.1.0/24 to any port 8081 proto tcp   # undo it
  sudo firewall-cmd --add-port=8081/tcp                                  # firewalld, until the next reboot
  ```

  The table doesn't need a restart. Docker's published ports often bypass `ufw`, so a Docker table may have worked
  where this one doesn't.
- The QR code holds the computer's address on the network (WiFi or Ethernet) and the port, like `http://192.168.1.20:8080/j/ABCD`. Open that
  address in the phone's browser to check.
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

| Option | |
| --- | --- |
| `--no-update` | Start with the games downloaded last time (offline) |
| `--repos "a b"` | The private repositories for this start, without asking (`--repos none`: none). The saved list stays as it is; it changes only when you answer the question |
| `--port 8081` | Another port, if 8080 is taken (not remembered: give it at every start) |
| `--no-open` | Don't open the browser, e.g. on a computer without a screen; [show the board on another screen](#the-board-on-another-screen) |
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

- Start with an **access code** from the console: `~/apps/game-table/game-table --code ABCD-EFGH`, or
- start with `~/apps/game-table/game-table --service`. The board then shows a pairing code, which the service's admin approves in the
  console.

The table keeps its approval, so later starts need only `--service`. Without `--service` it plays on its own again.
Every game's log is kept on the table, also without the service, and sent to the service once the table is
connected: the first start with `--service` also sends the logs of games played before. Delete the folder
`logs` in the table's `data` folder first if you don't want that.

## Update and remove

- **Update the games:** every start brings the games up to date.
- **Update Game Table itself:** stop the table (and its service, if you made one), then unpack the newest
  `game-table-linux.tar.gz` over the old folder. Your games, the table's key and its logs stay.
- **Remove:** stop the table first (close its window, or Ctrl+C). Then delete `~/apps/game-table`, plus `~/.local/share/game-table` (downloads and the table's data). If you
  opened the port in a firewall for it, undo that too (*Troubleshoot*). With a
  service, first `systemctl --user disable --now game-table` and delete its file.
- **GitHub sign-in:** removing Game Table leaves it behind. The GitHub CLI keeps its sign-in in `~/.config/gh`;
  `gh auth logout` (or `~/.local/share/game-table/tools/gh/bin/gh auth logout`) ends it.

## Where things are

| | |
| --- | --- |
| `~/apps/game-table` | The program: Node.js, the table host, the built-in games |
| `~/apps/game-table/MANIFEST.json` | The package: its version and build time, Node.js, and the built-in games with their versions |
| `~/.local/share/game-table` | Everything the starter writes (`$XDG_DATA_HOME/game-table` if that is set, or `--home`): |
| `…/games.json` | Every game on the table at the last start: version, repository, commit, download time |
| `…/private-repos.txt` | The private repositories you named |
| `…/runtime` | A copy of the program the table runs from, with all games in `table-games` |
| `…/repos` | The downloaded games |
| `…/data` | The table's key (`table-key`), logs and saved games |
| `…/tools/gh` | The GitHub CLI, if the starter installed it |

Disk space: about 450 MB with the public games; private games add their own size.

To develop games, use `scripts/local-table.sh` from a clone of games-service instead ([developer guide](https://github.com/klaushofrichter/games-service/blob/main/docs/developers/game-development.md), section 14),
or Docker ([the Docker runbook](https://games.skylar.technology/docs/local-docker.md)).
