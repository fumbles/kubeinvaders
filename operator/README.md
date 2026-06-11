# KubeInvaders Operator

A Kubernetes operator (built with the [Operator SDK](https://sdk.operatorframework.io/), Go/v4 plugin) that manages [KubeInvaders](https://github.com/lucky-sideburn/kubeinvaders) instances via a `KubeInvaders` custom resource, and ships as an [OLM](https://olm.operatorframework.io/) bundle.

For each `KubeInvaders` resource the operator reconciles:

- a **Deployment** running the game (`docker.io/luckysideburn/kubeinvaders` by default)
- a **Service** (and optional **Ingress**) exposing the web UI on port 8080
- a **ServiceAccount** + **ClusterRole/ClusterRoleBinding** granting the game the RBAC it needs to delete pods and observe the cluster in the target namespaces (cleaned up via finalizer on CR deletion)

## Example

```yaml
apiVersion: game.kubeinvaders.io/v1alpha1
kind: KubeInvaders
metadata:
  name: kubeinvaders
  namespace: kubeinvaders
spec:
  targetNamespaces:
    - namespace1
    - namespace2
  ingress:
    enabled: true
    host: kubeinvaders.example.com
    ingressClassName: nginx
  extraEnv:
    - name: ALIENPROXIMITY
      value: "10"
```

See `config/samples/` and the field docs in `api/v1alpha1/kubeinvaders_types.go`.

## Prerequisites

- Go >= 1.24
- operator-sdk >= v1.42
- docker (with buildx for multi-arch)
- kubectl pointed at a test cluster

## Build script

`build.sh` wraps the Makefile with version management and quality gates:

```bash
./build.sh build                  # quality gates + local image of current version
./build.sh build 0.2.0            # build a specific version
./build.sh build --new-version    # bump patch (0.1.0 -> 0.1.1) everywhere, then build
./build.sh build --ship           # multi-arch build + push operator and bundle to Docker Hub
./build.sh build --new-version --ship   # typical release
./build.sh check                  # quality gates only
```

Quality gates: gofmt, `go mod tidy -diff`, `go vet`, `go build`, `go test`, generated-code freshness (controller-gen), and `make bundle` (which runs `operator-sdk bundle validate`). golangci-lint, kube-linter, and yamllint run too if installed. `--new-version` keeps the Makefile, kustomization image tag, CSV `containerImage`, and the OLM `replaces` upgrade chain in sync.

## First build

```bash
cd operator
go mod tidy        # generates go.sum on first run
make build         # runs manifests, generate, fmt, vet, then compiles
```

`make manifests generate` regenerates the CRD and deepcopy code with controller-gen after any change to `api/v1alpha1/`.

## Run against a cluster

```bash
make install run                       # CRD + controller on your host
kubectl apply -k config/samples/       # create a KubeInvaders instance
```

## Build and push images (linux/amd64 + linux/arm64)

```bash
make docker-buildx IMG=docker.io/fumbles/kubeinvaders-operator:v0.1.0
```

Deploy without OLM:

```bash
make deploy IMG=docker.io/fumbles/kubeinvaders-operator:v0.1.0
```

## OLM bundle

```bash
make bundle              # regenerate bundle/ from config/ and validate it
make bundle-buildx       # multi-arch build + push docker.io/fumbles/kubeinvaders-operator-bundle:v0.1.0
```

Test the bundle on a cluster with OLM installed:

```bash
operator-sdk olm install                  # if OLM is not installed yet
operator-sdk run bundle docker.io/fumbles/kubeinvaders-operator-bundle:v0.1.0
operator-sdk scorecard bundle             # optional: run scorecard tests
operator-sdk cleanup kubeinvaders-operator
```

Note: `run bundle` uses a single-arch bundle image fine, but the *operator* image must match the cluster's architecture — hence `docker-buildx` above.

## Installing via a CatalogSource (your own catalog)

To make the operator show up as installable software in any cluster with OLM — without waiting for OperatorHub — build a catalog image from the pushed bundle and apply the CatalogSource:

```bash
make catalog-buildx                    # multi-arch file-based catalog image:
                                       # docker.io/fumbles/kubeinvaders-operator-catalog:v<VERSION>
                                       # (./build.sh build --ship does this automatically;
                                       #  requires the bundle image to be pushed first)
kubectl apply -f config/catalog/catalogsource.yaml
kubectl get packagemanifests | grep kubeinvaders   # appears once the catalog pod is ready
kubectl apply -f config/catalog/subscription.yaml  # actually install the operator
```

Both files contain comments for the OpenShift namespace equivalents (`openshift-marketplace` / `openshift-operators`). The CatalogSource polls the image every 10 minutes, so pushing an updated catalog with the same tag is picked up automatically; `./build.sh build --new-version` keeps the catalog image tag in `catalogsource.yaml` in sync.

## Publishing to OperatorHub.io

1. Push both images (operator + bundle) with release tags.
2. Fork [k8s-operatorhub/community-operators](https://github.com/k8s-operatorhub/community-operators).
3. Copy `bundle/` to `operators/kubeinvaders-operator/0.1.0/` in the fork (manifests/, metadata/, tests/).
4. Add a `ci.yaml` next to the version directory and open a PR; CI runs the same `operator-sdk bundle validate` checks as `make bundle`.

For OpenShift's embedded OperatorHub, the same bundle goes to [redhat-openshift-ecosystem/community-operators-prod](https://github.com/redhat-openshift-ecosystem/community-operators-prod).

## Versioning

Bump `VERSION` in the Makefile (or pass `VERSION=x.y.z`), rebuild, re-run `make bundle`, and set `spec.replaces: kubeinvaders-operator.v<previous>` in the new CSV so OLM can upgrade between versions.
