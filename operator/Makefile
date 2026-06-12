# VERSION defines the project version for the bundle.
VERSION ?= 0.1.6

# CHANNELS define the bundle channels used in the bundle.
CHANNELS ?= alpha
ifneq ($(origin CHANNELS), undefined)
BUNDLE_CHANNELS := --channels=$(CHANNELS)
endif

# DEFAULT_CHANNEL defines the default channel used in the bundle.
DEFAULT_CHANNEL ?= alpha
ifneq ($(origin DEFAULT_CHANNEL), undefined)
BUNDLE_DEFAULT_CHANNEL := --default-channel=$(DEFAULT_CHANNEL)
endif
BUNDLE_METADATA_OPTS ?= $(BUNDLE_CHANNELS) $(BUNDLE_DEFAULT_CHANNEL)

# Image URL bases
IMAGE_TAG_BASE ?= docker.io/fumbles/kubeinvaders-operator

# Operator image
IMG ?= $(IMAGE_TAG_BASE):v$(VERSION)

# Bundle image
BUNDLE_IMG ?= docker.io/fumbles/kubeinvaders-operator-bundle:v$(VERSION)

# Catalog image (for testing the bundle in a custom catalog)
CATALOG_IMG ?= $(IMAGE_TAG_BASE)-catalog:v$(VERSION)

# BUNDLE_GEN_FLAGS are the flags passed to the operator-sdk generate bundle command
BUNDLE_GEN_FLAGS ?= -q --overwrite --version $(VERSION) $(BUNDLE_METADATA_OPTS)

# ENVTEST_K8S_VERSION refers to the version of kubebuilder assets to be downloaded by envtest binary.
ENVTEST_K8S_VERSION = 1.33.0

# Get the currently used golang install path (in GOPATH/bin, unless GOBIN is set)
ifeq (,$(shell go env GOBIN))
GOBIN=$(shell go env GOPATH)/bin
else
GOBIN=$(shell go env GOBIN)
endif

# CONTAINER_TOOL defines the container tool to be used for building images.
# Auto-detects docker, falls back to podman. Multi-arch targets branch on this:
# docker uses buildx, podman uses manifest lists.
CONTAINER_TOOL ?= $(shell command -v docker >/dev/null 2>&1 && echo docker || echo podman)
IS_PODMAN := $(findstring podman,$(notdir $(CONTAINER_TOOL)))
# podman loads images locally by default and has no --load flag
LOAD_FLAG := $(if $(IS_PODMAN),,--load)

# Setting SHELL to bash allows bash commands to be executed by recipes.
SHELL = /usr/bin/env bash -o pipefail
.SHELLFLAGS = -ec

.PHONY: all
all: build

##@ General

.PHONY: help
help: ## Display this help.
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z_0-9-]+:.*?##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

##@ Development

.PHONY: manifests
manifests: controller-gen ## Generate WebhookConfiguration, ClusterRole and CustomResourceDefinition objects.
	$(CONTROLLER_GEN) rbac:roleName=manager-role crd webhook paths="./..." output:crd:artifacts:config=config/crd/bases

.PHONY: generate
generate: controller-gen ## Generate code containing DeepCopy, DeepCopyInto, and DeepCopyObject method implementations.
	$(CONTROLLER_GEN) object:headerFile="hack/boilerplate.go.txt" paths="./..."

.PHONY: fmt
fmt: ## Run go fmt against code.
	go fmt ./...

.PHONY: vet
vet: ## Run go vet against code.
	go vet ./...

.PHONY: test
test: manifests generate fmt vet ## Run tests.
	go test ./... -coverprofile cover.out

##@ Build

.PHONY: build
build: manifests generate fmt vet ## Build manager binary.
	go build -o bin/manager cmd/main.go

.PHONY: run
run: manifests generate fmt vet ## Run a controller from your host.
	go run ./cmd/main.go

.PHONY: docker-build
docker-build: ## Build docker image with the manager (local, native arch).
	$(CONTAINER_TOOL) build $(LOAD_FLAG) -t $(IMG) .

.PHONY: docker-push
docker-push: ## Push docker image with the manager.
	$(CONTAINER_TOOL) push $(IMG)

# PLATFORMS defines the target platforms for the manager image to support multi-arch.
PLATFORMS ?= linux/arm64,linux/amd64
.PHONY: docker-buildx
docker-buildx: ## Build and push a multi-arch manager image (docker buildx or podman manifest).
ifeq ($(IS_PODMAN),podman)
	- $(CONTAINER_TOOL) manifest rm $(IMG)
	$(CONTAINER_TOOL) build --platform=$(PLATFORMS) --manifest $(IMG) -f Dockerfile .
	$(CONTAINER_TOOL) manifest push --all $(IMG) docker://$(IMG)
else
	- $(CONTAINER_TOOL) buildx create --name kubeinvaders-operator-builder
	$(CONTAINER_TOOL) buildx use kubeinvaders-operator-builder
	$(CONTAINER_TOOL) buildx build --push --platform=$(PLATFORMS) --tag $(IMG) -f Dockerfile . || \
		{ $(CONTAINER_TOOL) buildx rm kubeinvaders-operator-builder; exit 1; }
	- $(CONTAINER_TOOL) buildx rm kubeinvaders-operator-builder
endif

##@ Deployment

ifndef ignore-not-found
  ignore-not-found = false
endif

.PHONY: install
install: manifests kustomize ## Install CRDs into the K8s cluster specified in ~/.kube/config.
	$(KUSTOMIZE) build config/crd | $(KUBECTL) apply -f -

.PHONY: uninstall
uninstall: manifests kustomize ## Uninstall CRDs from the K8s cluster specified in ~/.kube/config.
	$(KUSTOMIZE) build config/crd | $(KUBECTL) delete --ignore-not-found=$(ignore-not-found) -f -

.PHONY: deploy
deploy: manifests kustomize ## Deploy controller to the K8s cluster specified in ~/.kube/config.
	cd config/manager && $(KUSTOMIZE) edit set image controller=$(IMG)
	$(KUSTOMIZE) build config/default | $(KUBECTL) apply -f -

.PHONY: undeploy
undeploy: kustomize ## Undeploy controller from the K8s cluster specified in ~/.kube/config.
	$(KUSTOMIZE) build config/default | $(KUBECTL) delete --ignore-not-found=$(ignore-not-found) -f -

##@ Dependencies

## Location to install dependencies to
LOCALBIN ?= $(shell pwd)/bin
$(LOCALBIN):
	mkdir -p $(LOCALBIN)

## Tool Binaries
KUBECTL ?= kubectl
KUSTOMIZE ?= $(LOCALBIN)/kustomize
CONTROLLER_GEN ?= $(LOCALBIN)/controller-gen
OPERATOR_SDK ?= $(shell command -v operator-sdk 2>/dev/null || echo $(LOCALBIN)/operator-sdk)

## Tool Versions
KUSTOMIZE_VERSION ?= v5.6.0
CONTROLLER_TOOLS_VERSION ?= v0.18.0
OPERATOR_SDK_VERSION ?= v1.42.2

.PHONY: kustomize
kustomize: $(KUSTOMIZE) ## Download kustomize locally if necessary.
$(KUSTOMIZE): $(LOCALBIN)
	test -s $(LOCALBIN)/kustomize || GOBIN=$(LOCALBIN) go install sigs.k8s.io/kustomize/kustomize/v5@$(KUSTOMIZE_VERSION)

.PHONY: controller-gen
controller-gen: $(CONTROLLER_GEN) ## Download controller-gen locally if necessary.
$(CONTROLLER_GEN): $(LOCALBIN)
	test -s $(LOCALBIN)/controller-gen || GOBIN=$(LOCALBIN) go install sigs.k8s.io/controller-tools/cmd/controller-gen@$(CONTROLLER_TOOLS_VERSION)

.PHONY: operator-sdk
operator-sdk: ## Use system operator-sdk if available, otherwise download locally.
	@if command -v operator-sdk >/dev/null 2>&1; then \
		echo "using system operator-sdk: $$(command -v operator-sdk)"; \
	elif test -s $(LOCALBIN)/operator-sdk; then \
		echo "operator-sdk already present in $(LOCALBIN)"; \
	else \
		mkdir -p $(LOCALBIN) && \
		OS=$$(go env GOOS) && ARCH=$$(go env GOARCH) && \
		curl -sSLo $(LOCALBIN)/operator-sdk https://github.com/operator-framework/operator-sdk/releases/download/$(OPERATOR_SDK_VERSION)/operator-sdk_$${OS}_$${ARCH} && \
		chmod +x $(LOCALBIN)/operator-sdk; \
	fi

##@ OLM Bundle

.PHONY: bundle
bundle: manifests kustomize operator-sdk ## Generate bundle manifests and metadata, then validate generated files.
	$(OPERATOR_SDK) generate kustomize manifests -q
	cd config/manager && $(KUSTOMIZE) edit set image controller=$(IMG)
	$(KUSTOMIZE) build config/manifests | $(OPERATOR_SDK) generate bundle $(BUNDLE_GEN_FLAGS)
	$(OPERATOR_SDK) bundle validate ./bundle

.PHONY: bundle-build
bundle-build: ## Build the bundle image (local, native arch).
	$(CONTAINER_TOOL) build $(LOAD_FLAG) -f bundle.Dockerfile -t $(BUNDLE_IMG) .

.PHONY: bundle-push
bundle-push: ## Push the bundle image.
	$(CONTAINER_TOOL) push $(BUNDLE_IMG)

.PHONY: bundle-buildx
bundle-buildx: ## Build and push a multi-arch bundle image.
ifeq ($(IS_PODMAN),podman)
	- $(CONTAINER_TOOL) manifest rm $(BUNDLE_IMG)
	$(CONTAINER_TOOL) build --platform=$(PLATFORMS) --manifest $(BUNDLE_IMG) -f bundle.Dockerfile .
	$(CONTAINER_TOOL) manifest push --all $(BUNDLE_IMG) docker://$(BUNDLE_IMG)
else
	- $(CONTAINER_TOOL) buildx create --name kubeinvaders-operator-builder
	$(CONTAINER_TOOL) buildx use kubeinvaders-operator-builder
	$(CONTAINER_TOOL) buildx build --push --platform=$(PLATFORMS) --tag $(BUNDLE_IMG) -f bundle.Dockerfile . || \
		{ $(CONTAINER_TOOL) buildx rm kubeinvaders-operator-builder; exit 1; }
	- $(CONTAINER_TOOL) buildx rm kubeinvaders-operator-builder
endif

.PHONY: opm
OPM = $(LOCALBIN)/opm
opm: ## Download opm locally if necessary.
	@if test -s $(LOCALBIN)/opm; then \
		echo "opm already present"; \
	else \
		mkdir -p $(LOCALBIN) && \
		OS=$$(go env GOOS) && ARCH=$$(go env GOARCH) && \
		curl -sSLo $(LOCALBIN)/opm https://github.com/operator-framework/operator-registry/releases/download/v1.55.0/$${OS}-$${ARCH}-opm && \
		chmod +x $(LOCALBIN)/opm; \
	fi

# Generate a file-based catalog (FBC) from the pushed bundle image.
# Requires the bundle image to be pushed first (opm render pulls it).
.PHONY: catalog
catalog: opm ## Generate the file-based catalog under catalog/.
	@if [ ! -f "$$HOME/.config/containers/policy.json" ] && [ ! -f /etc/containers/policy.json ]; then \
		mkdir -p "$$HOME/.config/containers"; \
		echo '{"default":[{"type":"insecureAcceptAnything"}]}' > "$$HOME/.config/containers/policy.json"; \
		echo "Created $$HOME/.config/containers/policy.json (image policy needed by opm render)"; \
	fi
	rm -rf catalog && mkdir -p catalog
	$(OPM) init kubeinvaders-operator --default-channel=$(DEFAULT_CHANNEL) --output yaml > catalog/operator.yaml
	$(OPM) render $(BUNDLE_IMG) --output yaml >> catalog/operator.yaml
	@printf -- "---\nschema: olm.channel\npackage: kubeinvaders-operator\nname: $(DEFAULT_CHANNEL)\nentries:\n- name: kubeinvaders-operator.v$(VERSION)\n" >> catalog/operator.yaml
	@replaces=$$(awk '/^  replaces:/{print $$2}' bundle/manifests/kubeinvaders-operator.clusterserviceversion.yaml); \
	if [ -n "$$replaces" ]; then echo "  replaces: $$replaces" >> catalog/operator.yaml; fi
	$(OPM) validate catalog

.PHONY: catalog-buildx
catalog-buildx: catalog ## Build and push a multi-arch catalog image.
ifeq ($(IS_PODMAN),podman)
	- $(CONTAINER_TOOL) manifest rm $(CATALOG_IMG)
	$(CONTAINER_TOOL) build --platform=$(PLATFORMS) --manifest $(CATALOG_IMG) -f catalog.Dockerfile .
	$(CONTAINER_TOOL) manifest push --all $(CATALOG_IMG) docker://$(CATALOG_IMG)
else
	- $(CONTAINER_TOOL) buildx create --name kubeinvaders-operator-builder
	$(CONTAINER_TOOL) buildx use kubeinvaders-operator-builder
	$(CONTAINER_TOOL) buildx build --push --platform=$(PLATFORMS) --tag $(CATALOG_IMG) -f catalog.Dockerfile . || \
		{ $(CONTAINER_TOOL) buildx rm kubeinvaders-operator-builder; exit 1; }
	- $(CONTAINER_TOOL) buildx rm kubeinvaders-operator-builder
endif
