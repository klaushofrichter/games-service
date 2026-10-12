# Hand-off for the kube-setup agent: deploy the Game Table cloud service

Audience: the Claude session that maintains the Kubernetes cluster from `klaushofrichter/kube-setup`. Klaus can paste this file into that session. It describes what to deploy; the cluster-specific choices (ingress class, certificate issuer, registry access) belong to that session.

## What to deploy

One service, `games-cloud`, at `https://games.skylar.technology`:

- Container: `ghcr.io/klaushofrichter/games-cloud:<version>` (built and pushed by this repo's CI on every push to `main`; `latest` is also tagged). Node 22, listens on port **8081**, health check `GET /health`.
- Phase 1 keeps all state **in memory**: run exactly **one replica** with `strategy: Recreate`. Data (table pairings, uploaded logs) is lost on restart until PostgreSQL is added. That is acceptable for now.
- Environment:
  - `ADMIN_TOKEN` (secret, at least 16 characters): bearer token for `/admin/api/*`.
  - `PUBLIC_URL=https://games.skylar.technology`: used to build invite and download links.
  - `LOG_RETENTION_DAYS=90`.
  - `TRUST_PROXY=1`: take the client address from the ingress's `X-Forwarded-For` (rate limits on invite lookups are per client).
  - `ICE_SERVERS` (JSON, optional): STUN/TURN servers handed to tables and remote browsers for remote play, e.g. `[{"urls":"stun:stun.l.google.com:19302"}]`. If it lists a TURN server with credentials, keep it in the Secret.
- Request bodies up to 50 MB (log uploads to `PUT /api/tables/logs/{id}`): raise the ingress body-size limit, e.g. `nginx.ingress.kubernetes.io/proxy-body-size: 64m` for ingress-nginx.
- **WebSockets (phase 1c, remote play):** `/api/tables/ws` (each table keeps one open while it runs) and `/api/remote/ws` (a remote browser, briefly, while connecting). ingress-nginx passes WebSocket upgrades by default; raise the idle timeouts so table sockets aren't cut every minute: `nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"` and `proxy-send-timeout: "3600"` (tables also send a ping every 30 s and reconnect if cut).
- **Game traffic does not pass through the cluster:** remote players connect peer-to-peer to the table over WebRTC; the service only relays one offer and one answer. A **TURN server** (e.g. coturn) is only needed for players behind strict NATs. It is optional for now; if added, it needs UDP 3478 (and a relay port range) reachable from the internet, which usually means a `LoadBalancer`/`hostNetwork` deployment outside the HTTP ingress. Then list it in `ICE_SERVERS`.

A starting manifest is in `deploy/k8s/cloud.yaml` (namespace `games`, Secret, Deployment, Service, Ingress with TLS via cert-manager). Adjust:

1. `ingressClassName` and the `cert-manager.io/cluster-issuer` annotation to what the cluster uses.
2. The image pull: the GHCR package is private by default. Either make the package public, or create an `imagePullSecrets` entry with a GitHub token that has `read:packages`.
3. Replace the placeholder `ADMIN_TOKEN` (better: create the Secret out of band and remove it from the file).

## DNS

`games.skylar.technology` must point at the cluster's ingress (Klaus says the name is available).

## Verify

```sh
curl -fs https://games.skylar.technology/health                    # {"ok":true}
curl -fs -H "Authorization: Bearer $ADMIN_TOKEN" https://games.skylar.technology/admin/api/tables   # []
```

Then start a Table Host with `CLOUD_URL=https://games.skylar.technology`. Its board (and its log) shows a 6-character pairing code; approve it:

```sh
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://games.skylar.technology/admin/api/tables/pair/<CODE>
```

The board's cloud notice disappears and `GET /admin/api/tables` lists the table as online. Play one game; `GET /admin/api/logs` lists its log and `GET /admin/api/metrics` counts it.

Remote play check: on the table's board tap *Invite…*, open the link in a browser elsewhere, enter a name. The board should show the player at a seat marked *Remote* within a few seconds.

## Admin API (phase 1)

| Call | Purpose |
| --- | --- |
| `GET /admin/api/tables` | Tables, pairing status, online flag, last metrics |
| `POST /admin/api/tables/pair/{code}` | Approve a table showing that pairing code |
| `POST /admin/api/tables/{tableId}/revoke` | Disconnect a table |
| `GET /admin/api/metrics` | Games played, terminated, total game time, simulations |
| `PUT /admin/api/settings` `{logRetentionDays}` | Retention, synced to tables |
| `GET /admin/api/logs`, `GET /admin/api/logs/{id}.zip` | Game logs |
| `POST /admin/api/download-tokens` `{gameId?, expiresInHours}` | Token URL for pipelines without a login (`/dl/{token}`) |

The admin portal page is at `/admin` (sign in with `ADMIN_TOKEN`). Version 0.3.0 adds remote play; the manifest in `deploy/k8s/cloud.yaml` already carries the annotations and `ICE_SERVERS` above.
