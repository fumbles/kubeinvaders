# Troubleshooting

Every issue below was actually hit during development of v0.1.0. Symptoms are verbatim.

## Build issues

### Go toolchain crashes during `make docker-buildx`

```
RUN go mod download ... runtime stack dump ... rax 0x2 ...
process "/dev/.buildkit_qemu_emulator /bin/sh -c go mod download" did not complete successfully
```

**Cause:** the amd64 build stage running under QEMU emulation on Apple Silicon; the Go toolchain segfaults under qemu.
**Fix (in place):** `Dockerfile` uses `FROM --platform=$BUILDPLATFORM golang:1.24` so compilation runs natively and cross-compiles via `TARGETOS`/`TARGETARCH`. Don't remove that flag.

### `docker push` fails: "image not known" right after a successful build

```
WARNING: No output specified with docker-container driver...
Error response from daemon: failed to find image ...: image not known
```

**Cause:** when the default buildx builder uses the docker-container driver, plain `docker build` leaves the result in the build cache, not the daemon.
**Fix (in place):** local targets (`docker-build`, `bundle-build`) pass `--load`; ship targets (`*-buildx`) pass `--push`. Use the buildx targets when shipping.

### `make bundle`: duplicate CRD

```
ERRO Error: Value game.kubeinvaders.io/v1alpha1, Kind=KubeInvaders: duplicate CRD ... in bundle
```

**Cause:** a stale CRD file in `bundle/manifests/` under a different filename than operator-sdk generates (`game.kubeinvaders.io_kubeinvaders.yaml` is the canonical name). `--overwrite` only overwrites files it would generate.
**Fix:** delete the stale file in `bundle/manifests/`, re-run `make bundle`.

### `opm render`: "no policy.json file found" (macOS)

```
failed to pull image ...: no policy.json file found at any of the following:
"/Users/<you>/.config/containers/policy.json", "/etc/containers/policy.json"
```

**Cause:** opm pulls images via containers/image, which requires a signature-verification policy file Linux distros ship and macOS doesn't.
**Fix (in place):** the `catalog` Makefile target writes `~/.config/containers/policy.json` with `{"default":[{"type":"insecureAcceptAnything"}]}` when missing.

### Quality gate "generated files were stale"

Not an error — `make manifests generate` found the Go markers and committed YAML out of sync and regenerated. Review the diff and commit it.

### Game pod under OpenShift restricted SCC: Redis never starts

```
redis.exceptions.ConnectionError: Error 2 connecting to unix socket: /tmp/redis.sock.
```

**Cause (three layers, all from the game image assuming root):** the Debian redis package ships `/etc/redis` as `750 redis:redis`, so a random UID can't even read the config; `redis.conf` pointed pidfile/dir at `/var/run/redis` and `/var/lib/redis` (unwritable); and a `logfile stdou` typo plus `daemonize yes` made the failure silent.
**Fix (commits `079eb79` + `944286c` in the fork, upstreamable):** Dockerfile `chmod 755 /etc/redis`; redis pidfile/dir → `/tmp`; `logfile ""`; nginx pid + temp paths → `/tmp`. Verify with:

```bash
oc exec <pod> -- redis-cli -s /tmp/redis.sock ping   # → PONG
```

**Debugging tip:** `daemonize yes` + `logfile ""` sends Redis startup errors to /dev/null. Run it in the foreground to see the real error: `oc exec <pod> -- redis-server /etc/redis/redis.conf --daemonize no`.

## Cluster issues

### Catalog pod CrashLoopBackOff: "integrity check failed"

```
level=fatal msg="integrity check failed: read existing cache digest:
open /tmp/cache/pogreb.v1/digest: no such file or directory"
```

**Cause:** `opm serve --cache-dir` enforces an integrity check that only passes when the cache was pre-built into the image. Pre-building (operator-sdk's default `RUN opm serve --cache-only` step) would run opm under QEMU during multi-arch builds — the same class of crash as the Go toolchain issue.
**Fix (in place):** `catalog.Dockerfile` passes `--cache-enforce-integrity=false`; the cache builds at pod startup instead.

### CatalogSource exists but nothing in the Software Catalog

Diagnose in this order:

```bash
oc get catalogsource kubeinvaders-catalog -n openshift-marketplace \
  -o jsonpath='{.status.connectionState.lastObservedState}{"\n"}'    # want READY
oc get pods -n openshift-marketplace -l olm.catalogSource=kubeinvaders-catalog
oc logs -n openshift-marketplace -l olm.catalogSource=kubeinvaders-catalog --tail=30
oc get packagemanifests | grep -i kubeinvaders
```

- `TRANSIENT_FAILURE` + CrashLoopBackOff → read the pod logs (see integrity issue above)
- `ImagePullBackOff` → Docker Hub rate limiting or typo'd tag; add a docker.io pull secret or mirror the catalog to quay.io
- READY but UI empty → search by name ("kubeinvaders") rather than browsing; filter by source "KubeInvaders Catalog"; the UI can lag ~1 min behind packagemanifests

After re-pushing a fixed catalog with the same tag, force an immediate re-pull:

```bash
oc delete pod -n openshift-marketplace -l olm.catalogSource=kubeinvaders-catalog
```

### Operator installs but the game pod doesn't start

```bash
kubectl describe kubeinvaders <name> -n <ns>        # check conditions
kubectl get deploy,po -n <ns> -l app.kubernetes.io/name=kubeinvaders
kubectl logs -n <ns> deploy/<name>
kubectl logs -n <operator-ns> deploy/kubeinvaders-operator-controller-manager
```

Common causes: target namespaces don't exist (the game still runs; the UI shows an unknown-namespace warning), image pull failures on `luckysideburn/kubeinvaders`, or cluster RBAC blocking the operator from creating ClusterRoles (the operator needs the permissions it grants — verify its ClusterRole was installed by OLM).

### Game UI loads but shows no aliens

`NAMESPACE` env comes from `spec.targetNamespaces` — verify the namespaces exist and contain pods. Exec into the game pod and check: `kubectl exec deploy/<name> -- env | grep NAMESPACE`.

### Deleting the CR hangs

The finalizer removes the ClusterRole/Binding first. If the operator is down, the finalizer never clears — restart the operator, or as a last resort: `kubectl patch kubeinvaders <name> -p '{"metadata":{"finalizers":[]}}' --type=merge` (then clean up `kubeinvaders-<ns>-<name>` ClusterRole/Binding manually).

## Useful inspection commands

```bash
operator-sdk bundle validate operator/bundle          # offline bundle check
operator/bin/opm validate operator/catalog            # offline catalog check
docker buildx imagetools inspect docker.io/fumbles/kubeinvaders-operator:v0.1.0   # confirm arches
oc get subscription,csv,installplan -n <install-ns>   # OLM install state
```
