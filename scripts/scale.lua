-- scale.lua: scale deployments in a namespace (powers the "win" mechanic:
-- clear every alien and the game scales the wave's deployments to 0).
--
-- GET /kube/deployments/scale?namespace=<ns>&replicas=<n>[&name=<deployment>]
--   Without name: scales every deployment in the namespace.
--   Responds with a JSON array: [{"name": ..., "previousReplicas": ..., "scaled": true}]
local https = require "ssl.https"
local ltn12 = require "ltn12"
local json = require 'lunajson'

local k8s_url = ""
local kube_host = os.getenv("KUBERNETES_SERVICE_HOST")
local kube_port = os.getenv("KUBERNETES_SERVICE_PORT_HTTPS")
local endpoint = os.getenv("ENDPOINT")

if kube_host and kube_host ~= "" then
  local port_suffix = ""
  if kube_port and kube_port ~= "" then
    port_suffix = ":" .. kube_port
  end
  k8s_url = "https://" .. kube_host .. port_suffix
else
  k8s_url = endpoint or ""
end

local arg = ngx.req.get_uri_args()
local req_headers = ngx.req.get_headers()
local target = arg["target"] or req_headers["x-k8s-target"] or req_headers["X-K8S-Target"]
if target and target ~= "" then
  if not string.match(target, "^https?://") then
    target = "https://" .. target
  end
  k8s_url = string.gsub(target, "/+$", "")
end

if k8s_url == "" then
  ngx.status = 500
  ngx.say("Missing Kubernetes endpoint configuration. Set KUBERNETES_SERVICE_HOST or ENDPOINT.")
  ngx.exit(ngx.OK)
end

if not string.match(k8s_url, "^https?://") then
  k8s_url = "https://" .. k8s_url
end
k8s_url = string.gsub(k8s_url, "/+$", "")

local header_token = req_headers["x-k8s-token"] or req_headers["X-K8S-Token"]
local token = ""
if header_token and header_token ~= "" then
  token = header_token
else
  token = tostring(os.getenv("TOKEN") or "")
end
if token == "" then
  local f = io.open("/var/run/secrets/kubernetes.io/serviceaccount/token", "r")
  if f then
    token = f:read("*a") or ""
    token = token:gsub("%s+$", "")
    f:close()
  end
end
if token == "" then
  ngx.status = 500
  ngx.say("Missing Kubernetes API token configuration.")
  ngx.exit(ngx.OK)
end

local ca_cert_b64 = req_headers["x-k8s-ca-cert-b64"] or req_headers["X-K8S-CA-CERT-B64"]
local ca_cert = nil
if ca_cert_b64 and ca_cert_b64 ~= "" then
  ca_cert = ngx.decode_base64(ca_cert_b64)
end

local disable_tls_env = string.lower(tostring(os.getenv("DISABLE_TLS") or "false"))
local disable_tls = disable_tls_env == "true" or disable_tls_env == "1" or disable_tls_env == "yes"

local namespace = arg["namespace"]
local replicas = tonumber(arg["replicas"])
local deploy_name = arg["name"]

ngx.header['Access-Control-Allow-Origin'] = '*'
ngx.header['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
ngx.header['Access-Control-Allow-Headers'] = 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range'
ngx.header['Access-Control-Expose-Headers'] = 'Content-Length,Content-Range'

if not namespace or namespace == "" or replicas == nil or replicas < 0 then
  ngx.status = 400
  ngx.say('{"error": "namespace and replicas (>= 0) are required"}')
  return
end

local function apply_ca(request_opts)
  if not disable_tls and ca_cert and ca_cert ~= "" then
    local ca_file_path = "/tmp/kubeinv-custom-ca.crt"
    local ca_file = io.open(ca_file_path, "w")
    if ca_file then
      ca_file:write(ca_cert)
      ca_file:close()
      request_opts.cafile = ca_file_path
    end
  end
  -- In-cluster fallback: use the ServiceAccount CA so TLS verification works
  -- against the cluster API server (its cert is signed by the cluster CA).
  if not disable_tls and not request_opts.cafile then
    local sa_ca = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
    local sa_ca_f = io.open(sa_ca, "r")
    if sa_ca_f then
      sa_ca_f:close()
      request_opts.cafile = sa_ca
    end
  end
  return request_opts
end

local function k8s_request(method, url, body, content_type)
  local resp = {}
  local headers = {
    ["Accept"] = "application/json",
    ["Authorization"] = "Bearer " .. token
  }
  local request_opts = {
    url = url,
    method = method,
    headers = headers,
    verify = disable_tls and "none" or "peer",
    sink = ltn12.sink.table(resp)
  }
  if body then
    headers["Content-Type"] = content_type or "application/json"
    headers["Content-Length"] = tostring(#body)
    request_opts.source = ltn12.source.string(body)
  end
  apply_ca(request_opts)
  local ok, statusCode = https.request(request_opts)
  return ok, tonumber(statusCode), table.concat(resp)
end

local function scale_deployment(name, target_replicas)
  local url = k8s_url .. "/apis/apps/v1/namespaces/" .. namespace .. "/deployments/" .. name
  local body = json.encode({ spec = { replicas = target_replicas } })
  return k8s_request("PATCH", url, body, "application/strategic-merge-patch+json")
end

-- Collect target deployments (a single one, or all in the namespace).
local targets = {}
if deploy_name and deploy_name ~= "" then
  local ok, status, payload = k8s_request("GET",
    k8s_url .. "/apis/apps/v1/namespaces/" .. namespace .. "/deployments/" .. deploy_name)
  if not ok or status ~= 200 then
    ngx.status = status or 502
    ngx.say('{"error": "failed to get deployment"}')
    return
  end
  local decode_ok, deploy = pcall(json.decode, payload)
  if decode_ok and type(deploy) == "table" then
    table.insert(targets, {
      name = deploy_name,
      previousReplicas = (deploy.spec and deploy.spec.replicas) or 0
    })
  end
else
  local ok, status, payload = k8s_request("GET",
    k8s_url .. "/apis/apps/v1/namespaces/" .. namespace .. "/deployments")
  if not ok or status ~= 200 then
    ngx.status = status or 502
    ngx.say('{"error": "failed to list deployments"}')
    return
  end
  local decode_ok, list = pcall(json.decode, payload)
  if decode_ok and type(list) == "table" and type(list.items) == "table" then
    for _, deploy in ipairs(list.items) do
      table.insert(targets, {
        name = deploy.metadata.name,
        previousReplicas = (deploy.spec and deploy.spec.replicas) or 0
      })
    end
  end
end

local results = {}
for _, t in ipairs(targets) do
  local ok, status = scale_deployment(t.name, replicas)
  table.insert(results, {
    name = t.name,
    previousReplicas = t.previousReplicas,
    scaled = (ok and status == 200) and true or false
  })
end

if #results == 0 then
  ngx.print("[]")
else
  ngx.print(json.encode(results))
end
