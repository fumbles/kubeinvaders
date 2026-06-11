# KubeInvaders Operator Documentation

Documentation for the KubeInvaders operator in `operator/` — a Go operator (Operator SDK, go/v4) that manages KubeInvaders chaos engineering game instances via a `KubeInvaders` custom resource, distributed through OLM.

| Doc | Contents |
|---|---|
| [Architecture](01-architecture.md) | How the operator works: CRD, controller, reconciled resources, RBAC model |
| [Using the Operator](02-using-the-operator.md) | Installing, the `KubeInvaders` CR reference, examples, playing the game |
| [Building](03-building.md) | build.sh, Makefile targets, quality gates, local development |
| [Shipping & Releases](04-shipping-and-releases.md) | Versioning, multi-arch images, release workflow |
| [OLM & Catalog](05-olm-and-catalog.md) | Bundle, file-based catalog, CatalogSource, OperatorHub publishing |
| [Troubleshooting](06-troubleshooting.md) | Every failure mode encountered so far, with diagnosis and fix |

## Quick reference

Images (Docker Hub):

- Operator: `docker.io/fumbles/kubeinvaders-operator:v<VERSION>` (linux/amd64 + linux/arm64)
- Bundle: `docker.io/fumbles/kubeinvaders-operator-bundle:v<VERSION>`
- Catalog: `docker.io/fumbles/kubeinvaders-operator-catalog:v<VERSION>`

Game image (upstream, not built here): `docker.io/luckysideburn/kubeinvaders:latest`

Common commands (from `operator/`):

```bash
./build.sh check                        # quality gates only
./build.sh build                        # gates + local native-arch image
./build.sh build --new-version --ship   # bump patch, build, push everything
oc apply -f config/catalog/catalogsource.yaml   # make installable on a cluster
```

API: `game.kubeinvaders.io/v1alpha1`, kind `KubeInvaders`, namespaced.
