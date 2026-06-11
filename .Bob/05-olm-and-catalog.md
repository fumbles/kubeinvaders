# OLM & Catalog

## The three artifacts

| Artifact | Contains | Consumed by |
|---|---|---|
| **Bundle image** | One version's CSV + CRD + metadata (no code) | `opm render`, `operator-sdk run bundle` |
| **Catalog image** (file-based catalog) | Package + channels + bundle references, served over gRPC by opm | CatalogSource |
| **CatalogSource** | Pointer to the catalog image | OLM — makes the package appear in the Software Catalog |

Pipeline: `config/` → `make bundle` → `bundle/` → bundle image → `make catalog` (opm render) → `catalog/operator.yaml` → catalog image → CatalogSource → PackageManifest → installable.

## Making it installable on a cluster

```bash
# one-time per cluster (file already targets openshift-marketplace;
# for vanilla OLM change namespace to olm)
oc apply -f operator/config/catalog/catalogsource.yaml

# verify
oc get catalogsource kubeinvaders-catalog -n openshift-marketplace \
  -o jsonpath='{.status.connectionState.lastObservedState}{"\n"}'   # → READY
oc get packagemanifests | grep kubeinvaders

# install (UI: Software Catalog → search "kubeinvaders", or:)
oc apply -f operator/config/catalog/subscription.yaml
```

The CatalogSource polls the image every 10 minutes (`updateStrategy.registryPoll`), so a re-pushed catalog with the same tag is picked up without reapplying anything.

## File-based catalog details

`make catalog` regenerates `catalog/operator.yaml` from scratch:

1. `opm init kubeinvaders-operator --default-channel=alpha` — the `olm.package` blob
2. `opm render <bundle-image>` — the `olm.bundle` blob (pulled from Docker Hub, hence bundle must be pushed first)
3. An `olm.channel` blob for channel `alpha` with the current version as the entry, including `replaces` when present in the CSV
4. `opm validate catalog`

`catalog.Dockerfile` serves it: multi-arch `quay.io/operator-framework/opm` base, `opm serve /configs --cache-dir=/tmp/cache --cache-enforce-integrity=false`. The integrity flag is deliberate — see [Troubleshooting](06-troubleshooting.md) for why the cache is not pre-baked.

## Channels

Single `alpha` channel for now (`CHANNELS`/`DEFAULT_CHANNEL` in the Makefile). When the API stabilizes, add `beta`/`stable` channels and ship to multiple via `make bundle CHANNELS=alpha,stable DEFAULT_CHANNEL=stable`.

## Publishing to public OperatorHub

The self-hosted CatalogSource is fully under your control. To appear in the public catalogs:

**OperatorHub.io (vanilla Kubernetes):**
1. Fork [k8s-operatorhub/community-operators](https://github.com/k8s-operatorhub/community-operators)
2. Copy `operator/bundle/` → `operators/kubeinvaders-operator/<version>/` (manifests/, metadata/, tests/)
3. Add `ci.yaml` next to the version dirs; open a PR. CI runs `operator-sdk bundle validate` (the same check `make bundle` runs) plus scorecard.

**OpenShift embedded OperatorHub ("Community Operators" source):** same bundle, PR to [redhat-openshift-ecosystem/community-operators-prod](https://github.com/redhat-openshift-ecosystem/community-operators-prod).

Once merged there, clusters get it from the default `community-operators` CatalogSource and your own CatalogSource becomes unnecessary on those clusters.

## Scorecard

```bash
cd operator && operator-sdk scorecard bundle
```

Runs the basic + OLM test suites (bundle validation, CRDs have validation, spec/status descriptors) in-cluster against the current kubeconfig. The descriptor tests pass because the CSV markers in `api/v1alpha1/kubeinvaders_types.go` populate spec/status descriptors.
