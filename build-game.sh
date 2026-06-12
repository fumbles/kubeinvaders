docker buildx build --push --platform linux/amd64,linux/arm64 \
  -t docker.io/fumbles/kubeinvaders:latest .
oc delete pod -n kubeinvaders -l app.kubernetes.io/name=kubeinvaders
