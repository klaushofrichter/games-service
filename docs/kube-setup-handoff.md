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
- Request bodies up to 50 MB (log uploads to `PUT /api/tables/logs/{id}`): raise the ingress body-size limit, e.g. `nginx.ingress.kubernetes.io/proxy-body-size: 64m` for ingress-nginx.
- No WebSockets needed in phase 1 (tables use HTTPS polling for heartbeat). Phase 1c will add WebRTC signaling and a TURN server; that comes later.

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
