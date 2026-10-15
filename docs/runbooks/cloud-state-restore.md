# Runbook: restore the service's state

Two situations, from mild to rare. games-cloud keeps its state in SQLite on the PVC `games-cloud-data` at `/data`
(D-113): the live `state.db`, a consistent copy in `snapshots/state.db` (written at start, hourly and at shutdown), and
uploaded logs in `logs/`. Velero backs the volume up daily (schedule `daily-full-backup`, 08:30 UTC, kept 30 days).

Who runs it: someone with `kubectl` (case A) and `velero` (case B) on the cluster: Klaus or kube-setup's on-node
session. kube-setup owns Velero; if a step below differs from how the cluster runs it, the cluster's way wins.

## A. The database is damaged, the volume is fine

Usually nothing to do. At every start the service checks `state.db` (it must open and pass SQLite's `quick_check`). If
it is missing or damaged, the service starts from `snapshots/state.db` by itself and keeps the damaged file beside it
as `state.db.damaged-<time>`. A restart is enough:

```bash
kubectl -n games rollout restart deploy/games-cloud
kubectl -n games rollout status deploy/games-cloud --timeout=180s
kubectl -n games logs deploy/games-cloud | grep -E 'state (opened|snapshot)|ERROR'
```

`state snapshot` in the log means it recovered; changes since that snapshot (at most an hour) are lost.

To use the snapshot even though `state.db` still opens (say, it holds something wrong that the snapshot does not),
create the marker file and restart; the service removes the marker and keeps the replaced file as `state.db.replaced-<time>`:

```bash
kubectl -n games exec deploy/games-cloud -- sh -c 'ls -l /data/snapshots/state.db && touch /data/RESTORE_FROM_SNAPSHOT'
kubectl -n games rollout restart deploy/games-cloud
```

## B. Go back to a backup (the volume is lost, or the state is wrong as a whole)

This replaces the whole volume with Velero's copy: everything since that backup is lost (tables approved since then
pair again, logs uploaded since then are gone).

Stop at the first unexpected result.

**0. Pick the backup** and, if the current state might still be wanted, back it up first:

```bash
velero backup get | grep -E 'NAME|games|daily-full'
velero backup describe <backup> --details | grep -E 'Phase|games-cloud-data|data'   # Completed, with the PodVolumeBackup for "data"
velero backup create games-before-restore-$(date -u +%Y%m%d%H%M) --include-namespaces games --wait   # optional
```

**1. Remove the service and its volume claim**, so Velero restores them (it skips what already exists). The PV is set
to *Retain*, so the old data stays on the node as a *Released* PV until it is deleted by hand: a fallback.

```bash
kubectl -n games scale deploy/games-cloud --replicas=0
kubectl -n games wait --for=delete pod -l app=games-cloud --timeout=120s
kubectl get pv | grep games-cloud-data                 # note the old PV's name
kubectl -n games delete deploy/games-cloud
kubectl -n games delete pvc games-cloud-data
```

**2. Restore** the Deployment, the claim and the pod's volume from the backup:

```bash
velero restore create games-restore-$(date -u +%Y%m%d%H%M) --from-backup <backup> --include-namespaces games \
  --include-resources deployments.apps,replicasets.apps,pods,persistentvolumeclaims,persistentvolumes --wait
velero restore describe games-restore-<that name> --details | grep -E 'Phase|PodVolumeRestore|data'   # Completed
```

**3. Start from the snapshot.** The backup copied files of a running database; `snapshots/state.db` in it is the
consistent one (at most an hour older than the backup), so make the service use it:

```bash
kubectl -n games exec deploy/games-cloud -- sh -c 'ls -l /data /data/snapshots && touch /data/RESTORE_FROM_SNAPSHOT'
kubectl -n games rollout restart deploy/games-cloud
kubectl -n games rollout status deploy/games-cloud --timeout=180s
kubectl -n games logs deploy/games-cloud | grep -E 'RESTORE_FROM_SNAPSHOT|state '
curl -s https://games.skylar.technology/health
```

**4. Bring the manifest back in line.** The restored Deployment is the one from the backup; apply the current one from
kube-setup so the image and settings are today's (or run the next deploy):

```bash
kubectl apply -f manifests/games/games-cloud-deployment.yaml     # in kube-setup
```

**5. Check in the console:** tables, access codes and logs as of the backup. Tables approved after the backup show a
pairing code again (or are approved by their access code, if that code existed then). Once all is well, delete the old
*Released* PV from step 1.

## One record rather than everything

The console can't bring back a single deleted table, code or log. To get one back, restore the backup into a scratch
namespace (`velero restore create … --namespace-mappings games:games-scratch`), copy the file you need out of its
`/data` (a log is `logs/<id>.zip`), and delete the scratch namespace. A table or access code is quicker to create again.
