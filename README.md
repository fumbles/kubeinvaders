# kubeinvaders (the original) :space_invader: aka k-inv :joystick:

**Gamified Chaos Engineering and Educational Tool for Kubernetes**

<img src="./doc_images/1750875811732.jpg" alt="KubeInvaders game screenshot" style="width:50%;">

This project is [recommended by the CNCF](https://github.com/cncf/sandbox/issues/124) and has significant educational value. It is a chaos engineering tool, but it is also used for studying Kubernetes and resilience topics.

It is part of the Cloud Native Computing Foundation's (CNCF) landscape in the [Observability and Analysis - Chaos Engineering](https://landscape.cncf.io/) section.

Some companies use it for marketing at tech conferences in DevOps & SRE. For example at [Decompiled 2025](https://www.linkedin.com/posts/cloud-%26-heat-technologies-gmbh_kubeinvaders-onpremise-managedkubernetes-activity-7293538807906258946-YtKV?utm_source=share&utm_medium=member_desktop&rcm=ACoAAAkOMNYBK7j_raLIIJBfs2RBA94_sK4Yeyg).


# Table of Contents

1. [Description](#description)
2. [How the Game Works](#how-the-game-works)
3. [What you will learn](#what-you-will-learn)
4. [Installation — Operator (recommended)](#installation--operator-recommended)
5. [Installation — Podman / Docker](#installation--podman--docker)
6. [Example using Podman + MiniKube](#example-using-podman--minikube)
7. [URL Monitoring During Chaos Session](#url-monitoring-during-chaos-session)
8. [Troubleshooting Unknown Namespace](#troubleshooting-unknown-namespace)
9. [Prometheus Metrics](#prometheus-metrics)
10. [Community blogs and videos](#community-blogs-and-videos)
11. [License](#license)

## Description

Inspired by the classic Space Invaders arcade game, KubeInvaders offers a playful and engaging way to learn about Kubernetes resilience by stressing a cluster and observing its behavior under pressure. This open-source project, built without relying on any external frameworks, provides a fun and educational experience for developers to explore the limits and strengths of their Kubernetes deployments.

Every visual element maps to a real Kubernetes concept — so as you play, you're literally performing chaos engineering and watching the cluster respond in real time.

## How the Game Works

KubeInvaders translates live Kubernetes resources into game objects:

**Aliens → Pods.** Each alien on screen is a real running pod in your target namespace. When you shoot one, the pod is deleted via the Kubernetes API and the alien disappears. The Kubernetes Deployment controller notices the desired replica count is now higher than the actual count and schedules a replacement — but in the game, pods don't respawn during a wave. The deployment is scaled down by one on each kill, so K8s doesn't replace it until the next wave begins.

**Cluster Events → Enemy fire.** Aliens shoot back! The enemy bombs raining down on you represent disruptive cluster events being propagated through the system. As levels increase, more aliens fire simultaneously and the rate increases.

**PodDisruptionBudgets → Shields.** Four bunker-style shields protect your ship. Each shield absorbs four hits before it's destroyed — and you'll see progressive visual damage as the health degrades. When a shield is fully destroyed, the PDB is gone and two replacement pods immediately join the invasion as reinforcements, because without the budget in place, more disruption is allowed.

**Waves → Deployment scaling.** Each wave is a full deployment of pods at the configured replica count. Clearing a wave advances to the next level, the fleet grows, and you earn a bonus life.

**Ship → Your role.** You are the SRE performing the chaos experiment.

## What you will learn

By running chaos experiments with KubeInvaders you can observe the following Kubernetes behaviors directly:

- **Pod lifecycle** — how pods are terminated and recreated by their controllers
- **Self-healing** — how Deployments and ReplicaSets maintain the desired replica count after pod deletion
- **PodDisruptionBudgets** — how PDBs bound disruption, and what happens to a workload when they are removed
- **Scheduling** — where Kubernetes places new pods after disruption and why
- **Node pressure** — how the cluster reacts when a worker node is attacked or becomes unavailable
- **Namespace isolation** — how workloads in different namespaces are affected independently
- **Recovery time** — how long the cluster takes to return to a steady state under different configurations

## Installation — Operator (recommended)

The KubeInvaders operator is the easiest way to run the game against a real cluster. It handles RBAC, the game deployment, optional demo workloads, and OpenShift Route or Ingress setup automatically.

### Prerequisites

- OLM (Operator Lifecycle Manager) installed on your cluster. OpenShift includes OLM out of the box. For vanilla Kubernetes, install it with:

```bash
curl -sL https://github.com/operator-framework/operator-lifecycle-manager/releases/latest/download/install.sh | bash -s latest
```

### Step 1 — Add the CatalogSource

#### OpenShift

```bash
cat << 'EOF' | oc apply -f -
apiVersion: operators.coreos.com/v1alpha1
kind: CatalogSource
metadata:
  name: kubeinvaders-catalog
  namespace: openshift-marketplace
spec:
  sourceType: grpc
  image: docker.io/fumbles/kubeinvaders-operator-catalog:v0.1.9
  displayName: KubeInvaders Catalog
  publisher: KubeInvaders Community
  updateStrategy:
    registryPoll:
      interval: 10m
EOF
```

#### Vanilla Kubernetes (OLM)

```bash
cat << 'EOF' | kubectl apply -f -
apiVersion: operators.coreos.com/v1alpha1
kind: CatalogSource
metadata:
  name: kubeinvaders-catalog
  namespace: olm
spec:
  sourceType: grpc
  image: docker.io/fumbles/kubeinvaders-operator-catalog:v0.1.9
  displayName: KubeInvaders Catalog
  publisher: KubeInvaders Community
  updateStrategy:
    registryPoll:
      interval: 10m
EOF
```

### Step 2 — Subscribe to the operator

#### OpenShift

```bash
cat << 'EOF' | oc apply -f -
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: kubeinvaders-operator
  namespace: openshift-operators
spec:
  channel: alpha
  name: kubeinvaders-operator
  source: kubeinvaders-catalog
  sourceNamespace: openshift-marketplace
  installPlanApproval: Automatic
EOF
```

#### Vanilla Kubernetes (OLM)

```bash
cat << 'EOF' | kubectl apply -f -
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: kubeinvaders-operator
  namespace: operators
spec:
  channel: alpha
  name: kubeinvaders-operator
  source: kubeinvaders-catalog
  sourceNamespace: olm
  installPlanApproval: Automatic
EOF
```

Wait for the operator pod to become ready:

```bash
# OpenShift
oc get pods -n openshift-operators -w

# Kubernetes
kubectl get pods -n operators -w
```

### Step 3 — Create a KubeInvaders instance

Create the target namespace and apply the custom resource:

```bash
# OpenShift
oc new-project kubeinvaders

# Kubernetes
kubectl create namespace kubeinvaders
```

```bash
cat << 'EOF' | kubectl apply -f -
apiVersion: game.kubeinvaders.io/v1alpha1
kind: KubeInvaders
metadata:
  name: kubeinvaders-sample
  namespace: kubeinvaders
spec:
  targetNamespaces:
    - kubeinvaders-demo
  demo:
    enabled: true
    replicas: 8
  # OpenShift: expose via a Route with TLS edge termination
  route:
    enabled: true
    tls: true
  # Non-OpenShift: expose via an Ingress instead
  ingress:
    enabled: false
    # host: kubeinvaders.example.com
    # ingressClassName: nginx
EOF
```

Once the pods are running, get the URL:

```bash
# OpenShift
oc get route -n kubeinvaders

# Kubernetes (if using Ingress)
kubectl get ingress -n kubeinvaders
```

### Optional: preserve extra labels or annotations

If you use label-driven tooling (dashboards, service meshes, cost allocation), add your labels to the CR spec so the operator merges them instead of overwriting them on each reconcile:

```yaml
spec:
  additionalLabels:
    dashboard.example.com/enabled: "true"
  additionalAnnotations:
    prometheus.io/scrape: "true"
```

## Installation — Podman / Docker

The easiest way to try KubeInvaders without a cluster is directly with Podman or Docker.

Run with Podman:

```bash
podman run -p 8080:8080 docker.io/luckysideburn/kubeinvaders:latest
```

Run with Docker:

```bash
docker run --rm -p 8080:8080 docker.io/luckysideburn/kubeinvaders:latest
```

Then open:

```
http://localhost:8080
```

If you want to run KubeInvaders against your own Kubernetes cluster without the operator, create the required RBAC components (assumes k8s v1.24+):

```bash
cat << 'EOF' | kubectl apply -f -
apiVersion: v1
kind: Namespace
metadata:
  name: kubeinvaders
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: kinv-cr
rules:
  - apiGroups:
      - ""
    resources:
      - pods
      - pods/log
    verbs:
      - delete
  - apiGroups:
      - batch
      - extensions
    resources:
      - jobs
    verbs:
      - get
      - list
      - watch
      - create
      - update
      - patch
      - delete
  - apiGroups:
      - "*"
    resources:
      - "*"
    verbs:
      - get
      - watch
      - list
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: kinv-sa
  namespace: kubeinvaders
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: kinv-crb
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: kinv-cr
subjects:
  - kind: ServiceAccount
    name: kinv-sa
    namespace: kubeinvaders
---
apiVersion: v1
kind: Secret
type: kubernetes.io/service-account-token
metadata:
  name: kinv-sa-token
  namespace: kubeinvaders
  annotations:
    kubernetes.io/service-account.name: kinv-sa
EOF
```

Extract the token:

```bash
TOKEN=$(kubectl get secret -n kubeinvaders -o go-template='{{.data.token | base64decode}}' kinv-sa-token)
```

**Important:** Use a valid Kubernetes token. If the token is missing, invalid, or expired, KubeInvaders cannot call the Kubernetes API and game actions will fail.

If you use short-lived tokens, generate a new one when needed:

```bash
kubectl create token kinv-sa -n kubeinvaders --duration=8h
```

Create target namespaces with pods to shoot at:

```bash
kubectl create namespace namespace1
kubectl create namespace namespace2
```

## Example using Podman + MiniKube

Install MiniKube:

```bash
minikube start
```

Get the MiniKube API server address:

```bash
kubectl cluster-info
# Kubernetes control plane is running at https://192.168.64.2:8443
```

Get the MiniKube CA certificate (needed when configuring KubeInvaders):

```bash
cat ~/.minikube/ca.crt
```

Create the namespace, service account, and token:

```bash
kubectl create ns kubeinvaders

kubectl create sa kubeinvaders-sa -n kubeinvaders

kubectl create clusterrolebinding kubeinvaders-cluster-admin \
  --clusterrole=cluster-admin \
  --serviceaccount=kubeinvaders:kubeinvaders-sa

kubectl create token kubeinvaders-sa -n kubeinvaders --duration=24h
# outputs: <your-token>
```

Run KubeInvaders:

```bash
podman run -p 8080:8080 --network=host kubeinvaders:latest
```

If you are on macOS, you may encounter issues due to Podman Machine networking.


## URL Monitoring During Chaos Session

During a chaos engineering session, you can monitor the behavior of an HTTP call exposed by an Ingress.

Use the flag "Add HTTP check & Chaos Report" and add the URL to monitor.

![URL monitor flag](./doc_images/url_monitor.png)

Follow real-time charts during the experiment.

![HTTP stats chart](./doc_images/http_stats.png)


## Troubleshooting Unknown Namespace

- Check if the namespaces configured in the UI (for example: `namespace1`, `namespace2`) exist and contain pods.
- Check your browser's developer console for any failed HTTP requests (send them to luckysideburn[at]gmail[dot]com or open an issue on this repo).
- Try using `latest_debug` and send logs to luckysideburn[at]gmail[dot]com or open an issue on this repo.

## Prometheus Metrics

KubeInvaders exposes metrics for Prometheus through the standard endpoint `/metrics`.

Here is an example of Prometheus configuration:

```yaml
scrape_configs:
- job_name: kubeinvaders
  static_configs:
  - targets:
    - kubeinvaders.kubeinvaders.svc.cluster.local:8080
```

Example of metrics:

| Metric                                                     | Description                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| chaos_jobs_node_count{node=workernode01}                   | Total number of chaos jobs executed per node                 |
| chaos_node_jobs_total                                      | Total number of chaos jobs executed against all worker nodes |
| deleted_pods_total                                         | Total number of deleted pods                                 |
| deleted_namespace_pods_count{namespace=myawesomenamespace} | Total number of deleted pods per namespace                   |

[Download Grafana dashboard](./confs/grafana/KubeInvadersDashboard.json)

![Grafana dashboard overview](./doc_images/grafana1.png)

![Grafana metrics detail](./doc_images/grafana2.png)

## Community blogs and videos

![Community blog screenshot](./doc_images/1741171163503.jpg)

- [The Kubernetes ecosystem is a candy store](https://opensource.googleblog.com/2024/06/the-kubernetes-ecosystem-is-candy-store.html)
- [AdaCon Norway Live Stream](https://www.youtube.com/watch?v=rt_eM_KRfK4)
- [LILiS - Linux Day 2023 Benevento](https://www.youtube.com/watch?v=1tHkEfbGjgE)
- Kubernetes.io blog: [KubeInvaders - Gamified Chaos Engineering Tool for Kubernetes](https://kubernetes.io/blog/2020/01/22/kubeinvaders-gamified-chaos-engineering-tool-for-kubernetes/)
- acloudguru: [cncf-state-of-the-union](https://acloudguru.com/videos/kubernetes-this-month/cncf-state-of-the-union)
- DevNation RedHat Developer: [Twitter](https://twitter.com/sebi2706/status/1316681264179613707)
- Flant: [Open Source solutions for chaos engineering in Kubernetes](https://blog.flant.com/chaos-engineering-in-kubernetes-open-source-tools/)
- Reeinvent: [KubeInvaders - gamified chaos engineering](https://www.reeinvent.com/blog/kubeinvaders)
- Adrian Goins: [K8s Chaos Engineering with KubeInvaders](https://www.youtube.com/watch?v=bxT-eJCkqP8)
- dbafromthecold: [Chaos engineering for SQL Server running on AKS using KubeInvaders](https://dbafromthecold.com/2019/07/03/chaos-engineering-for-sql-server-running-on-aks-using-kubeinvaders/)
- Pklinker: [Gamification of Kubernetes Chaos Testing](https://pklinker.medium.com/gamification-of-kubernetes-chaos-testing-bd2f7a7b6037)
- Openshift Commons Briefings: [OpenShift Commons Briefing KubeInvaders: Chaos Engineering Tool for Kubernetes](https://www.youtube.com/watch?v=3OOXOCTAYF0&t=4s)
- GitHub: [awesome-kubernetes repo](https://github.com/ramitsurana/awesome-kubernetes)
- William Lam: [Interesting Kubernetes application demos](https://williamlam.com/2020/06/interesting-kubernetes-application-demos.html)
- The Chief I/O: [5 Fun Ways to Use Kubernetes ](https://thechief.io/c/editorial/5-fun-ways-use-kubernetes/?utm_source=twitter&utm_medium=social&utm_campaign=thechiefio&utm_content=articlesfromthechiefio)
- LuCkySideburn: [Talk @ Codemotion](https://www.slideshare.net/EugenioMarzo/kubeinvaders-chaos-engineering-tool-for-kubernetes-and-openshift)
- Chaos Carnival: [Chaos Engineering is fun!](https://www.youtube.com/watch?v=10tHPl67A9I&t=3s)
- Kubeinvaders (old version) + OpenShift 4 Demo: [YouTube_Video](https://www.youtube.com/watch?v=kXm2uU5vlp4)
- KubeInvaders (old version) Vs Openshift 4.1: [YouTube_Video](https://www.youtube.com/watch?v=7R9ftgB-JYU)
- Chaos Engineering for SQL Server | Andrew Pruski | Conf42: Chaos Engineering: [YouTube_Video](https://www.youtube.com/watch?v=HCy3sjMRvlI)
- nicholaschangblog: [Introducing Azure Chaos Studio](https://nicholaschangblog.com/azure/introduction-to-azure-choas-studio/)
- bugbug: [Chaos Testing: Everything You Need To Know](https://bugbug.io/blog/software-testing/chaos-testing-guide/)
- Kinetikon: [Chaos Engineering: 5 strumenti open source](https://www.kinetikon.com/chaos-engineering-strumenti-open-source/)

## License

KubeInvaders is licensed under the Apache 2.0. See [LICENSE](./LICENSE) for the full license text.
