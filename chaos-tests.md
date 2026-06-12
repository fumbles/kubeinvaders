# Chaos Tests

Presets for the KubeInvaders **Chaos Container Editor**. When you shoot a node
in the game, KubeInvaders launches a Kubernetes Job running this container on
the target node. Each preset below is a complete JSON config you can paste
into the editor, with a description of what it actually exercises and what to
watch out for.

All presets use [stress-ng](https://github.com/ColinIanKing/stress-ng). Useful
flags to know: `--cpu 0` spawns one worker per core, `--cpu-load N` throttles
CPU workers to N%, and `--vm-bytes` accepts percentages of total node memory
(e.g. `40%`).

## A note on what stress tests actually test

CPU stress from an unconstrained pod mostly demonstrates that the kernel's
fair scheduling works — neighbors slow down a little, nothing breaks. The
*interesting* chaos experiments are the ones that engage Kubernetes' own
protection mechanisms: kubelet eviction under memory or disk pressure, OOM
behavior, priority and preemption, and the question of whether *your*
workloads have the resource requests and priorities to survive. Pick presets
based on the question you're asking, not the biggest numbers.

## ⚠️ Handle with care: disks and memory

Two categories deserve extra respect on any cluster:

- **Disk I/O (`--io`, `--hdd`)**: these hammer the node's storage with sync
  and write workers. If latency-sensitive components share that disk — etcd
  on control-plane nodes is the classic example, but databases and journaled
  services too — fsync starvation can cause leader elections, API slowdowns,
  and cascading timeouts. Only point I/O stress at nodes whose disk you can
  afford to saturate, and never at a control-plane node you care about.
- **Memory (`--vm-bytes` with large values or percentages)**: pushing a node
  past its memory eviction thresholds gets pods evicted and can wake the
  kernel OOM killer. That is sometimes exactly the experiment you want — but
  evicted pods are chosen by QoS class and usage, and may include things you
  didn't intend (including KubeInvaders itself). Know your nodes' free memory
  before choosing a percentage.

Also remember the chaos Job pod has no resource limits by default, so nothing
caps it except the flags you give stress-ng.

## Presets

### 1. Polite demo (the default)

Visible on dashboards, kind to neighbors. Throttled CPU, modest memory, no
disk I/O. Good for talks, demos, and playing the game without consequences.

```json
{
    "name": "kubeinvaders-chaos-node",
    "image": "docker.io/luckysideburn/kubeinvaders-stress-ng:latest",
    "command": [
        "stress-ng",
        "--cpu", "2", "--cpu-load", "80",
        "--vm", "1", "--vm-bytes", "512M",
        "--timeout", "30s",
        "--metrics-brief"
    ]
}
```

**Tests:** that your monitoring notices node stress; CPU fair-sharing.
**Risk:** negligible.

### 2. CPU saturation

One worker per core at full load, long enough for alerts and autoscaler
decisions to react. Demonstrates that CFS shares protect other workloads —
and reveals workloads with no CPU requests set (they degrade the most).

```json
{
    "name": "kubeinvaders-chaos-node",
    "image": "docker.io/luckysideburn/kubeinvaders-stress-ng:latest",
    "command": [
        "stress-ng",
        "--cpu", "0",
        "--timeout", "120s",
        "--metrics-brief"
    ]
}
```

**Tests:** CPU contention behavior, alerting latency, autoscaler reactions,
which workloads lack CPU requests.
**Risk:** low — latency-sensitive workloads on the node get slower, but
nothing is evicted or killed.

### 3. Memory pressure (eviction drill)

Allocates a meaningful share of node memory for long enough to engage kubelet
eviction logic. This is the preset that asks the real resilience question:
*when memory runs short, do the right pods survive?*

```json
{
    "name": "kubeinvaders-chaos-node",
    "image": "docker.io/luckysideburn/kubeinvaders-stress-ng:latest",
    "command": [
        "stress-ng",
        "--vm", "2", "--vm-bytes", "40%",
        "--timeout", "90s",
        "--metrics-brief"
    ]
}
```

**Tests:** kubelet eviction ordering (BestEffort → Burstable → Guaranteed),
OOM behavior, whether critical workloads have requests and priorities that
protect them.
**Risk:** moderate — pods *will* be evicted if the node was already near its
memory limits. Start at `40%`, observe, raise gradually. Don't run this on a
node hosting singletons you can't afford to restart.

### 4. Sustained mixed load (soak)

A longer, moderate, mixed workload — closer to "a noisy neighbor moved in"
than "a bomb went off." Useful for watching dashboards, pressure-stall (PSI)
metrics, and alert thresholds over several minutes.

```json
{
    "name": "kubeinvaders-chaos-node",
    "image": "docker.io/luckysideburn/kubeinvaders-stress-ng:latest",
    "command": [
        "stress-ng",
        "--cpu", "2", "--cpu-load", "60",
        "--vm", "1", "--vm-bytes", "25%",
        "--timeout", "300s",
        "--metrics-brief"
    ]
}
```

**Tests:** sustained-pressure alerting, PSI metrics, whether "slow but not
broken" states get noticed by humans and automation.
**Risk:** low-moderate; mostly a patience test for your observability stack.

### 5. Disk I/O contention — ⚠️ read the warning above first

Sync and write workers competing for the node's storage. Only for nodes whose
disk is isolated from latency-critical components, and ideally with a short
timeout the first time.

```json
{
    "name": "kubeinvaders-chaos-node",
    "image": "docker.io/luckysideburn/kubeinvaders-stress-ng:latest",
    "command": [
        "stress-ng",
        "--io", "2", "--hdd", "1", "--hdd-bytes", "256M",
        "--timeout", "30s",
        "--metrics-brief"
    ]
}
```

**Tests:** behavior of disk-dependent workloads under I/O starvation, fsync
latency tolerance, storage alerting.
**Risk:** high on shared disks — etcd, databases, and logging agents on the
same device can time out. `--hdd` also writes real data: make sure the target
filesystem has headroom, because filling it can trigger node disk-pressure
eviction for *everyone* on the node.

## Escalation etiquette

Run the polite preset first and confirm your observability sees it. Escalate
one variable at a time (more CPU, *or* more memory, *or* longer — not all
three). Always know two things before you fire: what you expect to happen,
and how you'll know if it didn't. The difference between chaos engineering
and just breaking things is the hypothesis.
