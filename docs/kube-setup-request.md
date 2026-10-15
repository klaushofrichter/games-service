# Request to kube-setup: deploy games-cloud

From the games-service session, for the kube-setup session. It replaces the old `kube-setup-handoff.md`, which
assumed ingress-nginx and a hand-applied manifest. Everything below follows kube-setup's own vault (*Building a New
Service*, *Services*, *Networking and DNS*, *Container Security*) and `docs/cluster-deployment-requirements.md`.
Where this request deviates from the usual shape, it says why. Draft YAML is a starting point: adjust names and
labels to the cluster's conventions, and the manifests are yours to own.

**Nothing here is urgent:** the cluster is not ready yet (Klaus, 2026-10-12). The repo side is ready; see
*What games-service already did* at the end.

## The service in one paragraph

`games-cloud` is the cloud half of Game Table, at **https://games.skylar.technology**. Table PCs in people's homes
pair with it and keep **one outbound WebSocket** each (`/api/tables/ws`); remote players' browsers open a short
WebSocket (`/api/remote/ws`) to exchange one WebRTC offer and answer. Game traffic itself is peer-to-peer and never
passes through the cluster. Administrators sign in with Google (own OAuth client in project `skylar-technology`,
allow-list in `ALLOWED_EMAILS`); `/admin` without a session redirects to `/`, a public page with a Sign in link.
Node 26, listens on **8081**, image `ghcr.io/klaushofrichter/games-cloud`, numeric `USER 1000:1000`,
`GET /health` → `{"status":"ok","version":"YYYY.MM.DD.N"}`.

## Shape: a plain Deployment with its own Ingress, like cams-admin

- **Not a Knative Service.** Knative `DomainMapping` breaks WebSocket (vault, *Networking and DNS*), and tables hold
  their socket for hours. cams-admin solved the same problem with a Deployment and its own Ingress.
- **One replica, `strategy: Recreate`.** State is in memory for now (pairings, invites, uploaded logs), and the
  signaling sockets belong to one process. Do not scale it out: a second pod would not see the first one's tables.
- **Volume (done 15 Oct 2026, kube-setup `afc7bbe`).** PVC `games-cloud-data` (1Gi, `local-path`, PV set to
  Retain) at `/data`, `DATA_DIR=/data`, pod `fsGroup: 1000`, backed up by Velero's daily file-system backup (30 days).
  The service keeps its state there as SQLite (D-114): tables, access codes, repository ticks, console repositories,
  logs, invites. It writes a consistent snapshot to `/data/snapshots/state.db` hourly and at shutdown, and starts from
  it when `state.db` is missing or damaged; to force that after a restore, create `/data/RESTORE_FROM_SNAPSHOT`.
- **Ingress timeouts:** Traefik passes WebSocket upgrades on a normal Ingress. Tables send a ping every 30 s and
  reconnect if cut, so the defaults are fine; if Traefik's idle timeout is below 60 s, raise it for this host.

## What to create

### 1. DNS

`games.skylar.technology` A record at **Squarespace** → the current public IP (`curl -s https://api.ipify.org`),
like the other `*.skylar.technology` hosts. Klaus does this by hand (nothing automates those zones).

### 2. `manifests/games/`

| File | What |
| --- | --- |
| `namespace.yaml` | namespace `games` |
| `games-cloud-deployment.yaml` | the Deployment below. **The deploy bot rewrites its `image:` line** (`sed`, then `grep` to confirm), commits `Deploy games-cloud <sha>`, pushes, then `kubectl apply -f` this file |
| `games-cloud-service.yaml` | ClusterIP `games-cloud`, port 80 → 8081 |
| `games-cloud-ingress.yaml` | own Ingress for `games.skylar.technology`, cert-manager `letsencrypt-prod`, standalone certificate (not on the shared `knative-gateway` Ingress: adding a host there drops TLS for every host briefly) |
| `networkpolicy.yaml` | default-deny both ways, allows below |

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: games-cloud
  namespace: games
  labels: { app: games-cloud }
spec:
  replicas: 1
  strategy: { type: Recreate } # one process owns the in-memory state and the table sockets
  selector:
    matchLabels: { app: games-cloud }
  template:
    metadata:
      labels: { app: games-cloud }
    spec:
      containers:
        - name: cloud
          image: ghcr.io/klaushofrichter/games-cloud:REPLACED-BY-DEPLOY
          ports: [{ containerPort: 8081, name: http }]
          env:
            - { name: PUBLIC_URL, value: "https://games.skylar.technology" }
            # X-Forwarded-For only from loopback and the pod/service networks (10.42/16, 10.43/16): a CIDR list, not hops.
            - { name: TRUST_PROXY, value: "1" }
            - { name: LOG_RETENTION_DAYS, value: "90" }
            # Must match `replicas`; the service warns at startup otherwise (its state is in one process).
            - { name: MAX_REPLICAS, value: "1" }
          # GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, ALLOWED_EMAILS, COOKIE_SECRET (+ optional ADMIN_TOKEN)
          envFrom: [{ secretRef: { name: games-oauth } }]
          readinessProbe: { httpGet: { path: /health, port: http }, periodSeconds: 10 }
          livenessProbe: { httpGet: { path: /health, port: http }, periodSeconds: 30 }
          resources:
            requests: { cpu: 50m, memory: 96Mi }
            limits: { memory: 512Mi } # uploaded game logs are held in memory until the store lands
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: [ALL] }
            runAsGroup: 1000
            runAsNonRoot: true
            runAsUser: 1000
            seccompProfile: { type: RuntimeDefault }
            readOnlyRootFilesystem: true # checked: the service writes nothing to disk (CI runs the image --read-only)
```

**Network policy** (default-deny both ways, the cams-admin pattern):

- In: Traefik → pod port **8081**; Traefik → the ACME HTTP-01 solver pod on **8089**
  (`acme.cert-manager.io/http01-solver: "true"`), which is load-bearing for the certificate; Alloy if you scrape it.
- Out: DNS; **443 to the internet** (Google's token and certificate endpoints for sign-in, `oauth2.googleapis.com`
  and `www.googleapis.com`; since D-097 also `api.github.com` and `codeload.github.com` for extra-game repositories),
  excluding the pod and service CIDRs and `192.168.1.0/24`. Nothing else: the service
  calls nothing in the cluster or on the LAN.

### 3. `manifests/games-runner/`

Copy `cams-admin-runner` (it deploys a plain Deployment the same way), with:

- namespace `games-runner`, ServiceAccount `deploy-sa`, repo-scoped runner for `klaushofrichter/games-service`,
  label **`k3s`** (the workflow uses `runs-on: [self-hosted, k3s]`), `ACCESS_TOKEN` from Secret `runner-pat`
  (key `token`), the DinD sidecar bound to loopback with its sized `emptyDir`, default-deny ingress.
- **Role in namespace `games`:** `apps/deployments`, `resourceNames: [games-cloud]`, verbs `get`, `patch`, `watch`.
  The workflow polls `.status` instead of `kubectl rollout status` (which needs list), and its `kubectl apply` of an
  existing Deployment needs only get and patch. The first apply (create) is yours.
- The deploy job builds and pushes **both** images (`games-cloud` and `games-table-host`, the image table PCs pull),
  so the DinD `emptyDir` should allow two Node images per run; the job prunes images older than 7 days.

### 4. Secrets: created from the games-service repo, never here

`scripts/sync-secrets.sh` in games-service reads its local `.env` and, without printing values:

- `--cluster`: applies `games/games-oauth` (the five sign-in keys, plus the optional `GAME_REPO_TOKEN` for private
  extra-game repositories, D-097; the repository list itself is in the image, D-098) and `games-runner/runner-pat`
  (key `token`).
  It needs the two namespaces to exist first.
- `--github`: sets the repo secret `KUBE_SETUP_DEPLOY_TOKEN` (Contents read/write on kube-setup).

### 5. Pulling the image

The games-service repo is **public** since 14 Oct 2026 (D-096). A container package's visibility is set separately
from its repo, so `games-cloud` and `games-table-host` stay private until Klaus switches them to public in the
package settings; then the cluster (and table PCs) pull without a secret. Until then the cluster needs an image pull
secret for `games` (a token with `read:packages`). Whatever the other services do here is the right answer; please
say which.

### 6. Bookkeeping

- `scripts/export.sh` and `bootstrap.sh`: add both namespaces (deploy-bot commits do not).
- version-exporter `services.json`: a `pod_selector` for `app=games-cloud`, so it gets an uptime row.
- Vault: *Services* and *Networking and DNS* entries.

## Verify (the deploy does most of this on every run)

```bash
curl -s https://games.skylar.technology/health            # {"status":"ok","version":"YYYY.MM.DD.N"}
curl -s -o /dev/null -w '%{http_code}\n' https://games.skylar.technology/                     # 200
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://games.skylar.technology/admin # 302 https://games.skylar.technology/
curl -sI http://games.skylar.technology/ | head -1                                             # 301 to https
kubectl -n games exec deploy/games-cloud -- cat /proc/1/status | grep -E 'CapPrm|CapEff|CapBnd|NoNewPrivs|Seccomp'
```

Then a real sign-in in a browser, and a WebSocket check: start a table host with
`CLOUD_URL=https://games.skylar.technology`, approve its pairing code in the portal, and the table shows *online*.

## Order

1. kube-setup: namespaces, runner, Deployment (first apply with `ghcr.io/klaushofrichter/games-cloud:main`),
   Service, Ingress, NetworkPolicy, pull access. Klaus: DNS record.
2. games-service: `scripts/sync-secrets.sh --all`, restart the pod.
3. Klaus: create the `production` branch from `main` and protect it (below). That first push to `production` is
   the first real deploy.

Branch protection, once the PR checks have reported on a real PR (only require contexts that actually report):

```bash
gh api --method PUT repos/klaushofrichter/games-service/branches/production/protection \
  -H "Accept: application/vnd.github+json" \
  -F "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=test" \
  -f "required_status_checks[contexts][]=codeql" \
  -f "required_status_checks[contexts][]=e2e" \
  -F "enforce_admins=false" -F "required_pull_request_reviews=null" -F "restrictions=null" \
  -F "allow_force_pushes=false" -F "allow_deletions=false"
```

## What games-service already did (2026-10-13)

- Node 26 in both Dockerfiles, the workflows and `@types/node`; images end with `USER 1000:1000`.
- `ARG APP_VERSION` → `/health` reports `{status, version}`; calendar versions generated at deploy time.
- Google sign-in for `/admin` with the vault's logout rule (lands on a 200 page with a Sign in link), allow-list
  checked on every request, `COOKIE_SECRET` kill switch, `TRUST_PROXY` as a CIDR list.
- The three workflows: `production-checks.yml` (`test` with typecheck, `npm audit --audit-level=high` and both
  images run non-root with no capabilities; `e2e` on GitHub's runners; `codeql` with the zero-findings gate and
  `.github/codeql-accepted.tsv`), `build-push.yml` (`:main` only), `deploy-production.yml` (as above).
- Dependabot config, labels `dependencies` and `ci`, README badges, `CHANGELOG.md`.
- Not yet, needs Klaus (the session's GitHub access cannot change repository settings):
  `gh api -X PUT repos/klaushofrichter/games-service/vulnerability-alerts`,
  `gh api -X PUT repos/klaushofrichter/games-service/automated-security-fixes`,
  `gh api -X PATCH repos/klaushofrichter/games-service -F delete_branch_on_merge=true`.
