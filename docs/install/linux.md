# How to install Game Table on Linux

Game Table on your own Linux computer (x64 or arm64, such as a Raspberry Pi 4 or 5 with a 64-bit system): the board
in the browser, and the players join with their phones on the same WiFi. It runs **without the Game Table
service**, so there are no remote players, and as many players here as a game takes. You can
[connect it to the service](#remote-players-the-game-table-service) later.

You get the built-in games, the games of
[extra-games](https://github.com/klaushofrichter/extra-games), and the private game repositories your GitHub
account can read.

## With an AI agent

Tell your agent: *"Read https://games.skylar.technology/docs/install/linux.md and install Game Table on this
computer."* For the agent:

- Do the steps in order and run each check. When one fails, stop and report it with its output instead of working
  around it.
- Never ask for a GitHub token or password, and never handle one. Signing in to GitHub, for private game repositories,
  is the person's: the starter shows a code and opens the browser, and the person enters it there.
- Leave the firewall question and network settings to the person: tell them what to allow (below) rather than
  changing settings yourself.
- At the end, report the board's address, the address in the QR code (the starter prints both), and how to start the
  table again. Leave the table for the person to start; it runs until its window is closed.

In a shell, as the person's own user:

```sh
mkdir -p ~/apps
curl -fL https://github.com/klaushofrichter/games-service/releases/download/local-table/game-table-linux.tar.gz | tar -xz -C ~/apps
~/apps/game-table/game-table --repos none --smoke-test      # check: ends with SMOKE TEST PASSED
```

If the check says libatomic is missing, it names the command for the system (it needs `sudo`, so ask the person).
Then ask the person which private game repositories they want (names only). If there are any, start
`~/apps/game-table/game-table --repos "name1 name2" --smoke-test` while the person is there to sign in to GitHub in
the browser. Then `~/apps/game-table/game-table --version` lists every game with its version.

## Install

Download **`game-table-linux.tar.gz`** from the release
[Game Table for your computer](https://github.com/klaushofrichter/games-service/releases/tag/local-table) and unpack
it, for example into `~/apps`:

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

## Start

```sh
~/apps/game-table/game-table
```

1. The first time, it asks for the **private game repositories**: type their names, like `my-game` or
   `owner/my-game`, separated by spaces. Press Enter alone if you have none. Next time Enter keeps the same list,
   and `-` clears it.
2. For private repositories it needs a **GitHub sign-in**:
   - If the GitHub CLI (`gh`) is already installed and signed in, the starter uses that account without asking. Check
     which one with `gh auth status`.
   - Otherwise it installs the GitHub CLI into its own folder and signs you in: it shows a code and opens the browser,
     where you enter it. You do this only once.
3. It downloads the games and opens the board in the browser.

A private game repository must have a **`production` branch** with a **`games/` folder** in it; that is what the
starter downloads. One without them is left out with a note. `--branch main` takes another branch, for every
repository.

The players scan the QR code on the board with their phones. Their phones must be on the same WiFi, not on mobile
data.

Stop the table with Ctrl+C.

The starter remembers the private repositories, but **not the port**: if 8080 is taken on this computer, give
`--port` at every start, in a menu entry or service too.

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

With `--no-open`, or on a computer without a screen, show the board on another screen on the same network: a TV, a
tablet or another computer. The board itself, `http://<address>:<port>/board/`, opens only on this computer; from
anywhere else it answers 403. Another screen needs the board's own link, which carries the table's key:

- On the board: its settings › *Board on another screen…* shows a QR code and the link (D-190).
- Without a screen here: `http://<address>:<port>/board/screen?key=<table key>`, with the key from
  `~/.local/share/game-table/data/table-key`.

The link works only from the same network, and anyone with the key controls the table: give it only to your own
screens.

## If phones can't join

- A firewall must let the table's port in (8080 unless you chose another), for example `sudo ufw allow 8080/tcp`.
- The QR code holds the computer's address on the WiFi and the port, like `http://192.168.1.20:8080`. Open that
  address in the phone's browser to check.

## Options

| Option | |
| --- | --- |
| `--no-update` | Start with the games downloaded last time (offline) |
| `--repos "a b"` | The private repositories, without asking (`--repos none`: none) |
| `--port 8081` | Another port, if 8080 is taken (not remembered: give it at every start) |
| `--no-open` | Don't open the browser, e.g. on a computer without a screen; [show the board on another screen](#the-board-on-another-screen) |
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

- Start with an **access code** from the console: `game-table --code ABCD-EFGH`, or
- start with `game-table --service`. The board then shows a pairing code, which the service's admin approves in the
  console.

The table keeps its approval, so later starts need only `--service`. Without `--service` it plays on its own again.

## Update and remove

- **Update the games:** every start brings the games up to date.
- **Update Game Table itself:** unpack the newest `game-table-linux.tar.gz` over the old folder.
- **Remove:** delete `~/apps/game-table`, plus `~/.local/share/game-table` (downloads and the table's data). With a
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

To develop games, use `scripts/local-table.sh` from a clone of games-service instead (developer guide, section 14),
or Docker ([`docs/runbooks/local-docker.md`](../runbooks/local-docker.md)).
