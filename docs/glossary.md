# Glossary

The words this project uses for its parts, so that people, docs, code and AI agents mean the same thing. They are the
words the software already uses; *In the code* gives the names to search for. Use them in issues, docs, commit
messages, UI text and new code; the *Avoid* column lists words that mean the same thing and only add confusion.

## The table

| Term | What it is | In the code | Avoid |
| --- | --- | --- | --- |
| **Table** | One installation: a board, the players' phones and the Table Host behind them, in one room. | `table` | — |
| **Board** | The shared screen everyone sees: a touchscreen lying flat in the middle of the table (1920 × 1080 logical pixels), seen from all sides. Shows the lobby and the game's public view. | `board`, `board.js`, `/board/` | screen, TV, display (for the board itself) |
| **Deck** | A player's private screen, on their own phone: their cards, their buttons, what only they may see. In text for players we say *your phone*. | `deck`, `deck.js`, `/deck/` | hand (a game's cards on the deck are its *hand*), client |
| **Table Host** | The program (and the PC under the table) that runs the lobby and the game's rules, keeps the logs and serves the board and the decks on the local network. | `apps/table-host` | server, backend |
| **Kiosk** | The table PC's own browser showing the board full screen, at `localhost`. | — | — |
| **Board on another screen** | The board moved to an iPad, a TV or another computer on the same network with its link or QR code; the Table Host keeps running (D-190). | `/board/screen`, `#screen` | second screen, mirror |
| **Remote board** | The board in a remote player's or watcher's browser, turned toward their seat. | `REMOTE` | — |
| **Edge** | One side of the board: `north`, `east`, `south`, `west`. Seats sit along the edges; the board turns its text toward an edge. | `edge`, `edges` | side |

## Seats and their names

The board lies flat, so it has no up and down, only four **edges** named like a map: **south** is the edge at the
bottom of the screen's picture, **north** the edge opposite, and seen by someone sitting at south, **west** is on their left and **east** on
their right. Going around the table clockwise, seen from above: south, west, north, east (`EDGES_CLOCKWISE`).

A seat's name says where it is (D-087). Players never see seat numbers; the API and the rules use them.

- One seat on an edge is named after the edge: *north*.
- Two seats on an edge are its two ends: *southwest* and *southeast*, *northwest* and *northeast*. East and west
  always have one seat.
- Three seats add the plain edge in the middle: *southwest*, *south*, *southeast*.
- The ends are named from the board's map, not from the player's own view: the *northwest* seat is at the top left of
  the screen, which is the north player's right hand.
- Phones show the short form as a badge: *SW*, *N*, *SE* (the initials).

| Layout | Seats (in seat-number order) |
| --- | --- |
| 2 | south, north |
| 4 | south, west, north, east (clockwise) |
| 6 | southwest, southeast, northeast, northwest, east, west: two on each long side, one at each end |
| 8 | southwest, south, southeast, northeast, north, northwest, east, west: three on each long side, one at each end |

Seat numbers go along south from west to east, then along north from east to west (so around the table), then east,
then west.

```
                       north edge (top of the screen)
            ┌────────────────────────────────────────────────┐
            │   northwest          north          northeast  │
            │                                                │
  west edge │  west                                    east  │ east edge
            │                                                │
            │   southwest          south          southeast  │
            └────────────────────────────────────────────────┘
                      south edge (bottom of the screen)
```

Each seat's seat plate, and anything a game draws for that player, is turned to face the seat's edge, so it reads
upright from there (`seatPositions()`, `ROT`). The lobby and the menus face one edge at a time: the board's corner
buttons turn them to north, east, south or west (D-080). In code: `seatEdges(layout)`, `seatName(edges, seat)`,
`seatTitle()` ("Southwest seat").

## People and seats

| Term | What it is | In the code | Avoid |
| --- | --- | --- | --- |
| **Player** | Anyone with a seat in the lobby or a game: a person at the table, a remote player or an AI player. | `players`, `PlayerInfo` | user |
| **Seat** | A place at the table, on an edge (2, 4, 6 or 8 per layout). A player takes a seat; a game's rules know players by seat number. | `seat`, `seats` | position, slot |
| **Seat plate** | The box on the board with a player's name, colour and status, at their seat; games may restyle it. | `seatPlates()`, `.kit-plate` (in a game), `.seat` (in the lobby) | player box, name tag, badge |
| **AI player** | A seat played by the game's AI, shown as "(AI)". | `kind: "ai"` | bot, CPU, computer |
| **Remote player** | A person who plays from elsewhere, through an invite: the remote board in their browser and their deck beside it. | `location: "remote"` | online player, guest |
| **Watcher** | Someone remote who sees the board only: no seat, no deck, not one of the players. | `watchers` | spectator, viewer (the Game Viewer is something else) |
| **Remote place** | What a remote player or watcher uses up; a table has four by default. | `maxRemotePlayers` (`MAX_REMOTE_PLAYERS`), `remotePlaces()` | — |
| **Away** | A player whose phone has gone (locked, out of range, closed). The seat waits; after 15 s the board says so at the seat. | `away` | disconnected, offline, dropped |
| **Leave** | A player taps *Leave the game* on their phone: handled like away, at once. | `leftGame`, `away[].left` | quit |
| **Exchange** | Hand a seat to someone else during a game (a person at the table, a remote player, a watcher or an AI player); the game carries on with its score. | `exchange`, `onSeatChanged` | replace, swap, kick |
| **Stand-in** | A game's own AI playing for an away player until the seat is exchanged (Chess and Backgammon in extra-games; not a platform feature). | `standIn` | — |

## Joining and running a table

| Term | What it is | In the code | Avoid |
| --- | --- | --- | --- |
| **Lobby** | The board's screen before and between games: seats, the chosen game, its settings, the QR code. | `lobby` | menu, home |
| **Join code** | The code (and QR code) on the board that gives a phone a seat. | `joinUrl`, `joinToken`, `/j/…` | room code, PIN |
| **Invite** | A link from the game service that brings a remote player or watcher to the table. | `invite` | — |
| **Table key** | The secret that lets a browser control the table (the board, its settings, the board control API). | `TABLE_KEY` | password |
| **Board control** | What a board may do for players: moves by touching the board (`boardIntents`) for the seats in `info.controlSeats`, and skipping a wait. A remote board controls only its own player's seat. | `boardControl`, `controlSeats`, `remoteControl` | — |
| **Play from the board** | A developer setting: one player's deck shown beside the board, to test without a phone (D-175). | `boardDeck` | — |
| **Settings** | The table's choices for a game (rounds, timers, house rules), set in the lobby before it starts. | `settings` (manifest) | options (that's an AI player's), config |
| **Preferences** | How the board looks and sounds for a game (a background, card speed, sound), changeable any time. | `prefs` | settings |

## Games

| Term | What it is | In the code | Avoid |
| --- | --- | --- | --- |
| **Game** | A folder with a manifest, rules, a board UI, a deck UI and rules for players. | `games/<id>/` | app, plugin |
| **Built-in game** | A game in this repository (Coin Flip, Hold'em, Pachisi, Roulette). | `games/` | core game |
| **Extra-game repository** | Another repository whose `games/` folder a table installs, like `extra-games`. | `GAME_REPOS`, `deploy/game-repos.json` | plugin repo, add-on |
| **Test game** | A game hidden unless the table shows test games, like Card Sling. | `"test": true` | — |
| **Rules** | The game's logic: pure functions on a JSON state, run by the Table Host. | `rules.ts`, `defineGame` | engine, server code |
| **Intent** | A move a player (or the board, or an AI player) asks for; the rules accept or reject it. | `intent`, `onIntent` | action, command, message |
| **Event** | What just happened, sent with a view for the UIs to animate (a card played, a die rolled). | `events` | — |
| **View** | What one seat may see, drawn by its deck. | `view` | state (the state is everything) |
| **Board view** | What everyone may see, drawn by the board. | `boardView` | public state |
| **Rules for players** | The game's how-to-play, shown on the phones and the board. | `how-to-play.md` | manual, help |
| **Awards** | The cards at the end of a game: who did the most (or least) of something. | `mostAward`, `leastAward` | achievements, badges |
| **Version** | A game's (and a release's) calendar version, `YYYY.MM.DD.N`. | `version` | — |

## Moving things from the phone to the board

| Term | What it is | In the code | Avoid |
| --- | --- | --- | --- |
| **Sling** | Pushing a card (or anything) up and off the top of the deck onto the board; the board shows it coming in at the player's seat while the finger is down, then it flies to where it goes (D-189). Also the platform module that does it. | `/shared/sling.js`, `slingDeck`, `slingBoard` | swipe, throw, flick (a flick is one way to sling) |
| **Gesture** | The live, unlogged message a deck sends to the boards while something is being dragged. | `ctx.gesture`, `gesture(seat, data)` | — |
| **Release line** | A line under the deck's status: let go of a card above it and it is slung toward the middle (D-193). | `line()`, `sling-armed` | — |
| **Flight** | A thing flying across the board, from a seat to its place or from the pile to a seat. | `fly`, `toSeat`, `flight` | animation (too vague) |

## Tools

| Term | What it is | In the code | Avoid |
| --- | --- | --- | --- |
| **Log** | The record of a game: settings, players and every intent, kept to replay it. | `logs` | history (in the code, the Game Viewer's API, `/api/v1/history`), transcript |
| **Replay** | Running a finished game's log through the rules again, to check it reaches the same state. | `replay` | — |
| **Game Viewer** | The board's window that walks through a game's moves. | `viewer.js` | replay viewer, debugger |
| **Simulation** | Games played by AI players only, as fast as possible, to test a game. | `simulation` | bot run |
| **Statistics** | The window with the awards and each player's numbers after a game. | `stats.js`, `stats.ts` | scoreboard |

## The game service

| Term | What it is | In the code | Avoid |
| --- | --- | --- | --- |
| **Game service** | The cloud service at `games.skylar.technology`: enrolls tables, brokers remote players, collects logs and metrics, serves the website. In technical docs also *cloud service*. | `apps/cloud` | backend, server |
| **Console** | The game service's admin pages: overview, tables, access codes, game repositories, game logs, download tokens, log retention. In production they have a host of their own, games-console.skylar.technology (`CONSOLE_URL`), away from remote play; a local service has them at `/admin`. | `admin.html`, `/admin` | admin portal, dashboard |
| **Admin** | Someone signed in to the console. | `admin` | — |
| **Pairing code** | The code a new table shows until an admin approves it in the console. | `pairingCode` | — |
| **Access code** | A code from the console that approves a table at once and decides its games (D-113). | `accessCode`, `TABLE_CODE` | licence key |
| **Download token** | A token from the console that lets someone (or an AI agent) download game logs. | `download-tokens` | API key |
| **Website** | The public page at `/` of the game service, with the terms of service at `/terms`. | `home.html`, `terms.html` | landing page (fine in conversation) |

## Where the words still differ

Some older names stay in the code because games or tables already depend on them; new code uses the terms above.

- **Console** was called *admin portal* in early decisions; older records keep that name.
- **Game service** and **cloud service** name the same thing: the website says *game service*, technical docs often
  *cloud service* (`apps/cloud`).
- **Deck** is the code's word; text for players says *your phone*.
- Games keep their own words for their own parts (Backgammon's *panel* at each player's right hand, Mexican Train's
  *hub*), described in their decisions.
