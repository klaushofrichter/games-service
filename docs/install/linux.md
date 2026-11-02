# How to install Game Table on Linux

Game Table on your own Linux computer (x64 or arm64, such as a Raspberry Pi 4 or 5 with a 64-bit system): the board
in the browser, and the players join with their phones on the same WiFi. It runs **without the Game Table
service**, so there are no remote players, and as many players here as a game takes. You can
[connect it to the service](#remote-players-the-game-table-service) later.

You get the built-in games, the games of
[extra-games](https://github.com/klaushofrichter/extra-games), and the private game repositories your GitHub
account can read.

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
2. For private repositories it installs the GitHub CLI and lets you **sign in to GitHub**: it shows a code and opens
   the browser, where you enter it. You do this only once.
3. It downloads the games and opens the board in the browser.

The players scan the QR code on the board with their phones. Their phones must be on the same WiFi, not on mobile
data.

Stop the table with Ctrl+C.

A menu entry, if you want one: save this as `~/.local/share/applications/game-table.desktop`, with your path in it:

```ini
[Desktop Entry]
Type=Application
Name=Game Table
Exec=/home/YOU/apps/game-table/game-table
Terminal=true
Categories=Game;
```

## If phones can't join

- A firewall must let port 8080 in, for example `sudo ufw allow 8080/tcp`.
- The QR code holds the computer's address on the WiFi, like `http://192.168.1.20:8080`. Open that address in the
  phone's browser to check.

## Options

| Option | |
| --- | --- |
| `--no-update` | Start with the games downloaded last time (offline) |
| `--repos "a b"` | The private repositories, without asking (`--repos none`: none) |
| `--port 8081` | Another port, if 8080 is taken |
| `--no-open` | Don't open the browser, e.g. on a computer without a screen; open the board from another one |
| `--service`, `--code ABCD-EFGH` | Join the Game Table service, see below |
| `--version` | The package's version, and every game on the table with its version and source |

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
- **Remove:** delete `~/apps/game-table`, plus `~/.local/share/game-table` (downloads and the table's data).

## Where things are

| | |
| --- | --- |
| `~/apps/game-table` | The program: Node.js, the table host, the built-in games |
| `~/apps/game-table/MANIFEST.json` | The package: its version and build time, Node.js, and the built-in games with their versions |
| `~/.local/share/game-table/games.json` | Every game on the table at the last start: version, repository, commit, download time |
| `~/.local/share/game-table/repos` | The downloaded games (`$XDG_DATA_HOME/game-table` if that is set) |
| `~/.local/share/game-table/data` | The table's key, logs and saved games |
| `~/.local/share/game-table/tools/gh` | The GitHub CLI, if it was needed |

To develop games, use `scripts/local-table.sh` from a clone of games-service instead (developer guide, section 14),
or Docker ([`docs/runbooks/local-docker.md`](../runbooks/local-docker.md)).
