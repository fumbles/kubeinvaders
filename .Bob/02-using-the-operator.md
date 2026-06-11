# Using the Operator

## Installing

**From the catalog (OpenShift / any OLM cluster)** — after the CatalogSource is applied (see [OLM & Catalog](05-olm-and-catalog.md)), install from the Software Catalog UI (search "kubeinvaders"), or:

```bash
oc apply -f operator/config/catalog/subscription.yaml
```

**Quick test without a catalog:**

```bash
operator-sdk run bundle docker.io/fumbles/kubeinvaders-operator-bundle:v0.1.0
operator-sdk cleanup kubeinvaders-operator      # to remove
```

**Without OLM (plain kustomize):**

```bash
cd operator && make deploy IMG=docker.io/fumbles/kubeinvaders-operator:v0.1.0
```

## Creating an instance

Zero-setup demo (OpenShift) — the operator creates the target namespace, demo aliens to shoot, and a Route; this is also the default the console "Create instance" form offers:

```yaml
apiVersion: game.kubeinvaders.io/v1alpha1
kind: KubeInvaders
metadata:
  name: kubeinvaders
  namespace: kubeinvaders
spec:
  targetNamespaces: [kubeinvaders-demo]
  demo:
    enabled: true
  route:
    enabled: true
```

Then `oc get route kubeinvaders -n kubeinvaders` (or the CR's Route link in the console) and play.

Minimal — chaos against existing namespaces, no demo resources:

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
```

Full example:

```yaml
apiVersion: game.kubeinvaders.io/v1alpha1
kind: KubeInvaders
metadata:
  name: kubeinvaders
  namespace: kubeinvaders
spec:
  targetNamespaces: [dev-sandbox]
  image: docker.io/luckysideburn/kubeinvaders:latest
  replicas: 1
  serviceType: ClusterIP
  ingress:
    enabled: true
    host: kubeinvaders.apps.example.com
    ingressClassName: nginx
    tlsSecretName: kubeinvaders-tls       # omit for plain HTTP
    annotations:
      cert-manager.io/cluster-issuer: letsencrypt
  resources:
    requests: {cpu: 100m, memory: 256Mi}
    limits: {cpu: "1", memory: 512Mi}
  extraEnv:
    - name: ALIENPROXIMITY
      value: "10"
    - name: HITSLIMIT
      value: "1"
    - name: UPDATETIME
      value: "0.5"
```

## Spec reference

| Field | Type | Default | Notes |
|---|---|---|---|
| `targetNamespaces` | []string | — | **Required**, min 1. Namespaces whose pods become aliens |
| `demo.enabled` | bool | false | Operator creates target namespaces (if missing) + an "aliens" demo deployment in each — no manual setup. Namespaces it created are removed again on CR deletion |
| `demo.replicas` | int32 | 8 | Pods per demo deployment |
| `demo.image` | string | `nginxinc/nginx-unprivileged:stable` | Demo workload image |
| `route.enabled` | bool | false | OpenShift: creates a Route for the UI; the assigned host is exported as `APPLICATION_URL`. On non-OpenShift clusters a `RouteAvailable: False` condition is set instead |
| `route.host` | string | auto-generated | Route hostname |
| `route.tls` | bool | false | Edge TLS termination with HTTP→HTTPS redirect |
| `image` | string | `docker.io/luckysideburn/kubeinvaders:latest` | Game image |
| `replicas` | int32 | 1 | Game pods |
| `serviceType` | enum | `ClusterIP` | `ClusterIP` \| `NodePort` \| `LoadBalancer` |
| `applicationURL` | string | ingress host or service DNS | Exported as `APPLICATION_URL` |
| `ingress.enabled` | bool | false | Creates/deletes the Ingress |
| `ingress.host` | string | — | Ingress hostname |
| `ingress.ingressClassName` | string | — | IngressClass |
| `ingress.annotations` | map | — | Extra Ingress annotations |
| `ingress.tlsSecretName` | string | — | Enables TLS when set |
| `resources` | ResourceRequirements | — | Game container resources |
| `extraEnv` | []EnvVar | — | Chaos tuning and anything else |

## Status

```bash
kubectl get kubeinvaders -n kubeinvaders
NAME           READY   AGE
kubeinvaders   1       2m
```

`status.conditions` carries an `Available` condition; `status.readyReplicas` mirrors the game Deployment.

## Accessing the game

With Ingress enabled, open the host. Otherwise:

```bash
kubectl port-forward -n kubeinvaders svc/kubeinvaders 8080:8080
open http://localhost:8080
```

Pods in the target namespaces appear as aliens; shooting one deletes the pod and Kubernetes recreates it (if a controller owns it) — that's the lesson.

## Deleting

`kubectl delete kubeinvaders <name>` removes everything: owned namespaced resources via garbage collection, ClusterRole/Binding via the finalizer.

## On OpenShift

The OperatorHub form view renders proper widgets for replicas (pod count) and resources thanks to CSV descriptors. The game's ServiceAccount needs no special SCC; the operator manager runs `runAsNonRoot` with the restricted profile.
