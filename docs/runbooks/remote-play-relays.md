# Runbook: relays for remote play (TURN)

Remote play connects a remote player's browser **directly** to the table over WebRTC; the game service only passes
on the first handshake. A direct connection needs both ends' networks to let it through. Most home networks do. A
phone's **hotspot or cellular data** usually doesn't (the carrier's NAT), and neither do some hotel, office or school
networks. Then the invite page shows *Opening direct connection to …*, tries a few times and gives up.

A **TURN server** relays the connection in those cases. WebRTC uses it only when the direct way fails, so players on
ordinary home internet keep their direct connection. This runbook sets one up for a game service, with Cloudflare's
TURN service (D-209), and says how to check it.

## Do you need it?

| Situation | Needs a relay? |
| --- | --- |
| A table on one machine, phones on the same WiFi (the local runbook) | No: nothing crosses the internet |
| Remote players on home internet (cable, fibre, DSL) | Usually not |
| A remote player on a phone's hotspot or cellular data | Usually yes |
| A remote player in a hotel, office or school network | Sometimes |

Without a relay nothing breaks: remote play works wherever a direct connection does, as before. A game service
without the Cloudflare key, or whose relay fails, gives out a STUN server only (which finds addresses but relays
nothing): `ICE_SERVERS` if set, otherwise Google's public STUN.

## How it works

- The service holds a **Cloudflare TURN key**: an id (`CF_TURN_KEY_ID`) and an API token (`CF_TURN_API_TOKEN`).
  The key never leaves the service.
- When the first remote player connects (and once at start), it asks Cloudflare for relay credentials that expire
  after a day, keeps them, and renews them when less than 12 hours are left.
- Each connection's handshake carries these credentials to the remote browser and to the table. Both try the direct
  way first and use the relay only if it fails.
- If Cloudflare can't be reached or refuses the key: the current credentials while they last, then STUN only; the
  service tries again a minute later.
- Cloudflare's free allowance covers a table's remote players many times over; see Cloudflare's pricing for the
  current numbers. Code: `apps/cloud/src/turn.ts`.

## Set it up

1. **Create the key.** In the Cloudflare dashboard: *Realtime › TURN Server › Create* (older menus: *Calls*). Give it
   a name (e.g. `game-table`). Cloudflare shows a **Turn Token ID** and an **API Token**; the token is shown once.
2. **Store it** where the service's other secrets are, never in the repository. For this project's cluster: in the
   games-service `.env` of the machine that runs `scripts/sync-secrets.sh`:
   ```
   CF_TURN_KEY_ID=<Turn Token ID>
   CF_TURN_API_TOKEN=<API Token>
   ```
   Both or neither: with only one, the service refuses to start and says so.
3. **Put it into the cluster and restart** (the service reads its Secret only at start). On the machine with cluster
   access, in a checkout that is up to date (an older `sync-secrets.sh` doesn't know these keys):
   ```sh
   export KUBECONFIG=~/.kube/k3s-config     # this project's cluster; without it kubectl may reach another one
   scripts/sync-secrets.sh --check           # lists CF_TURN_KEY_ID CF_TURN_API_TOKEN among the games-oauth keys
   scripts/sync-secrets.sh --cluster
   kubectl -n games rollout restart deployment/games-cloud
   ```
   Elsewhere (your own server, `docker compose`): set the two variables in the cloud service's environment.

## Check it

- The service's first log lines:
  - `relays: Cloudflare TURN` and then `Cloudflare TURN: relay credentials ready`: working.
  - `relays: STUN only`: the keys did not reach the service (step 3).
  - `Cloudflare TURN credentials: <reason>; using STUN only`: Cloudflare refused or could not be reached; the reason
    says which (an HTTP 401 or 403 is a wrong or revoked token).
  ```sh
  kubectl -n games logs deployment/games-cloud | head -5
  ```
- The real test: invite a remote player and open the invite on a phone on **cellular data** (WiFi off), or on a
  laptop on a phone's hotspot. The board and the deck should come up within a few seconds.
- On the host, `curl -s https://rtc.live.cloudflare.com/` must reach Cloudflare (any HTTP answer): the service needs
  outgoing HTTPS to it. In this project's cluster the games namespace allows HTTPS out.

## Change or remove it

- **A new token** (rotated or revoked in Cloudflare): replace it in `.env`, run `--cluster` and restart. Credentials
  already handed out keep working until they expire (a day).
- **Remove:** delete both lines, run `--cluster` (the Secret is rewritten without them) and restart; the start-up
  line says `relays: STUN only`.
- **Another TURN server** (your own coturn, another provider): set `ICE_SERVERS` to its JSON list instead, e.g.
  `[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example:3478","username":"u","credential":"p"}]`.
  Those credentials are fixed and visible to every invited browser; Cloudflare's expire. With both set, Cloudflare's
  are used and `ICE_SERVERS` is the fallback.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `kubectl` says `connection refused` on `localhost:8080` | No cluster configured in that shell: `export KUBECONFIG=…` (step 3) |
| `--check` doesn't list the CF keys | An older checkout: `git pull`, then again |
| The log says `STUN only` after a sync | The service was not restarted, or the sync went to another cluster |
| Still no connection with `relay credentials ready` | Check the table's own network allows UDP out (a strict firewall at the table); try the remote player on another network |
