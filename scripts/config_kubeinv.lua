local config = {}
-- Default chaos container: visible on dashboards but polite. Throttled CPU,
-- modest memory, and no I/O workers (sync-heavy stress on a node disk can
-- starve etcd and other latency-sensitive disk consumers). See
-- chaos-tests.md for stronger presets and their trade-offs.
config['default_chaos_container'] = [[
{
    "name": "kubeinvaders-chaos-node",
    "image": "docker.io/luckysideburn/kubeinvaders-stress-ng:latest",
    "command": [
        "stress-ng",
        "--cpu",
        "2",
        "--cpu-load",
        "80",
        "--vm",
        "1",
        "--vm-bytes",
        "512M",
        "--timeout",
        "30s",
        "--metrics-brief"
    ]
}
]]

return config