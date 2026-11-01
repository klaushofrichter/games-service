# Runbook: Game Table on a Windows 11 computer

One script installs and starts a **Table Host** on a Windows 11 computer: the built-in games, extra-games, and the
private game repositories you can read on GitHub. It runs **without the Game Table service** (D-255): players join
with their phones on the same WiFi by the QR code on the board, as many as a game takes. Remote players, watchers and
invites need the service, so there are none here.

The installer is simpler for most people: [`docs/install/windows.md`](../install/windows.md) (D-256). This
script is the way without an installer. For running only. To develop games, use `scripts/local-table.sh` on macOS or Linux (developer guide, section 14) or
Docker ([`local-docker.md`](local-docker.md)).

## Install and start

In PowerShell (Start › type *PowerShell*), as your own user, not as administrator:

```powershell
irm https://raw.githubusercontent.com/klaushofrichter/games-service/production/scripts/windows/game-table.ps1 -OutFile $env:TEMP\game-table.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\game-table.ps1
```

The script:

1. Asks for the **private game repositories** your GitHub account can read: names like `my-game` (owner
   `klaushofrichter`) or `owner/my-game`, separated by spaces or commas. Enter alone means none. The answer is
   saved; next time Enter keeps it and `-` clears it.
2. Checks the tools and installs what is missing into `%LOCALAPPDATA%\GameTable\tools`. It needs no administrator
   rights and changes nothing system-wide:
   - **Node.js 26** or later. A Node 26 on the PATH is used as it is. Otherwise the script downloads the latest
     Node 26 for x64 or arm64 from nodejs.org and checks its SHA-256.
   - **GitHub CLI** (`gh`), only for private repositories. One on the PATH is used, or the latest release is
     downloaded and checked against its checksums. If you aren't signed in yet, it shows a code and opens the browser
     to sign in to GitHub.
   - **Git is not needed:** each repository comes as a zip of its `production` branch.
3. Downloads games-service, extra-games and the private repositories into `%LOCALAPPDATA%\GameTable\repos`. A
   private repository it can't download (no access, or no `production` branch) is left out with a note. If a
   download fails, the copy from last time is used.
4. Installs games-service's runtime packages (`npm ci --omit=dev`), only when its `package-lock.json` changed.
5. Starts the table and opens the board at `http://localhost:8080/board/`. Stop it with Ctrl+C or by closing the
   window.

Afterwards, start it from the **Game Table** shortcut on the desktop, or with `%LOCALAPPDATA%\GameTable\game-table.cmd`.
Each start brings every repository up to its latest `production`.

| Option | |
| --- | --- |
| `-Repos "a b"` | The private repositories, without asking (`-Repos none`: none) |
| `-NoUpdate` | Start what was downloaded last time, offline |
| `-Port 8081` | Another port (8080 is taken) |
| `-Branch main` | Another branch of every repository |
| `-NoOpen` | Don't open the browser |
| `-SignIn` | Download the public repositories with your GitHub sign-in too |
| `-InstallDir D:\GameTable` | Another install folder |

With the shortcut's starter: `game-table.cmd -NoUpdate`.

## Phones

- When Windows asks whether *Node.js JavaScript Runtime* may communicate on networks, allow **Private networks**.
  Otherwise phones cannot reach the table.
- The WiFi must be set to **Private** in Windows: Settings › Network & internet › your WiFi › *Network profile
  type*. On a Public network Windows blocks the phones, and the script warns about it.
- The QR code carries the address of the network the computer's default route uses.
- The board can also move to a TV or an iPad on the same network: board settings › *Board on another screen…*
  (D-190).

## What is where

| `%LOCALAPPDATA%\GameTable\` | |
| --- | --- |
| `game-table.ps1`, `game-table.cmd` | The script (refreshed from games-service at each start) and its starter |
| `private-repos.txt` | The private repositories you named |
| `tools\node`, `tools\gh` | Node.js and the GitHub CLI, when the script installed them |
| `repos\<name>`, `repos\<name>.commit` | Each repository's `production` branch, and the commit it is at |
| `repos\games-service\table-games` | All games in one folder: games-service's own first, then each repository's. A game in two repositories is taken from the later one |
| `data\` | The table's key, logs and saved games |

To remove everything: delete the folder and the desktop shortcut. To sign the GitHub CLI out: `tools\gh\bin\gh.exe
auth logout`.

## Checked on GitHub

`.github/workflows/windows-table.yml` runs the script on GitHub's Windows 11 (arm64) and Windows Server (x64) hosts:

- First with Node, the GitHub CLI and git taken off the PATH, as on a clean computer. The script must install Node
  and the GitHub CLI itself, start the table, and list games from games-service and extra-games.
- Then again from the installed starter with `-NoUpdate`.

It runs only on request, apart from the usual checks: Actions › *windows-table* › *Run workflow*. It always
tests against the current `production` branches.

## Troubleshooting

- **"running scripts is disabled"**: start the script with `powershell -ExecutionPolicy Bypass -File …` as above, or
  with the starter `game-table.cmd`.
- **Phones don't load the page**: check that the network is Private and that Node.js is allowed for Private networks
  (Windows Security › Firewall › *Allow an app through firewall*). The phone must be on the same WiFi, not on mobile
  data.
- **A private repository is left out**: the GitHub account you signed in with can't read it, or it has no
  `production` branch. To sign in as someone else: `tools\gh\bin\gh.exe auth logout`, then start again.
- **Port 8080 is in use**: another table is still running. Close its window, or start with `-Port 8081`.
