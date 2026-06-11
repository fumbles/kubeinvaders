#!/usr/bin/env bash
#
# build.sh - build, check, and ship the KubeInvaders operator.
#
# Usage:
#   ./build.sh build                  Build current version (from Makefile VERSION)
#   ./build.sh build 0.2.0            Build a specific version
#   ./build.sh build --new-version    Bump patch version (0.1.0 -> 0.1.1), then build
#   ./build.sh build --ship           Build multi-arch (linux/amd64+arm64) and push
#                                     operator + bundle images to Docker Hub
#   ./build.sh check                  Run quality gates only (no image build)
#   ./build.sh clean                  Remove build artifacts
#
# Flags can be combined: ./build.sh build --new-version --ship
#   --skip-checks                     Skip quality gates (not recommended)
#
set -euo pipefail
cd "$(dirname "$0")"

# ---------- helpers ----------------------------------------------------------

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
step()   { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die()    { red "ERROR: $*" >&2; exit 1; }

current_version() {
  awk '/^VERSION \?=/ {print $3; exit}' Makefile
}

bump_patch() {
  local v=$1 major minor patch
  IFS=. read -r major minor patch <<<"$v"
  echo "${major}.${minor}.$((patch + 1))"
}

# Rewrite the version everywhere it is pinned so all artifacts stay consistent.
set_version() {
  local old=$1 new=$2
  step "Setting version: ${old} -> ${new}"

  sed -i.bak -E "s/^VERSION \?= .*/VERSION ?= ${new}/" Makefile

  sed -i.bak -E "s/newTag: .*/newTag: v${new}/" config/manager/kustomization.yaml

  sed -i.bak -E \
    "s|(containerImage: .*kubeinvaders-operator):v[0-9]+\.[0-9]+\.[0-9]+|\1:v${new}|" \
    config/manifests/bases/kubeinvaders-operator.clusterserviceversion.yaml

  if [[ -f config/catalog/catalogsource.yaml ]]; then
    sed -i.bak -E \
      "s|(image: .*kubeinvaders-operator-catalog):v[0-9]+\.[0-9]+\.[0-9]+|\1:v${new}|" \
      config/catalog/catalogsource.yaml
  fi

  # Maintain the OLM upgrade graph: the new CSV replaces the previous one.
  local csv=config/manifests/bases/kubeinvaders-operator.clusterserviceversion.yaml
  if grep -qE '^  replaces:' "$csv"; then
    sed -i.bak -E "s/^  replaces: .*/  replaces: kubeinvaders-operator.v${old}/" "$csv"
  else
    awk -v old="$old" '/^  version:/ {print "  replaces: kubeinvaders-operator.v" old} {print}' "$csv" > "$csv.tmp" \
      && mv "$csv.tmp" "$csv"
  fi
  yellow "NOTE: spec.replaces now points at v${old}. If v${old} was never published"
  yellow "      to a catalog, remove 'replaces:' from ${csv}."

  find . -name '*.bak' -not -path './bin/*' -delete
}

# ---------- quality gates ----------------------------------------------------

run_checks() {
  local failed=0

  step "Tooling"
  for tool in go operator-sdk; do
    command -v "$tool" >/dev/null || die "$tool is required but not installed"
    printf '  %-14s %s\n' "$tool" "$(command -v "$tool")"
  done
  printf '  %-14s %s\n' "containers" "$CONTAINER_TOOL ($(command -v "$CONTAINER_TOOL"))"

  step "gofmt (formatting)"
  local unformatted
  unformatted=$(gofmt -l . 2>/dev/null | grep -v '^bin/' || true)
  if [[ -n "$unformatted" ]]; then
    red "Unformatted files:"; echo "$unformatted"
    yellow "Run: gofmt -w ."
    failed=1
  else
    green "OK"
  fi

  step "go mod tidy (dependency hygiene)"
  if go mod tidy -diff >/dev/null 2>&1; then
    green "OK"
  else
    yellow "go.mod/go.sum not tidy - running go mod tidy"
    go mod tidy
  fi

  step "go vet (static analysis)"
  go vet ./... && green "OK" || failed=1

  step "go build"
  go build ./... && green "OK" || failed=1

  step "go test"
  go test ./... && green "OK" || failed=1

  step "Generated code freshness (make manifests generate)"
  make -s manifests generate
  if ! git diff --quiet -- api/ config/crd/ config/rbac/ 2>/dev/null; then
    yellow "controller-gen output was stale and has been regenerated - review and commit:"
    git diff --stat -- api/ config/crd/ config/rbac/ | sed 's/^/  /'
  else
    green "OK"
  fi

  step "OLM bundle (make bundle + operator-sdk bundle validate)"
  make -s bundle && green "OK" || failed=1

  # Optional linters - used when installed, skipped otherwise.
  if command -v golangci-lint >/dev/null; then
    step "golangci-lint"
    golangci-lint run ./... && green "OK" || failed=1
  fi
  if command -v kube-linter >/dev/null; then
    step "kube-linter (config/manager)"
    kube-linter lint config/manager/manager.yaml && green "OK" || yellow "kube-linter warnings (non-fatal)"
  fi
  if command -v yamllint >/dev/null; then
    step "yamllint"
    yamllint -d '{extends: relaxed, rules: {line-length: disable}}' config/ bundle/ && green "OK" || yellow "yamllint warnings (non-fatal)"
  fi

  [[ $failed -eq 0 ]] || die "quality gates failed - fix the issues above (or use --skip-checks at your own risk)"
  green "All quality gates passed"
}

# ---------- commands ----------------------------------------------------------

cmd_build() {
  local ship=$1 new_version=$2 skip_checks=$3 version_override=$4

  local version
  version=$(current_version)
  [[ -n "$version" ]] || die "could not read VERSION from Makefile"

  if [[ "$new_version" == true && -n "$version_override" ]]; then
    die "use either --new-version or an explicit version, not both"
  fi

  if [[ "$new_version" == true ]]; then
    local bumped
    bumped=$(bump_patch "$version")
    set_version "$version" "$bumped"
    version=$bumped
  elif [[ -n "$version_override" ]]; then
    [[ "$version_override" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version must be X.Y.Z (got: $version_override)"
    if [[ "$version_override" != "$version" ]]; then
      set_version "$version" "$version_override"
      version=$version_override
    fi
  fi

  local img="docker.io/fumbles/kubeinvaders-operator:v${version}"
  local bundle_img="docker.io/fumbles/kubeinvaders-operator-bundle:v${version}"

  step "Building kubeinvaders-operator v${version}"
  echo "  operator image: ${img}"
  echo "  bundle image:   ${bundle_img}"
  echo "  ship to Docker Hub: ${ship}"

  if [[ "$skip_checks" == true ]]; then
    yellow "Skipping quality gates (--skip-checks)"
    make -s bundle VERSION="$version"   # bundle must still match the version being built
  else
    run_checks
  fi

  if [[ "$ship" == true ]]; then
    if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
      yellow "WARNING: shipping with uncommitted changes in the working tree"
    fi
    local catalog_img="docker.io/fumbles/kubeinvaders-operator-catalog:v${version}"
    step "Building + pushing multi-arch operator image (linux/amd64, linux/arm64)"
    make docker-buildx VERSION="$version" IMG="$img"
    step "Building + pushing multi-arch bundle image"
    make bundle-buildx VERSION="$version" BUNDLE_IMG="$bundle_img"
    step "Building + pushing multi-arch catalog image (file-based catalog)"
    make catalog-buildx VERSION="$version" BUNDLE_IMG="$bundle_img" CATALOG_IMG="$catalog_img"
    step "Shipped"
    green "  ${img}"
    green "  ${bundle_img}"
    green "  ${catalog_img}"
    echo
    echo "Make it installable on a cluster with OLM:"
    echo "  kubectl apply -f config/catalog/catalogsource.yaml"
    echo "  kubectl apply -f config/catalog/subscription.yaml"
    echo "Or test just the bundle without a catalog:"
    echo "  operator-sdk run bundle ${bundle_img}"
  else
    step "Building local single-arch operator image (use --ship for multi-arch + push)"
    make docker-build VERSION="$version" IMG="$img"
    green "Built ${img} (local only)"
  fi

  if [[ "$new_version" == true ]]; then
    echo
    yellow "Version files changed (Makefile, kustomization, CSV base, bundle/)."
    yellow "Commit and tag: git add -A && git commit -m 'operator v${version}' && git tag operator-v${version}"
  fi
}

cmd_clean() {
  step "Cleaning"
  rm -rf bin cover.out
  find . -name '*.bak' -delete
  green "Done"
}

usage() {
  sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
}

# ---------- main --------------------------------------------------------------

# Container tool: docker or podman (override with CONTAINER_TOOL=...)
if [[ -z "${CONTAINER_TOOL:-}" ]]; then
  if command -v docker >/dev/null 2>&1; then CONTAINER_TOOL=docker
  elif command -v podman >/dev/null 2>&1; then CONTAINER_TOOL=podman
  else die "docker or podman is required but neither is installed"
  fi
fi
export CONTAINER_TOOL

COMMAND=""
SHIP=false
NEW_VERSION=false
SKIP_CHECKS=false
VERSION_OVERRIDE=""

for arg in "$@"; do
  case "$arg" in
    build|check|clean|help) COMMAND=$arg ;;
    --ship)                 SHIP=true ;;
    --new-version)          NEW_VERSION=true ;;
    --skip-checks)          SKIP_CHECKS=true ;;
    -h|--help)              COMMAND=help ;;
    [0-9]*.[0-9]*.[0-9]*)   VERSION_OVERRIDE=$arg ;;
    *)                      die "unknown argument: $arg (see ./build.sh help)" ;;
  esac
done

case "${COMMAND:-build}" in
  build) cmd_build "$SHIP" "$NEW_VERSION" "$SKIP_CHECKS" "$VERSION_OVERRIDE" ;;
  check) run_checks ;;
  clean) cmd_clean ;;
  help)  usage ;;
esac
