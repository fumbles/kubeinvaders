# kubeinvaders (the original) :space_invader: aka k-inv :joystick:

**Gamified Chaos Engineering and Educational Tool for Kubernetes**

<img src="./doc_images/1750875811732.jpg" alt="KubeInvaders game screenshot" style="width:50%;">

This project is [recommended by the CNCF](https://github.com/cncf/sandbox/issues/124) and has significant educational value. It is a chaos engineering tool, but it is also used for studying Kubernetes and resilience topics.

It is part of the Cloud Native Computing Foundation's (CNCF) landscape in the [Observability and Analysis - Chaos Engineering](https://landscape.cncf.io/) section.

Some companies use it for marketing at tech conferences in DevOps & SRE. For example at [Decompiled 2025](https://www.linkedin.com/posts/cloud-%26-heat-technologies-gmbh_kubeinvaders-onpremise-managedkubernetes-activity-7293538807906258946-YtKV?utm_source=share&utm_medium=member_desktop&rcm=ACoAAAkOMNYBK7j_raLIIJBfs2RBA94_sK4Yeyg).


# Table of Contents

1. [Description](#Description)
2. [What you will learn](#What-you-will-learn)
3. [Installation](#Installation)
4. [Example using Podman + MiniKube](#Example-using-Podman--MiniKube)
5. [URL Monitoring During Chaos Session](#URL-Monitoring-During-Chaos-Session)
6. [Troubleshooting Unknown Namespace](#Troubleshooting-Unknown-Namespace)
7. [Prometheus Metrics](#Prometheus-Metrics)
8. [Community blogs and videos](#Community-blogs-and-videos)
9. [License](#License)

## Description

Inspired by the classic Space Invaders game, KubeInvaders offers a playful and engaging way to learn about Kubernetes resilience by stressing a cluster and observing its behavior under pressure. This open-source project, built without relying on any external frameworks, provides a fun and educational experience for developers to explore the limits and strengths of their Kubernetes deployments.

## What you will learn

By running chaos experiments with KubeInvaders you can observe the following Kubernetes behaviors directly:

- **Pod lifecycle** — how pods are terminated and recreated by their controllers
- **Self-healing** — how Deployments and ReplicaSets maintain the desired replica count after pod deletion
- **Scheduling** — where Kubernetes places new pods after disruption and why
- **Node pressure** — how the cluster reacts when a worker node is attacked or becomes unavailable
- **Namespace isolation** — how workloads in different namespaces are affected independently
- **Recovery time** — how long the cluster takes to return to a steady state under different configurations

## Installation

**Helm installation is currently not supported.**

The easiest way to run KubeInvaders is directly with Podman or Docker.

Run with Podman:

```bash
podman run -p 8080:8080 docker.io/luckysideburn/kubeinvaders:latest
```

Run with Docker:

```bash
docker run --rm -p 8080:8080 docker.io/luckysideburn/kubeinvaders:latest
```

Then open:

```bash
http://localhost:8080
```

If you want to run KubeInvaders against your own Kubernetes cluster, create the required RBAC components (assumes k8s v1.24+):

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
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  namespace: default
  name: kubevirt-vm-restart-role
rules:
- apiGroups: ["subresources.kubevirt.io"]
  resources: ["virtualmachines/restart"]
  verbs: ["update"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: kubevirt-vm-restart-binding
  namespace: default
subjects:
- kind: ServiceAccount
  name: kubeinvaders
  namespace: kubeinvaders
roleRef:
  kind: ClusterRole
  name: kubevirt-vm-restart-role
  apiGroup: rbac.authorization.k8s.io
EOF
```

Extract the token:

```bash
TOKEN=$(kubectl get secret -n kubeinvaders -o go-template='{{.data.token | base64decode}}' kinv-sa-token)
```

**Important:** Use a valid Kubernetes token. If the token is missing, invalid, or expired, KubeInvaders cannot call the Kubernetes API and game actions will fail.

The example above shows how to extract the token from `kinv-sa-token`. If you use short-lived tokens, generate a new one when needed:

```bash
kubectl create token kinv-sa -n kubeinvaders --duration=8h
```

Create two namespaces:

```bash
kubectl create namespace namespace1
kubectl create namespace namespace2
```

## Example using Podman + MiniKube

Install MiniKube:

```bash
minikube start
😄  minikube v1.38.1 on Darwin 26.2 (arm64)
✨  Automatically selected the vfkit driver. Other choices: qemu2, virtualbox, vmware, ssh, podman (experimental)
❗  Starting v1.39.0, minikube will default to "containerd" container runtime. See #21973 for more info.
💿  Downloading VM boot image ...
    > minikube-v1.38.0-arm64.iso....:  65 B / 65 B [---------] 100.00% ? p/s 0s
    > minikube-v1.38.0-arm64.iso:  402.91 MiB / 402.91 MiB  100.00% 13.39 MiB p
👍  Starting "minikube" primary control-plane node in "minikube" cluster
💾  Downloading Kubernetes v1.35.1 preload ...
    > preloaded-images-k8s-v18-v1...:  243.95 MiB / 243.95 MiB  100.00% 14.15 M
🔥  Creating vfkit VM (CPUs=2, Memory=4600MB, Disk=20000MB) ...
🐳  Preparing Kubernetes v1.35.1 on Docker 28.5.2 ...
🔗  Configuring bridge CNI (Container Networking Interface) ...
🔎  Verifying Kubernetes components...
    ▪ Using image gcr.io/k8s-minikube/storage-provisioner:v5
🌟  Enabled addons: storage-provisioner, default-storageclass
❗  /usr/local/bin/kubectl is version 1.30.1, which may have incompatibilities with Kubernetes 1.35.1.
    ▪ Want kubectl v1.35.1? Try 'minikube kubectl -- get pods -A'
```

Get the MiniKube API server address using one of these commands:

```bash
cat ~/.kube/config | grep server | grep $(minikube ip)
    server: https://192.168.64.2:8443
```

```bash
kubectl cluster-info

Kubernetes control plane is running at https://192.168.64.2:8443
CoreDNS is running at https://192.168.64.2:8443/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy
```

Get the MiniKube CA certificate (you will need its content when configuring KubeInvaders):

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

KubeInvaders is licensed under the GNU General Public License v3.0. See [LICENSE](./LICENSE) for the full license text.
