# Building

## Prerequisites

Go ≥ 1.24, operator-sdk ≥ v1.42, docker with buildx, kubectl/oc. controller-gen, kustomize, and opm are auto-installed into `operator/bin/` by the Makefile when needed.

## build.sh (preferred entrypoint)

```bash
cd operator
./build.sh build                  # quality gates + local native-arch image (current VERSION)
./build.sh build 0.2.0            # build an explicit version
./build.sh build --new-version    # bump patch (0.1.0 → 0.1.1) everywhere, then build
./build.sh build --ship           # gates + multi-arch push of operator/bundle/catalog
./build.sh check                  # quality gates only, no image build
./build.sh clean                  # remove bin/, cover.out, *.bak
./build.sh build --skip-checks    # escape hatch, not recommended
```

Flags combine: `./build.sh build --new-version --ship` is the standard release.

## Quality gates (`./build.sh check`)

Run in order; the build aborts on failure:

1. **Tooling** — go, docker, operator-sdk present
2. **gofmt** — no unformatted files
3. **go mod tidy -diff** — dependency hygiene (auto-tidies if dirty)
4. **go vet** — static analysis
5. **go build** / **go test**
6. **Generated-code freshness** — runs `make manifests generate`; warns (and regenerates) if controller-gen output was stale relative to the Go types
7. **make bundle** — regenerates the OLM bundle and runs `operator-sdk bundle validate`
8. Optional, when installed: **golangci-lint** (fatal), **kube-linter** and **yamllint** (warnings)

## Key Makefile targets

| Target | Purpose |
|---|---|
| `make manifests generate` | Regenerate CRD/RBAC and deepcopy code from Go markers |
| `make build` / `make run` | Compile / run the controller locally against current kubeconfig |
| `make install` | Apply just the CRD to the cluster |
| `make docker-build` | Local native-arch operator image (uses `--load`) |
| `make docker-buildx` | Multi-arch operator image, **pushes** (`PLATFORMS=linux/arm64,linux/amd64`) |
| `make bundle` | Regenerate `bundle/` from `config/` + validate |
| `make bundle-buildx` | Multi-arch bundle image, pushes |
| `make catalog` | Render file-based catalog from the **pushed** bundle image |
| `make catalog-buildx` | `catalog` + multi-arch catalog image, pushes |
| `make deploy` / `make undeploy` | Kustomize deploy without OLM |

Overridable variables: `VERSION`, `IMG`, `BUNDLE_IMG`, `CATALOG_IMG`, `PLATFORMS`, `CONTAINER_TOOL`.

## Multi-arch: how it works

`Dockerfile` uses `FROM --platform=$BUILDPLATFORM golang:1.24` — the compile stage always runs **natively** on the build host and cross-compiles with `GOOS=$TARGETOS GOARCH=$TARGETARCH` (CGO disabled, static binary, distroless runtime). Never remove that `--platform` flag: without it the amd64 stage runs under QEMU on Apple Silicon and the Go toolchain crashes (see [Troubleshooting](06-troubleshooting.md)).

The bundle and catalog images are arch-independent content (YAML); the catalog's multi-arch property comes from the multi-arch `quay.io/operator-framework/opm` base image.

## Local development loop

```bash
make install          # CRD onto a test cluster
make run              # controller on your laptop, watches the cluster
kubectl apply -k config/samples/
```

After changing `api/v1alpha1/`: `make manifests generate`, review the diff, commit. Generated files (`zz_generated.deepcopy.go`, `config/crd/bases/`, `bundle/`) are committed; `catalog/` is gitignored and always regenerated.
