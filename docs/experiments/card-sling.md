# Experiment: slinging cards from the phone to the board

Branch `experiment/card-sling`, not for production. A study for an UNO game in extra-games: a card dragged off the
top of a phone shows up on the board at that player's seat while it is being dragged, and flies to the pile when it
is played; a drawn card flies from the pile to the seat and comes in at the top of the phone.

## Try it

```
git fetch origin experiment/card-sling && git checkout experiment/card-sling
docker compose -f deploy/local/docker-compose.yml up -d --build   # or: node apps/table-host/src/main.ts
```

Open the board, join with a phone (or use *Play from the board* in the developer settings for one window), add a few
AI players and pick **Card Sling (experiment)**. Push a card up and off the top of the phone: the board shows the part
that has left the phone. Let go with half of it out, or flick it, and it flies onto the pile; otherwise it slides
back. **Draw a card** sends one from the pile to your seat and into your phone. AI players play one card every few
seconds (*Seconds between AI moves*).

`python3 scripts/e2e/card_sling.py out/` plays it in Chromium and saves screenshots of each stage.

## How it works

**A live gesture channel (platform, about 20 lines).** A phone's game may call `ctx.gesture(data)`: a small JSON
object (512 bytes at most) sent over the phone's socket with no answer. The table host passes it to every board,
local and remote, as `{ seat, data }`, and the board calls the game's `gesture(seat, data)` hook. It is not an
intent: no rules run, nothing is logged or replayed, nothing reaches other phones, and it is dropped outside a running
game, for a player without a seat, or when one phone sends more than one every 8 ms. Remote players' decks reach the
host over the same socket handler (WebRTC), so they need nothing extra.

**The phone (`games/card-sling/deck.js`).** The game's area clips its content at the top: that edge is where a card
leaves the phone. While a card is dragged the phone sends `{ card, f, x }` at most once per animation frame: `f` is
the share of the card above that edge (0 to 1), `x` the card's position across the phone (−1 to 1). Letting go
decides: more than half out, or a flick upward faster than 0.8 px/ms, plays it (the card glides out of view while its
last poses are sent, then the `play` intent); else it glides back and the phone sends `{ end: true }`. A drawn card
slides in from the top after a short delay, so it arrives after the board has thrown it.

**The board (`games/card-sling/board.js`).** Each seat has a slot just inside its plate, turned to face the player,
that clips a card: the card shows as much of itself as has left the phone. One animation loop eases every slot
toward its latest gesture (half the way per frame), so 30–60 messages a second look smooth and a lost one does not
show. When the `played` event arrives, the card flies from where the drag left it (or from the seat, for AI players
and when no gesture came) to its place on the pile; the pile shows it only once it has landed. A `drew` event throws
a card back from the pile to the seat, where it slips into the slot and disappears under the plate.

## What we learned

- **Smooth and cheap.** A drag sends one message per frame while the card is out, about 60 bytes each; nothing while
  it is still inside the phone. The board animates only `transform` (and opacity), on a few elements.
- **Synchronisation is good enough without clocks.** The gesture shows the drag as it happens; the move itself goes the
  normal way (intent, rules, new views), and the board starts its flight from wherever the gesture left the card, so
  there is no jump. A draw is timed by delays (board flight 420 ms, phone entry after 330 ms).
- **AI players and remote players get the same animation.** AI cards have no gesture and fly in from their seat.
  Remote players' gestures reach their own board window too: their card emerges at their seat on their screen.
- **The decision is the game's.** Half out or a flick is a phone-side rule; the rules only see `play`.

## Open questions before UNO

1. **Is `ctx.gesture` a platform feature?** If yes: document it in the developer guide (`deck` ctx and the board's
   `gesture` hook), add it to the SDK types and `tests/developer-docs.test.ts`, decide the rate limit, and record a
   decision. It suits any game with a drag (cards, dice, chess pieces dragged on a phone).
2. **Revealing a card early.** The board shows the card's face while it is being dragged, before it is played. Fine for
   UNO (it is about to be shown anyway); a game that must not reveal a card until it is accepted would send only the
   back, or show the face once the move is accepted.
3. **A card that cannot be played.** In UNO most cards will not match. The phone can know (the view lists playable
   cards) and refuse to let an unplayable card go past half, or let it bounce back from the top.
4. **Drawing from the board.** Tapping the draw pile on the board needs to know who is tapping; with *Play from the
   board* (one player) that is clear, at a shared table it is not. Drawing from the phone is simpler.
5. **Measure on real hardware.** Latency phone → host → board on WiFi, and the board PC's frame rate with eight
   players dragging at once.
