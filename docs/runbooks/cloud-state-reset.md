# Runbook: reset the service's state

Empties games-cloud's persistent state (D-113): every paired table, access code, repository tick, console-added
repository, uploaded game log, invite, download token and setting. Afterwards the service starts as if new: every
table shows a pairing code (or uses an access code you create anew), and the console lists only the repositories from
`deploy/game-repos.json`.

**Use this only to start over.** To remove single records, use the console instead (D-114): *Delete* on a
disconnected table, *Delete* on a log or *Delete all simulation logs*, *Revoke* on a download token, *Delete* on an
access code.

Who runs it: someone with `kubectl` and `velero` on the cluster (Klaus or kube-setup's on-node session). It takes about
five minutes, and the service is down for one or two of them.

## What is where

| Thing | Value |
| --- | --- |
| Namespace / Deployment | `games` / `games-cloud` (one replica, `Recreate`) |
| Volume | PVC `games-cloud-data` (`local-path`, PV set to *Retain*), mounted at `/data`, `DATA_DIR=/data` |
| Files | `state.db` (+ `-wal`, `-shm`), `snapshots/state.db`, `logs/*.zip`, and up to three `state.db.damaged-*` / `state.db.replaced-*` from recoveries |
| Backups | Velero schedule `daily-full-backup` (08:30 UTC, kept 30 days) |

## Steps

Stop at the first unexpected result.

**0. Take a backup first**, so the reset can be undone (see `cloud-state-restore.md`):

```bash
velero backup create games-before-reset-$(date -u +%Y%m%d%H%M) --include-namespaces games --wait
velero backup describe games-before-reset-<that name> --details | grep -E 'Phase|data'   # Phase: Completed, PodVolumeBackup data Completed
```

**1. Stop the service**, so nothing writes while the files go:

```bash
kubectl -n games scale deploy/games-cloud --replicas=0
kubectl -n games wait --for=delete pod -l app=games-cloud --timeout=120s
```

**2. Empty the volume** with a short-lived pod that mounts it (the service image itself, as uid 1000, with no capabilities):

```bash
kubectl -n games run games-reset --rm -i --restart=Never --image=ghcr.io/klaushofrichter/games-cloud:latest \
  --overrides='{"spec":{"securityContext":{"runAsUser":1000,"runAsGroup":1000,"fsGroup":1000,"runAsNonRoot":true,"seccompProfile":{"type":"RuntimeDefault"}},
    "containers":[{"name":"games-reset","image":"ghcr.io/klaushofrichter/games-cloud:latest","command":["sh","-c","ls -la /data && find /data -mindepth 1 -delete && echo EMPTY && ls -la /data"],
    "securityContext":{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]}},
    "volumeMounts":[{"name":"data","mountPath":"/data"}]}],
    "volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"games-cloud-data"}}]}}'
```

Expect a listing of the files, then `EMPTY` and an empty listing. If the NetworkPolicy keeps the pod from pulling or
starting, ask kube-setup; the pod needs no network at all.

**3. Start the service again:**

```bash
kubectl -n games scale deploy/games-cloud --replicas=1
kubectl -n games rollout status deploy/games-cloud --timeout=180s
kubectl -n games logs deploy/games-cloud | grep 'state new'   # [cloud] state new in /data: 0 tables, 0 access codes, 0 logs, …
curl -s https://games.skylar.technology/health
```

**4. Afterwards:** tables show a pairing code within 30 seconds; approve them in the console, or create access codes
and give them to the tables. Tables keep their own copies of game logs until their retention ends; they are not
uploaded again.

The next deploy keeps `replicas: 1` from the manifest, so a forgotten step 3 is undone by the next release too.
