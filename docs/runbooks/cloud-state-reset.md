# Runbook: reset the service's state

Empties games-cloud's persistent state (D-113): every paired table, access code, repository tick, console-added
repository, uploaded game log, invite, download token and setting. Afterwards the service starts as if new: every
table shows a pairing code (or uses an access code you create anew), and the console lists only the repositories from
`deploy/game-repos.json`.

**Use this only to start over.** To remove single records, use the console instead (D-114): *Delete* on a
disconnected table, *Delete* on a log or *Delete all simulation logs*, *Revoke* on a download token, *Delete* on an
access code.

Who runs it: someone with `kubectl` on the cluster (Klaus or kube-setup's on-node session). It takes about five
minutes; the service is down for one or two of them. Reviewed against the cluster by kube-setup on 15 Oct 2026 (the
reset pod passes admission in a server-side dry run).

## What is where

| Thing | Value |
| --- | --- |
| Namespace / Deployment | `games` / `games-cloud` (one replica, `Recreate`, label `app=games-cloud`) |
| Volume | PVC `games-cloud-data` (`local-path`, PV *Retain*), mounted at `/data`, `DATA_DIR=/data` |
| Files | `state.db` (+ `-wal`, `-shm`), `snapshots/state.db` and `state.prev.db`, `logs/*.zip`, up to three `state.db.damaged-*` / `state.db.replaced-*` from recoveries, and `.velero/` after a restore |
| Backups | Velero `Schedule` `daily-full-backup` (`30 8 * * *` UTC, TTL 720h = 30 days), repository `games-default-kopia` |

**Rule: Velero backs the volume up only while a games-cloud pod is running.** The volume is opted in through the pod's
annotation (`backup.velero.io/backup-volumes: data`); the cluster does not set `defaultVolumesToFsBackup`. A backup
taken while the service is scaled to 0 (including the 08:30 UTC daily one) contains no `/data`. So back up *before*
scaling down, never after.

## Steps

Stop at the first unexpected result. The commands use `kubectl` with Velero's objects in namespace `velero`; there is
no `velero` CLI on the kube-setup Mac.

**0. Back up first, while the service runs**, so the reset can be undone (`cloud-state-restore.md`, case B):

```bash
B=games-before-reset-$(date -u +%Y%m%d%H%M)
kubectl create -f - <<EOF
apiVersion: velero.io/v1
kind: Backup
metadata: { name: $B, namespace: velero }
spec: { includedNamespaces: [games], ttl: 720h0m0s }
EOF
until [[ "$(kubectl -n velero get backup $B -o jsonpath='{.status.phase}')" =~ ^(Completed|PartiallyFailed|Failed)$ ]]; do sleep 5; done
kubectl -n velero get backup $B -o jsonpath='{.status.phase}{"\n"}'                       # Completed
kubectl -n velero get podvolumebackups -l velero.io/backup-name=$B                        # one for "data", Completed
```

**1. Stop the service**, so nothing writes while the files go. Note its image first, for step 2:

```bash
IMG=$(kubectl -n games get deploy games-cloud -o jsonpath='{.spec.template.spec.containers[0].image}'); echo $IMG
kubectl -n games scale deploy/games-cloud --replicas=0
kubectl -n games wait --for=delete pod -l app=games-cloud --timeout=120s
```

**2. Empty the volume** with a short-lived pod that mounts it: the Deployment's own pinned image, as uid 1000, no
capabilities, read-only root. It needs no network.

```bash
kubectl -n games run games-reset --rm -i --restart=Never --image="$IMG" --overrides="$(cat <<EOF
{"spec":{"securityContext":{"runAsUser":1000,"runAsGroup":1000,"fsGroup":1000,"runAsNonRoot":true,"seccompProfile":{"type":"RuntimeDefault"}},
  "containers":[{"name":"games-reset","image":"$IMG","command":["sh","-c","ls -la /data && find /data -mindepth 1 -delete && echo EMPTY && ls -la /data"],
    "securityContext":{"allowPrivilegeEscalation":false,"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]}},
    "volumeMounts":[{"name":"data","mountPath":"/data"}]}],
  "volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"games-cloud-data"}}]}}
EOF
)"
```

Expect a listing of the files, then `EMPTY` and an empty listing (`.velero/` from an earlier restore goes too).

**3. Start the service again:**

```bash
kubectl -n games scale deploy/games-cloud --replicas=1
kubectl -n games rollout status deploy/games-cloud --timeout=180s
kubectl -n games logs deploy/games-cloud | grep 'state new'   # [cloud] state new in /data: 0 tables, 0 access codes, 0 logs, …
curl -s https://games.skylar.technology/health
```

**4. Afterwards:** tables show a pairing code within 30 seconds; approve them in the console, or create access codes
and give them to the tables. Tables keep their own copies of game logs until their retention ends; they are not
uploaded again. The next deploy keeps `replicas: 1` from the manifest, so a forgotten step 3 is undone by the next
release too.
