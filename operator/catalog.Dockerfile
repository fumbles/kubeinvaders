# File-based catalog image, served by opm.
# The opm base image is multi-arch, so this builds for any platform
# (the catalog content itself is plain YAML, arch-independent).
FROM quay.io/operator-framework/opm:latest
ENTRYPOINT ["/bin/opm"]
# --cache-enforce-integrity=false: the cache is built at container startup
# rather than baked into the image. Pre-building it (the operator-sdk default,
# via a RUN step) would execute opm under QEMU emulation for the non-native
# platform during multi-arch builds, which is unreliable.
CMD ["serve", "/configs", "--cache-dir=/tmp/cache", "--cache-enforce-integrity=false"]
ADD catalog /configs
LABEL operators.operatorframework.io.index.configs.v1=/configs
