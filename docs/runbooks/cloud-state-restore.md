# Runbook: restore the service's state

Two situations, from mild to rare. games-cloud keeps its state in SQLite on the PVC `games-cloud-data` at `/data`
(D-114): the live `state.db`; a consistent copy in `snapshots/state.db`, written at start, hourly and at shutdown;
`snapshots/state.prev.db`, the snapshot as the service found it at its last start; and uploaded logs in `logs/`.

Who runs it: someone with `kubectl` on the cluster (Klaus or kube-setup's on-node session). The commands use Velero's
objects in namespace `velero` (no `velero` CLI needed). kube-setup owns Velero: if a step differs from how the cluster
runs it, the cluster's way wins. Case B was tried by kube-setup on 15 Oct 2026 as a restore into a scratch namespace,
with the init hook below, against an empty volume: the mechanics work; a second run with real data is worthwhile once
the release that writes `/data` has been backed up.

**Backups:** Velero `Schedule` `daily-full-backup` (`30 8 * * *` UTC, kept 30 days). **A backup contains `/data` only
if a games-cloud pod was running when it was taken** (the volume is opted in through the pod's annotation), so a
backup from a time the service was scaled to 0 has no data.

## A. The database is damaged, the volume is fine

Usually nothing to do. At every start the service checks `state.db` (it must open and pass SQLite's `quick_check`). If
it is missing or damaged, the service starts from `snapshots/state.db` by itself and keeps the damaged file beside it
as `state.db.damaged-<time>`. With no snapshot it starts empty and keeps the damaged file aside (the log says
`ERROR: … there is no snapshot`). A restart is enough:

```bash
kubectl -n games rollout restart deploy/games-cloud
kubectl -n games rollout status deploy/games-cloud --timeout=180s
kubectl -n games logs deploy/games-cloud | grep -E 'state (opened|snapshot)|ERROR'
```

`state snapshot` in the log means it recovered; changes since that snapshot (at most an hour) are lost. A clean
shutdown also snapshots the database it is closing: if the log says `WARNING: snapshot failed`, or the recovered state
looks wrong, use `previous` below.

To go back to an earlier state even though `state.db` still opens, write `previous` into the marker file and
restart: `snapshots/state.prev.db` is the state as it was when the running pod started. The service removes the
marker and keeps the replaced database as `state.db.replaced-<time>`. An empty marker means `snapshots/state.db`, but
a restart writes that snapshot from the current state first (at shutdown), so it only helps when the pod did not shut
down cleanly (a crash, a lost node):

```bash
kubectl -n games exec deploy/games-cloud -- sh -c 'ls -l /data/snapshots && echo previous > /data/RESTORE_FROM_SNAPSHOT'
kubectl -n games rollout restart deploy/games-cloud
```

## B. Go back to a backup (the volume is lost, or the state is wrong as a whole)

This replaces the whole volume with Velero's copy: everything since that backup is lost (tables approved since then
pair again, logs uploaded since then are gone).

Stop at the first unexpected result.

**0. Update kube-setup and pick the backup.** `git pull` in kube-setup first (step 4 applies its manifest). The backup
must include the volume:

```bash
kubectl -n velero get backups --sort-by=.metadata.creationTimestamp | grep -E 'NAME|daily-full|games'
B=<backup>
kubectl -n velero get backup $B -o jsonpath='{.status.phase}{"\n"}'                       # Completed
kubectl -n velero get podvolumebackups -l velero.io/backup-name=$B | grep -E 'NAME|games'  # one for "data" in games, Completed
```

If the current state might still be wanted, back it up first, while the service runs (the Backup in
`cloud-state-reset.md`, step 0).

**1. Remove the service and its volume claim**, so Velero restores them (it skips what already exists). Note the image
(for the hook in step 2) and the old volume's path on the node. The PV is *Retain*, so the old data stays on the node
as a *Released* PV: a fallback.

```bash
IMG=$(kubectl -n games get deploy games-cloud -o jsonpath='{.spec.template.spec.containers[0].image}'); echo $IMG
OLDPV=$(kubectl -n games get pvc games-cloud-data -o jsonpath='{.spec.volumeName}'); echo $OLDPV
kubectl get pv $OLDPV -o jsonpath='{.spec.hostPath.path}{.spec.local.path}{"\n"}'          # note this directory
kubectl -n games scale deploy/games-cloud --replicas=0
kubectl -n games wait --for=delete pod -l app=games-cloud --timeout=120s
kubectl -n games delete deploy/games-cloud
kubectl -n games delete pvc games-cloud-data
```

**2. Restore**, with an init hook that sets `RESTORE_FROM_SNAPSHOT` after Velero has written the data and before the
app starts. The backup copied the files of a running database; `snapshots/state.db` in it is the consistent one (at
most an hour older than the backup), and the marker makes the service start from it.

```bash
R=games-restore-$(date -u +%Y%m%d%H%M)
kubectl create -f - <<EOF
apiVersion: velero.io/v1
kind: Restore
metadata: { name: $R, namespace: velero }
spec:
  backupName: $B
  includedNamespaces: [games]
  includedResources: [deployments.apps, replicasets.apps, pods, persistentvolumeclaims, persistentvolumes]
  hooks:
    resources:
      - name: games-cloud-restore-marker
        includedNamespaces: [games]
        labelSelector: { matchLabels: { app: games-cloud } }
        postHooks:
          - init:
              initContainers:
                - name: restore-marker
                  image: $IMG
                  command: [sh, -c, "touch /data/RESTORE_FROM_SNAPSHOT && ls -l /data /data/snapshots"]
                  securityContext:
                    runAsUser: 1000
                    runAsGroup: 1000
                    runAsNonRoot: true
                    allowPrivilegeEscalation: false
                    readOnlyRootFilesystem: true
                    capabilities: { drop: [ALL] }
                    seccompProfile: { type: RuntimeDefault }
                  volumeMounts: [{ name: data, mountPath: /data }]
EOF
until [[ "$(kubectl -n velero get restore $R -o jsonpath='{.status.phase}')" =~ ^(Completed|PartiallyFailed|Failed)$ ]]; do sleep 5; done
kubectl -n velero get restore $R -o jsonpath='{.status.phase} {.status.errors} {.status.warnings}{"\n"}'   # Completed, no errors
kubectl -n velero get podvolumerestores -l velero.io/restore-name=$R                                       # "data" Completed
```

Velero also restores the Deployment's old ReplicaSets (its revision history) and leaves a `.velero/` directory in
`/data`; both are harmless.

**3. Check the restored volume and the start:**

```bash
NEWPV=$(kubectl -n games get pvc games-cloud-data -o jsonpath='{.spec.volumeName}')
kubectl get pv $NEWPV -o jsonpath='{.spec.persistentVolumeReclaimPolicy}{"\n"}'   # Retain (Velero carries it over); if Delete, patch it to Retain
kubectl -n games logs deploy/games-cloud -c restore-marker                       # the files, with snapshots/state.db
kubectl -n games logs deploy/games-cloud | grep -E 'RESTORE_FROM_SNAPSHOT|state '  # started from the snapshot
```

If the restore ran without the hook, or the service started before the marker was set: its startup has replaced
`snapshots/state.db` with a copy of the restored `state.db`, but the backup's snapshot is still there as
`snapshots/state.prev.db`. Set the marker to `previous` (case A) before anything else restarts the service, then
continue with step 4.

**4. Bring the Deployment back in line** with today's manifest from kube-setup (image and settings). This is the one
rollout after the restore; the restored pod already used the snapshot in step 3.

```bash
kubectl apply -f manifests/games/games-cloud-deployment.yaml     # in kube-setup, after git pull
kubectl -n games rollout status deploy/games-cloud --timeout=180s
curl -s https://games.skylar.technology/health
```

**5. Check in the console:** tables, access codes and logs as of the backup. Tables approved after the backup show a
pairing code again (or are approved by their access code, if that code existed then). Once all is well, delete the
old *Released* PV from step 1: `kubectl delete pv $OLDPV` removes only the object; the directory noted in step 1 stays
on the node until removed with `sudo` there (Klaus).

## One record rather than everything

The console can't bring back a single deleted table, code or log. To get one back, restore the backup into a scratch
namespace, copy out what you need, and clean up so no volume is left behind:

```bash
R=games-scratch-$(date -u +%Y%m%d%H%M)
kubectl create -f - <<EOF
apiVersion: velero.io/v1
kind: Restore
metadata: { name: $R, namespace: velero }
spec:
  backupName: <backup>
  includedNamespaces: [games]
  namespaceMapping: { games: games-scratch }
  includedResources: [deployments.apps, replicasets.apps, pods, persistentvolumeclaims, persistentvolumes]
EOF
# when it is Completed: stop the restored app (it can't start there anyway: no Secret, no Ingress) and open the volume
kubectl -n games-scratch scale deploy/games-cloud --replicas=0
kubectl -n games-scratch run look --restart=Never --image="$IMG" --overrides='{"spec":{"securityContext":{"runAsUser":1000,"runAsGroup":1000,"fsGroup":1000,"runAsNonRoot":true,"seccompProfile":{"type":"RuntimeDefault"}},
  "containers":[{"name":"look","image":"'"$IMG"'","command":["sleep","3600"],"securityContext":{"allowPrivilegeEscalation":false,"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]}},
    "volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"games-cloud-data"}}]}}'
kubectl -n games-scratch wait --for=condition=Ready pod/look --timeout=120s
kubectl -n games-scratch exec look -- ls -l /data/logs
kubectl -n games-scratch cp look:/data/logs/<id>.zip ./<id>.zip      # needs tar in the image; else: exec look -- cat /data/logs/<id>.zip > <id>.zip
# clean up: the restored PV is Retain, so make it Delete first, or a Released PV and its directory stay behind
SPV=$(kubectl -n games-scratch get pvc games-cloud-data -o jsonpath='{.spec.volumeName}')
kubectl patch pv $SPV -p '{"spec":{"persistentVolumeReclaimPolicy":"Delete"}}'
kubectl delete ns games-scratch
```

`$IMG` is the games-cloud image, as in step 1 of case B. A table or access code is quicker to create again than to dig out of a database.
