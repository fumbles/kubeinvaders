/*
 * Copyright 2024 KubeInvaders Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
*/

/* Main Functions for KubeInvaders Game */

function checkHTTP(url, elementId) {
    var oReq = new XMLHttpRequest();
    oReq.onreadystatechange = function () {
        if (this.readyState === XMLHttpRequest.DONE) {
            $("#" + elementId).val(this.status);
        }
    };;
    oReq.open("GET", url);
    oReq.send();
}

function exportSettings() {
    // Crea un oggetto con i dati delle impostazioni
    const settings = {
        sys_cluster_endpoint: document.getElementById('sys_cluster_endpoint').value,
        sys_insecure_endpoint_flag: document.getElementById('sys_insecure_endpoint_flag').value,
        sys_k8s_proxied_api_http_status_code: document.getElementById('sys_k8s_proxied_api_http_status_code').value,
        sys_openresty_env_vars:  document.getElementById('sys_openresty_env_vars').value
    };
  
    // Converti l'oggetto in una stringa JSON
    const jsonSettings = JSON.stringify(settings, null, 2);
  
    // Crea un blob e un URL per il download
    const blob = new Blob([jsonSettings], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
  
    // Crea un link temporaneo per il download
    const a = document.createElement('a');
    a.href = url;
    a.download = 'settings.json';
    document.body.appendChild(a);
    a.click();
  
    // Pulisci
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
  
function setSystemSettings() {
    var sys_element = document.getElementById('sys_cluster_endpoint');
    sys_element.value = k8s_url;

    sys_element = document.getElementById('sys_insecure_endpoint_flag');
    sys_element.value = clu_insecure;

    sys_element = document.getElementById('sys_openresty_env_vars');
    sys_element.value = selected_env_vars;

    (function waitForK8sUrl() {
        if (k8s_url) {
            if (k8s_url !== "" && /^https?:\/\/.+/.test(k8s_url)) {
                checkHTTP(k8s_url, 'sys_k8s_proxied_api_http_status_code');
            }
            return;
        }
        setTimeout(waitForK8sUrl, 100);
    })();
}

function currentChaosContainerJsonTextAreaVal() {
    return editor_chaos_container_definition.getValue();
}

var nginxAlertThrottle = {};

function alertNginxDebugOnce(key, message, throttleMs) {
    var now = Date.now();
    var wait = throttleMs || 5000;
    var last = nginxAlertThrottle[key] || 0;

    if (now - last < wait) {
        return;
    }

    nginxAlertThrottle[key] = now;
    alert(message);
}

function buildNginxDebugMessage(requestLabel, xhr) {
    var body = (xhr.responseText || "").trim();
    if (body.length > 500) {
        body = body.substring(0, 500) + "...";
    }

    return "[NGINX DEBUG] " + requestLabel + "\n"
        + "HTTP status: " + xhr.status + "\n"
        + "Response body:\n" + (body || "<empty>");
}

function parseJsonResponseOrNull(xhr, requestLabel) {
    if (xhr.status < 200 || xhr.status >= 300) {
        alertNginxDebugOnce(
            requestLabel + "-status-" + xhr.status,
            buildNginxDebugMessage(requestLabel, xhr),
            4000
        );
        console.warn("[K-INV] " + requestLabel + " returned status " + xhr.status);
        return null;
    }

    try {
        return JSON.parse(xhr.responseText);
    } catch (error) {
        alertNginxDebugOnce(
            requestLabel + "-non-json",
            buildNginxDebugMessage(requestLabel, xhr),
            4000
        );
        console.error("[K-INV] " + requestLabel + " returned non-JSON response", error);
        return null;
    }
}

function getConfiguredK8sApiEndpoint() {
    var endpoint = localStorage.getItem('k8s_api_endpoint') || '';
    return endpoint.trim();
}

function openKubeApiRequest(oReq, method, path, async) {
    var requestUrl = appendK8sTargetParam(k8s_url + path);
    oReq.open(method, requestUrl, async !== false);
    applyK8sConnectionHeaders(oReq);
}

function setCodeNameToTextInput(elementId) {
    var oReq = new XMLHttpRequest();
    oReq.onreadystatechange = function () {
        if (this.readyState === XMLHttpRequest.DONE && this.status === 200) {
            codename = this.responseText.trim();
            $("#" + elementId).val(codename);
            $("#" + elementId).text(codename);
            if (codename == "") {
                $('#alert_placeholder').replaceWith(alert_div + 'Error getting codename from backend. </div>');
                codename = "error_fix_getcodename_from_backend";
            }
        }
    };;
    oReq.open("GET", k8s_url + "/codename");
    oReq.send();
}

function getMetrics() {
    var oReq = new XMLHttpRequest();
    oReq.onload = function () {
        if (this.status !== 200) {
            console.warn('[METRICS] /metrics returned status ' + this.status);
            return;
        }
        var lines = this.responseText.split('\n');
        for (var i = 0;i < lines.length;i++){
            var metric = lines[i].split(' ');
            if (!metric[0] || metric[0] === '') continue;

            if (metric[0] == "chaos_node_jobs_total") {
                $('#chaos_jobs_total').text(metric[1]);
                chart_chaos_jobs_total = Number(metric[1]);
            }
            else if (metric[0] == "deleted_pods_total") {
                chart_deleted_pods_total = Number(metric[1]);
                $('#deleted_pods_total').text(metric[1]);            
            }
            else if (metric[0] == "fewer_replicas_seconds") {
                chart_fewer_replicas_seconds = Number(metric[1]);
                $('#fewer_replicas_seconds').text(metric[1]);            
            }
            else if (metric[0] == "latest_fewer_replicas_seconds") {
                chart_latest_fewer_replicas_seconds = Number(metric[1]);
                $('#latest_fewer_replicas_seconds').text(metric[1]);            
            }
            else if (metric[0] == "pods_not_running_on_selected_ns") {
                chart_pods_not_running_on = Number(metric[1]);
                $('#pods_not_running_on').text(metric[1]);            
            }
            else if (metric[0] == "pods_match_regex:" + random_code) {
                $('#pods_match_regex').text(metric[1]);            
            }
            else if (metric[0].match(chaos_job_regex)) {
                var metrics_split = metric[0].split(":");
                chaos_jobs_status.set(metrics_split[1] + ":" + metrics_split[2] + ":" +  metrics_split[3], metric[1]);
            }
            else if (metric[0] == "current_chaos_job_pod") {
                chart_current_chaos_job_pod = Number(metric[1]);
                $('#current_chaos_job_pod').text(metric[1]);
            }
        }
    };
    oReq.onerror = function () {
        console.error('[METRICS] XHR error fetching /metrics');
    };
    oReq.open("GET", k8s_url + "/metrics");
    oReq.send();
}

function getChaosJobsPodsPhase() {
    var oReq = new XMLHttpRequest();
    oReq.onload = function () {
        if (this.status !== 200) return;
        var lines = this.responseText.split('\n');
        for (var i = 0;i < lines.length;i++){
            var metric = lines[i].split(' ');
            if (!metric[0] || metric[0] === '') continue;

            if (metric[0].match(chaos_job_regex)) {
                var metrics_split = metric[0].split(":");
                chaos_jobs_status.set(metrics_split[1] + ":" + metrics_split[2] + ":" +  metrics_split[3], metric[1]);
            }
        }
    };
    oReq.onerror = function () {
        console.error('[METRICS] XHR error fetching /chaos_jobs_pod_phase');
    };
    oReq.open("GET", k8s_url + "/chaos_jobs_pod_phase");
    oReq.send();
}

function scroll_backwards() {
    if (chaos_logs_pos > 0){
        chaos_logs_pos = chaos_logs_pos -1;
        $('#current_log_pos').text(chaos_logs_pos);
        getChaosJobsLogs();
    } 
}

function getTotalLogsPos() {
    var oReq = new XMLHttpRequest();
    oReq.onreadystatechange = function () {
        if (this.readyState === XMLHttpRequest.DONE && this.status === 200) {
            if (log_tail_switch) {
                if (this.responseText.trim() == "null") {
                    $('#total_logs_pos').text("0");
                } else {
                    $('#total_logs_pos').text(this.responseText);
                }
            }
        }
    };;
    oReq.open("GET", k8s_url + "/chaos/logs/count?logid=" + random_code);
    oReq.send();
}

function scroll_forward() {
    chaos_logs_pos = chaos_logs_pos + 1;
    $('#current_log_pos').text(chaos_logs_pos);
    getChaosJobsLogs();
}

function getChaosJobsLogs() {
    var oReq = new XMLHttpRequest();
    oReq.onreadystatechange = function () {
        if (this.readyState === XMLHttpRequest.DONE && this.status === 200) {
            if (log_tail_switch) {
                if (this.responseText.trim() == "null") {
                    document.getElementById("logTailDiv").innerHTML = "Logs has been cleaned...";
                } else {
                    document.getElementById("logTailDiv").innerHTML = "";
                    document.getElementById("logTailDiv").innerHTML = this.responseText;
                }
            }
        }
    };;
    oReq.open("GET", k8s_url + "/chaos/logs?logid=" + random_code + "&pos=" + chaos_logs_pos);
    oReq.send();
    keepAliveJobsLogs();
}

function keepAliveJobsLogs() {
    var oReq = new XMLHttpRequest();
    oReq.onreadystatechange = function () {
        if (this.readyState === XMLHttpRequest.DONE && this.status === 200) {
            if (!this.responseText.toLowerCase().match(/.*null.*/)) {
                $('#alert_placeholder3').replaceWith(log_tail_alert_no_pixel + this.responseText.replace("nil", "") + '</div>');
            }
        }
    };;
    oReq.open("GET", k8s_url + "/chaos/logs/keepalive?logid=" + random_code + "&pos=" + chaos_logs_pos);
    oReq.send();
}

function runKubeLinter() {
    var oReq = new XMLHttpRequest();
    oReq.onload = function () {
        kubelinter = this.responseText;
        $('#alert_placeholder').replaceWith(alert_div + "KubeLinter executed correctly on namespace " + namespace +  ". Changing Regex and activating logs tail.</div>");
        enableLogTail();
        setLogRegex();

        $('#logTailRegex').val('{"since": "60", "pod":".*", "namespace":"' + namespace + '", "labels":".*", "annotations":".*", "containers":".*"}');
        
        if (!log_tail_switch) {
            setLogConsole(); 
        }
    };;

    $('#currentKubeLinterResult').text('KubeLinter launched. Set this regex and start log tail: {"since": "60", "pod":".*", "namespace":"' + namespace + '", "labels":".*", "annotations":".*", "containers":".*"}');

    openKubeApiRequest(oReq, "GET", "/kube/kube-linter?logid=" + random_code +"&namespace=" + namespace);
    oReq.send();
}

function getNamespaces() {
    if (configured_namespaces && configured_namespaces.length > 0) {
        namespaces = configured_namespaces;
        namespaces_index = 0;
        namespace = namespaces[namespaces_index];
        console.log("[CURRENT-NAMESPACE] " + namespace);
        $('#currentGameNamespace').text(namespace);
        return;
    }

    var oReq = new XMLHttpRequest();
    oReq.onload = function () {
        // Trim each entry: stray whitespace/newlines in the response would
        // otherwise end up inside Kubernetes API requests (namespace=foo%0A).
        namespaces = this.responseText
            .split(",")
            .map(function (ns) { return ns.trim(); })
            .filter(function (ns) { return ns !== ""; });
        namespaces_index = 0;
        namespace = namespaces[namespaces_index];
        console.log("[CURRENT-NAMESPACE] " + namespace);
        $('#currentGameNamespace').text(namespace);
    };;
    openKubeApiRequest(oReq, "GET", "/kube/namespaces");
    oReq.send();
}

function getEndpoint() {
    var oReq = new XMLHttpRequest();
    oReq.onload = function () {
        endpoint = this.responseText;
    };;
    openKubeApiRequest(oReq, "GET", "/kube/endpoint");
    oReq.send();
}

function getCurrentChaosContainer() {
    var oReq = new XMLHttpRequest();
    oReq.onload = function () {
        job_parsed = JSON.stringify(JSON.parse(this.responseText), null, 4);
        $('#currentChaosContainerYaml').text(job_parsed);
        editor_chaos_container_definition.setValue(job_parsed);
        editor_chaos_container_definition.refresh();  
    };;
    openKubeApiRequest(oReq, "GET", "/kube/chaos/containers?action=container_definition");
    oReq.send();
}

function enableLogTail() {
    var oReq = new XMLHttpRequest();
    openKubeApiRequest(oReq, "POST", "/kube/chaos/containers?action=enable_log_tail&id=" + random_code, true);
    oReq.onreadystatechange = function () {
        if (this.readyState === XMLHttpRequest.DONE && this.status === 200) {
            $('#alert_placeholder3').replaceWith(log_tail_alert + 'Logs tail started </div>');
        }
    };;
    oReq.setRequestHeader("Content-Type", "application/json");
    oReq.send("{}");
    setLogRegex();
}

function disableLogTail() {
    var oReq = new XMLHttpRequest();
    openKubeApiRequest(oReq, "POST", "/kube/chaos/containers?action=disable_log_tail&id=" + random_code, true);
    oReq.onreadystatechange = function () {
        if (this.readyState === XMLHttpRequest.DONE && this.status === 200) {
            $('#alert_placeholder3').replaceWith(log_tail_alert + 'Logs tail stopped </div>');
        }
    };;
    oReq.setRequestHeader("Content-Type", "application/json");
    // TODO: send payload for auth...
    oReq.send("foobar");
}

function setLogRegex() {
    log_tail_div.style.display = "block";
    $('#alert_placeholder3').replaceWith(log_tail_alert + 'Setting regex for filtering log source (by pod name)</div>');
    var oReq = new XMLHttpRequest();
    openKubeApiRequest(oReq, "POST", "/kube/chaos/containers?action=set_log_regex&id=" + random_code, true);
    oReq.onreadystatechange = function () {
        if (this.readyState === XMLHttpRequest.DONE && this.status === 200) {
            $('#alert_placeholder3').replaceWith(log_tail_alert + 'New regex has been configured</div>');
        }
    };;
    oReq.setRequestHeader("Content-Type", "application/json");
    oReq.send($('#logTailRegex').val());
}

function setChaosContainer() {
    if (!IsJsonString(currentChaosContainerJsonTextAreaVal())) {
        $('#alert_placeholder2').text('JSON syntax not valid.');
    }
    else {
        var oReq = new XMLHttpRequest();
        openKubeApiRequest(oReq, "POST", "/kube/chaos/containers?action=set", true);

        oReq.onreadystatechange = function () {
            if (this.readyState === XMLHttpRequest.DONE && this.status === 200) {
                $('#alert_placeholder2').text('New container definition has been saved.');
            }
        };;
        oReq.setRequestHeader("Content-Type", "application/json");
        oReq.send(currentChaosContainerJsonTextAreaVal());
    }
}

function startChaosNode(node_name) {
    var oReq = new XMLHttpRequest();
    oReq.onload = function () {
        $('#alert_placeholder').replaceWith(alert_div + 'Latest action: Launched chaos job against ' + node_name + '</div>');
    };;
    $('#alert_placeholder').replaceWith(alert_div + 'Latest action: Start chaos job against ' + node_name + '</div>');
    openKubeApiRequest(oReq, "GET", "/kube/chaos/nodes?nodename=" + node_name + "&namespace=" + namespace);
    oReq.send();
}

function rebootVirtualMachine(vm_name) {
    var oReq = new XMLHttpRequest();
    oReq.onload = function () {
        $('#alert_placeholder').replaceWith(alert_div + 'Latest action: Reboot virtual machine ' + vm_name + '</div>');
    };;
    $('#alert_placeholder').replaceWith(alert_div + 'Latest action: Preparing virtual machine ' + vm_name + '</div>');
    openKubeApiRequest(oReq, "GET", "/kube/vm_reboot?vm_name=" + vm_name + "&namespace=" + namespace);
    oReq.send();
}

function deletePods(pod_name) {
    var oReq = new XMLHttpRequest();
    oReq.onload = function () {
        $('#alert_placeholder').replaceWith(alert_div + 'Latest action: Kill ' + pod_name + '</div>');
    };;
    openKubeApiRequest(oReq, "GET", "/kube/pods?action=delete&pod_name=" + pod_name + "&namespace=" + namespace);
    oReq.send();
}

function addNodeAndVMstoPods() {
    if (chaos_vms && virtualMachines && virtualMachines.length > 0) {
        pods = pods.concat(virtualMachines);
    }
    
    if (nodes && nodes.length > 0) {
        pods = pods.concat(nodes);
    }
    return pods;
}

function getPods() {
    if (chaos_pods) {
        if (!namespace) {
            return;
        }

        var oReq = new XMLHttpRequest();
        oReq.onload = function () {
            var jsonData = parseJsonResponseOrNull(this, "GET /kube/pods?action=list");
            if (!jsonData || !Array.isArray(jsonData.items)) {
                return;
            }

            let new_pods = jsonData.items;
            
            // Pod might just be killed in game, but not terminated in k8s yet.
            // Only keep "killed" visual if K8s hasn't reported it as fully ready again.
            for (i=0; i<new_pods.length; i++) {
                if (new_pods[i].status !== "ready" && aliens.some((alien) => alien.name == new_pods[i].name && alien.status == "killed")) {
                    new_pods[i].status = "killed";
                }
            }
            pods = new_pods;
            addNodeAndVMstoPods();
        };;
        openKubeApiRequest(oReq, "GET", "/kube/pods?action=list&namespace=" + encodeURIComponent(namespace));
        oReq.send();
    }
    else {
        pods = [];
        addNodeAndVMstoPods();
    }
}

function getNodes() {
    if (chaos_nodes) {
        var oReq = new XMLHttpRequest();
        oReq.onload = function () {
            var jsonData = parseJsonResponseOrNull(this, "GET /kube/nodes");
            if (!jsonData || !Array.isArray(jsonData.items)) {
                return;
            }

            nodes = jsonData.items;
        };;
        openKubeApiRequest(oReq, "GET", "/kube/nodes");
        oReq.send();
    }
    else {
        nodes = []
    }
}

function getVMs() {
    if (chaos_vms) {
        var oReq = new XMLHttpRequest();
        oReq.onload = function () {
            const jsonData = parseJsonResponseOrNull(this, "GET /kube/vm");
            if (!jsonData || !Array.isArray(jsonData.items)) {
                return;
            }

            virtualMachines = [];
            Array.from(jsonData.items).forEach(vm => {
                const name = vm.metadata.name; // Nome della VM
                const status = vm.status.printableStatus.toLowerCase(); // Stato della VM
                virtualMachines.push({ name: name, status: status });
            });
        };;
        openKubeApiRequest(oReq, "GET", "/kube/vm?namespace=" + namespace);
        oReq.send();
    }
    else {
        virtualMachines = [];
    }
}

window.setInterval(function getKubeItems() {
    if (game_mode_switch) {
        getNodes();
        getPods();
        getVMs();
    }
}, 500)

function keyDownHandler(e) {
    if (!modal_opened && game_mode_switch) {
        e.preventDefault();
        if (e.key == "Right" || e.key == "ArrowRight") {
            rightPressed = true;
        }
        else if (e.key == "Left" || e.key == "ArrowLeft") {
            leftPressed = true;
        }
        if (e.key == "Up" || e.key == "ArrowUp") {
            upPressed = true;
        }
        else if (e.key == "Down" || e.key == "ArrowDown") {
            downPressed = true;
        }
        else if (e.keyCode == 83) {
            if (shuffle) {
                shuffle = false;
                $('#alert_placeholder').replaceWith(alert_div + 'Latest action: Disable shuffle</div>');
            }
            else {
                shuffle = true
                $('#alert_placeholder').replaceWith(alert_div + 'Latest action: Enable shuffle</div>');
            }
        }
        else if (e.keyCode == 32) {
            firePressed = true;
        }
        else if (e.keyCode == 78) {
            switchNamespace();
        }
        else if (e.keyCode == 72) {
            if (help) {
                help = false;
            }
            else {
                help = true
            }
        }
        else if (e.keyCode == 67) {

            if (is_demo_mode()) {
                demo_mode_alert();
                return;
            }

            if (chaos_nodes) {
                chaos_nodes = false;
                $('#alert_placeholder').replaceWith(alert_div + 'Latest action: Hide nodes</div>');

            }
            else {
                chaos_nodes = true
                $('#alert_placeholder').replaceWith(alert_div + 'Latest action: Show nodes</div>');
            }
        }

        else if (e.keyCode == 86) {

            if (is_demo_mode()) {
                demo_mode_alert();
                return;
            }

            if (chaos_vms) {
                chaos_vms = false;
                $('#alert_placeholder').replaceWith(alert_div + 'Latest action: Hide Virtual Machines</div>');

            }
            else {
                chaos_vms = true
                $('#alert_placeholder').replaceWith(alert_div + 'Latest action: Show Virtual Machines</div>');
            }
        }

        else if (e.keyCode == 80) {
            if (chaos_pods) {
                chaos_pods = false;
                $('#alert_placeholder').replaceWith(alert_div + 'Latest action: Hide pods</div>');
            }
            else {
                chaos_pods = true
                $('#alert_placeholder').replaceWith(alert_div + 'Latest action: Show pods</div>');
            }
        }
        else if (e.keyCode == 73) {
            if (invasionEnabled) {
                invasionEnabled = false;
                $('#alert_placeholder').replaceWith(alert_div + 'Latest action: Invasion paused</div>');
            }
            else {
                invasionEnabled = true;
                $('#alert_placeholder').replaceWith(alert_div + 'Latest action: Invasion resumed</div>');
            }
        }
        else if (e.keyCode == 82) {
            resetInvasion();
        }
        else if (e.keyCode == 70) {
            rollFormation();
            $('#alert_placeholder').replaceWith(alert_div + 'Latest action: Formation changed to ' + currentFormation + '</div>');
        }
    }
}

function keyUpHandler(e) {
    if (e.key == "Right" || e.key == "ArrowRight") {
        rightPressed = false;
    }
    else if (e.key == "Left" || e.key == "ArrowLeft") {
        leftPressed = false;
    }
    else if (e.key == "Up" || e.key == "ArrowUp") {
        upPressed = false;
    }
    else if (e.key == "Down" || e.key == "ArrowDown") {
        downPressed = false;
    }
    else if (e.keyCode == 32) {
        firePressed = false;
    }
}

function drawAlien(alienX, alienY, name, status) {
    var image = new Image(); // Image constructor
    if (nodes.some((node) => node.name == name)) {
        image.src = './images/k8s_node.png';
        ctx.font = "14px 'Ubuntu Mono'";
        ctx.drawImage(image, alienX, alienY, 30, 40);
        ctx.fillText(name.substring(0, 10) + '..', alienX, alienY + 50);
    }
    else if (virtualMachines.some((vm) => vm.name == name)) {
        image.src = `./images/sprite_invader_vm_${status}.png`;
        ctx.font = "14px 'Ubuntu Mono'";
        ctx.drawImage(image, alienX, alienY, 40, 40);
        ctx.fillText(name.substring(0, 10) + '..', alienX, alienY + 50);
    }
    else {
        image.src = `./images/sprite_invader_${status}.png`;
        ctx.font = "12px 'Ubuntu Mono'";
        ctx.drawImage(image, alienX, alienY, 40, 40);
        if (showPodName) {
            ctx.fillText(name.substring(0, 10) + '..', alienX, alienY + 45);
        }
    }
    ctx.closePath();
}

function checkRocketAlienCollision(rocket) {
    // AABB collision against the aliens' effective (marching) positions.
    var rocketSize = 20;
    var alienHeight = 40;
    for (var i = aliens.length - 1; i >= 0; i--) {
        // Skip dead-but-still-despawning aliens too: rockets pass through
        // corpses instead of being wasted (and kills aren't double-counted).
        if (!aliens[i]["active"] || aliens[i]["status"] === "killed") {
            continue;
        }
        var ex = aliens[i]["x"] + invasionOffsetX;
        var ey = aliens[i]["y"] + invasionOffsetY;
        if (rocket.x + rocketSize >= ex && rocket.x <= ex + aliensWidth &&
            rocket.y + rocketSize >= ey && rocket.y <= ey + alienHeight) {
            aliens[i]["status"] = "killed";
            invasionKills += 1;
            // Aliens might be updated before new pods are fetched
            for (j=0; j<pods.length; j++) {
                if (pods[j].name == aliens[i].name) {
                    pods[j].status = "killed";
                }
            }
            if (nodes.some((node) => node.name == aliens[i]["name"])) {
                aliens[i]["active"] = false;
                startChaosNode(aliens[i]["name"]);
            }
            else if (virtualMachines.some((vm) => vm.name == aliens[i]["name"])) {
                aliens[i]["active"] = false;
                rebootVirtualMachine(aliens[i]["name"]);
            }
            else {
                deletePods(aliens[i]["name"]);
            }
            return true;
        }
    }
    return false;
}

function shuffleAliens() {
    pods = pods.sort(() => Math.random() - 0.5)
}

function drawRockets() {
    var image = new Image(); // Image constructor
    image.src = './images/kuberocket.png';
    for (var r = rockets.length - 1; r >= 0; r--) {
        rockets[r].y -= rocketSpeed;
        if (rockets[r].y < -20) {
            rockets.splice(r, 1);
            continue;
        }
        ctx.drawImage(image, rockets[r].x, rockets[r].y, 20, 20);
        if (checkRocketAlienCollision(rockets[r])) {
            rockets.splice(r, 1);
        }
    }
    ctx.closePath();
}

function drawSpaceship() {
    var image = new Image(); // Image constructor
    image.src = './images/spaceship.png';
    ctx.drawImage(image, spaceshipX, spaceshipY, 60, 60);
    ctx.closePath();
}

window.setInterval(function draw() {
    if (namespacesJumpFlag){
        randNamespaceJump(1, 10, 8);
    }
}, 1000)

// --- Invasion mechanics: the fleet marches side to side, descends at the
// walls, and speeds up as it thins out. Positions come from the pod grid;
// the march is a global offset so the 1s pod reconciler never fights it. ---
var invasionEnabled = true;     // toggle with 'i'
var invasionOffsetX = 0;
var invasionOffsetY = 0;
var invasionDir = 1;
var invasionBaseStep = 7;       // px per tick
var invasionDescent = 16;       // px down per wall bounce
var invasionGameOver = false;
var invasionGameOverReason = 'landed';   // 'landed' | 'ship'
var invasionWin = false;
var invasionStarted = false;
var invasionKills = 0;
var scaledDeployments = [];     // [{name, previousReplicas}] from the win scale-down

// Player lives: touching a living alien destroys the ship. Consequence:
// every lost ship scales the wave's deployments +1 replica - the invasion grows.
var playerLives = 3;
var playerInvulnerableUntil = 0;

// Levels: each cleared wave scales the deployments UP for a bigger, faster
// wave. Clear the final level and the deployments scale to 0 - total victory.
var invasionLevel = 1;
var maxInvasionLevel = 5;
var baseWaveReplicas = 8;
var waveReplicasIncrement = 4;
var levelBannerUntil = 0;

// Random attack formations, re-rolled per wave ('f' to re-roll mid-game).
var formations = ['grid', 'v', 'columns', 'wave', 'diamond'];
var currentFormation = formations[Math.floor(Math.random() * formations.length)];

function rollFormation() {
    var next = formations[Math.floor(Math.random() * formations.length)];
    if (next === currentFormation) {
        next = formations[(formations.indexOf(next) + 1) % formations.length];
    }
    currentFormation = next;
    aliens = []; // force the reconciler to re-place everyone in the new shape
}

function formationPosition(idx) {
    var w = Math.max(canvas.width, 600);
    var cx = w / 2;
    var clampX = function (x) { return Math.min(Math.max(x, 10), w - 60); };
    var clampY = function (y) { return Math.max(y, 10); };
    var col, row;
    switch (currentFormation) {
        case 'v':
            row = Math.ceil(idx / 2);
            var side = (idx % 2 === 0) ? -1 : 1;
            return { x: clampX(cx + side * row * 55), y: clampY(10 + row * 32) };
        case 'columns':
            col = idx % 4;
            row = Math.floor(idx / 4);
            return { x: clampX(80 + col * Math.max(120, (w - 200) / 4)), y: clampY(10 + row * 48) };
        case 'wave':
            col = idx % 12;
            row = Math.floor(idx / 12);
            return { x: clampX(10 + col * 58), y: clampY(45 + row * 70 + Math.round(Math.sin(col * 0.9) * 28)) };
        case 'diamond':
            var ring = Math.floor(idx / 8) + 1;
            var theta = (idx % 8) * (Math.PI / 4);
            return {
                x: clampX(cx + Math.round(Math.cos(theta) * ring * 90)),
                y: clampY(115 + Math.round(Math.sin(theta) * ring * 45))
            };
        default: // grid
            col = idx % maxAliensPerRow;
            row = Math.floor(idx / maxAliensPerRow);
            return { x: clampX(10 + col * 60), y: clampY(10 + row * aliensIncrementY) };
    }
}

function bumpInvasionReplicas(delta) {
    var oReq = new XMLHttpRequest();
    openKubeApiRequest(oReq, "GET", "/kube/deployments/scale?namespace=" + encodeURIComponent(namespace) + "&delta=" + delta);
    oReq.send();
}

function playerHit() {
    playerLives -= 1;
    playerInvulnerableUntil = Date.now() + 2000;
    // Consequence: the invasion grows by one replica per lost ship.
    bumpInvasionReplicas(1);
    // Knock the fleet back to the top, classic-style.
    invasionOffsetX = 0;
    invasionOffsetY = 0;
    invasionDir = 1;
    if (playerLives <= 0) {
        invasionGameOverReason = 'ship';
        invasionGameOver = true;
        $('#alert_placeholder').replaceWith(alert_div + 'Ship destroyed! No lives left.</div>');
    }
    else {
        $('#alert_placeholder').replaceWith(alert_div + 'Ship destroyed! The invasion grows (+1 replica). Lives left: ' + playerLives + '</div>');
    }
}

// Multiple rockets in flight + autofire while holding space.
// firePressed is polled from the game loop (like the arrow keys) so firing
// keeps working while moving: OS key auto-repeat only applies to the most
// recently pressed key.
var rockets = [];               // [{x, y}]
var firePressed = false;
var lastRocketFire = 0;
var rocketCooldownMs = 110;
var maxRockets = 8;

function fireRocket() {
    if (invasionGameOver || invasionWin) {
        return;
    }
    var now = Date.now();
    if (now - lastRocketFire < rocketCooldownMs || rockets.length >= maxRockets) {
        return;
    }
    lastRocketFire = now;
    rockets.push({ x: spaceshipX + (spaceshipWidth / 3), y: spaceshipY });
}

function scaleNamespaceDeployments(replicas) {
    var oReq = new XMLHttpRequest();
    oReq.onload = function () {
        var parsed = parseJsonResponseOrNull(this, "GET /kube/deployments/scale");
        if (parsed && Array.isArray(parsed)) {
            scaledDeployments = parsed;
        }
    };
    openKubeApiRequest(oReq, "GET", "/kube/deployments/scale?namespace=" + encodeURIComponent(namespace) + "&replicas=" + replicas);
    oReq.send();
}

function resetInvasion() {
    invasionOffsetX = 0;
    invasionOffsetY = 0;
    invasionDir = 1;
    invasionGameOver = false;
    invasionGameOverReason = 'landed';
    invasionWin = false;
    invasionStarted = false;
    invasionKills = 0;
    invasionLevel = 1;
    levelBannerUntil = 0;
    playerLives = 3;
    playerInvulnerableUntil = 0;
    rockets = [];
    rollFormation();
    // Fresh game, fresh fleet: back to the level 1 wave size.
    scaleNamespaceDeployments(baseWaveReplicas);
    $('#alert_placeholder').replaceWith(alert_div + 'New game - level 1, formation: ' + currentFormation + '</div>');
}

window.setInterval(function marchInvasion() {
    if (!invasionEnabled || invasionGameOver || invasionWin || !game_mode_switch) {
        return;
    }
    // "Alive" excludes already-shot aliens: a killed pod keeps rendering (and
    // stays in the pod list) while it terminates, so counting it would make
    // the win unreachable.
    var active = aliens.filter(function (a) { return a.active && a.status !== "killed"; });
    if (active.length === 0) {
        if (invasionStarted) {
            if (invasionLevel >= maxInvasionLevel) {
                // Final level cleared: scale the deployments to 0 before the
                // ReplicaSets can respawn them. Total victory.
                invasionWin = true;
                scaleNamespaceDeployments(0);
            }
            else {
                // Wave cleared: level up. Bigger fleet, faster march, +1 life.
                invasionLevel += 1;
                playerLives = Math.min(playerLives + 1, 5);
                levelBannerUntil = Date.now() + 3000;
                invasionOffsetX = 0;
                invasionOffsetY = 0;
                invasionDir = 1;
                invasionStarted = false;
                rollFormation();
                scaleNamespaceDeployments(baseWaveReplicas + (invasionLevel - 1) * waveReplicasIncrement);
                $('#alert_placeholder').replaceWith(alert_div + 'Level ' + invasionLevel + '! Formation: ' + currentFormation + ' - the invasion grows. +1 life.</div>');
            }
        }
        return;
    }
    invasionStarted = true;

    // Contact with a living alien destroys the ship (with a 12px forgiveness
    // margin and a 2s invulnerability window after each hit).
    if (Date.now() > playerInvulnerableUntil) {
        for (var ci = 0; ci < active.length; ci++) {
            var ax = active[ci].x + invasionOffsetX;
            var ay = active[ci].y + invasionOffsetY;
            if (spaceshipX + spaceshipWidth - 12 >= ax && spaceshipX + 12 <= ax + aliensWidth &&
                spaceshipY + spaceshipHeight - 12 >= ay && spaceshipY + 12 <= ay + 40) {
                playerHit();
                if (invasionGameOver) {
                    return;
                }
                break;
            }
        }
    }

    // Classic rules: the fewer invaders left, the faster they march - and
    // every level adds base speed.
    var speed = invasionBaseStep + Math.max(0, 16 - active.length) + (invasionLevel - 1) * 2;

    var minX = Infinity, maxX = -Infinity, maxY = -Infinity;
    active.forEach(function (a) {
        minX = Math.min(minX, a.x + invasionOffsetX);
        maxX = Math.max(maxX, a.x + invasionOffsetX + aliensWidth);
        maxY = Math.max(maxY, a.y + invasionOffsetY + 40);
    });

    if (invasionDir > 0 && maxX + speed >= canvas.width - 10) {
        invasionDir = -1;
        invasionOffsetY += invasionDescent;
    }
    else if (invasionDir < 0 && minX - speed <= 10) {
        invasionDir = 1;
        invasionOffsetY += invasionDescent;
    }
    else {
        invasionOffsetX += invasionDir * speed;
    }

    if (maxY >= canvas.height - 60) {
        invasionGameOver = true;
    }
}, 350);

window.setInterval(function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (i=0; i<aliens.length; i++) {
        if (aliens[i]["active"]) {
            drawAlien(aliens[i]["x"] + invasionOffsetX, aliens[i]["y"] + invasionOffsetY, aliens[i]["name"], aliens[i]["status"]);
        }
    }
    // Blink the ship while invulnerable after a hit.
    if (Date.now() > playerInvulnerableUntil || Math.floor(Date.now() / 120) % 2 === 0) {
        drawSpaceship();
    }

    if (invasionGameOver) {
        ctx.save();
        ctx.fillStyle = '#FF3333';
        ctx.font = "44px 'Ubuntu Mono'";
        var gameOverMsg = (invasionGameOverReason === 'ship')
            ? 'GAME OVER - SHIP DESTROYED'
            : 'GAME OVER - THE PODS HAVE LANDED';
        ctx.fillText(gameOverMsg, Math.max(10, canvas.width / 2 - 420), canvas.height / 2 - 20);
        ctx.fillStyle = 'white';
        ctx.font = "20px 'Ubuntu Mono'";
        ctx.fillText('pods destroyed: ' + invasionKills + "   -   press 'r' to defend the cluster again", Math.max(10, canvas.width / 2 - 280), canvas.height / 2 + 20);
        ctx.restore();
    }

    if (invasionWin) {
        ctx.save();
        ctx.fillStyle = '#33FF66';
        ctx.font = "44px 'Ubuntu Mono'";
        ctx.fillText('YOU WIN - ALL ' + maxInvasionLevel + ' LEVELS CLEARED', Math.max(10, canvas.width / 2 - 380), canvas.height / 2 - 20);
        ctx.fillStyle = 'white';
        ctx.font = "20px 'Ubuntu Mono'";
        ctx.fillText('deployments scaled to 0   -   pods destroyed: ' + invasionKills + "   -   press 'r' for a new game", Math.max(10, canvas.width / 2 - 360), canvas.height / 2 + 20);
        ctx.restore();
    }

    if (!invasionWin && !invasionGameOver && Date.now() < levelBannerUntil) {
        ctx.save();
        ctx.fillStyle = '#FFD633';
        ctx.font = "44px 'Ubuntu Mono'";
        ctx.fillText('LEVEL ' + invasionLevel, Math.max(10, canvas.width / 2 - 100), canvas.height / 2 - 20);
        ctx.fillStyle = 'white';
        ctx.font = "20px 'Ubuntu Mono'";
        ctx.fillText('the invasion grows - formation: ' + currentFormation, Math.max(10, canvas.width / 2 - 220), canvas.height / 2 + 20);
        ctx.restore();
    }
    
    if (firePressed) {
        fireRocket();
    }
    drawRockets();

    if (x + dx > canvas.width-ballRadius || x + dx < ballRadius) {
        dx = -dx;
    }
    if (y + dy > canvas.height-ballRadius || y + dy < ballRadius) {
        dy = -dy;
    }
    
    if (autoPilot){
        spaceshipY = 340;
        
        if (getRandomInt(100) < randomFactor) {
            fireRocket();
        }
        
        if (autoPilotDirection == 0) {
            autoPilotDirection = getRandomInt(canvas.width-spaceshipWidth);
            spaceshipxOld = spaceshipX;
        } 
        else if ((spaceshipX == autoPilotDirection)) {
            autoPilotDirection = getRandomInt(canvas.width-spaceshipWidth);
            spaceshipxOld = spaceshipX;
        }
        else if ((autoPilotDirection < spaceshipxOld) && (spaceshipX < autoPilotDirection)) {
            autoPilotDirection = getRandomInt(canvas.width-spaceshipWidth);
            spaceshipxOld = spaceshipX;
        }
        else if ((autoPilotDirection > spaceshipxOld) && (spaceshipX > autoPilotDirection)) {
            autoPilotDirection = getRandomInt(canvas.width-spaceshipWidth);
            spaceshipxOld = spaceshipX;
        }
        else {
            if (autoPilotDirection > spaceshipX) {
                spaceshipX += 5;
            }
            else {
                spaceshipX -= 5;
            }
        }
    }

    if (rightPressed) {
        spaceshipX += 3;
        if (spaceshipX + spaceshipWidth > canvas.width) {
            spaceshipX = canvas.width - spaceshipWidth;
        }
    }
    else if (leftPressed) {
        spaceshipX -= 3;
        if (spaceshipX < 0) {
            spaceshipX = 0;
        }
    }

    if (upPressed) {
        spaceshipY -= 3;
        if (spaceshipY < 0) {
            spaceshipY = 0;
        }
    }

    else if (downPressed) {
        spaceshipY += 3;
        if (spaceshipY + spaceshipHeight > canvas.height) {
            spaceshipY = canvas.height - spaceshipHeight;
        }
    }

    ctx.fillStyle = 'white';
    ctx.font = "18px 'Ubuntu Mono'";

    if (localStorage.getItem('k8s_api_endpoint') != "") {
        ctx.fillText('API Endpoint: ' + localStorage.getItem('k8s_api_endpoint'), 10, startYforHelp);
    }
    else if (endpoint != "") {
        ctx.fillText('Cluster: ' + endpoint, 10, startYforHelp);

    }
    ctx.fillText('Current Namespace: ' + namespace, 10, startYforHelp + 20);
    ctx.fillText('Alien Shuffle: ' + shuffle, 10, startYforHelp + 40);
    ctx.fillText('Auto Namespaces Switch: ' + namespacesJumpStatus, 10, startYforHelp + 60);

    ctx.fillText('press \'h\' for help!', 10, startYforHelp + 80);

    ctx.fillText('Level: ' + invasionLevel + ' / ' + maxInvasionLevel, canvas.width - 260, 30);
    ctx.fillText('Pods destroyed: ' + invasionKills, canvas.width - 260, 50);
    ctx.fillText('Lives: ' + Array(Math.max(playerLives, 0) + 1).join('♥ '), canvas.width - 260, 70);
    ctx.fillText('Formation: ' + currentFormation, canvas.width - 260, 90);
    if (!invasionEnabled) {
        ctx.fillText('Invasion: paused', canvas.width - 260, 110);
    }

    if (help) {
        ctx.fillText('h => Enable or disable help', 10, 280);
        ctx.fillText('s => Enable or disable shuffle for aliens', 10, 300);
        ctx.fillText('n => Change the namespace', 10, 320);
        ctx.fillText('p => Display pods switch', 10, 340);
        ctx.fillText('c => Display nodes switch', 10, 360);
        ctx.fillText('v => Display virtual machines (KubeVirt) switch', 10, 380);
        ctx.fillText('i => Pause or resume the invasion march', 10, 400);
        ctx.fillText('r => Reset the invasion (after game over or win)', 10, 420);
        ctx.fillText('f => Change attack formation', 10, 440);
    }
}, 10)

function buttonShuffleHelper() {
    if (shuffle) {
        shuffle = false;
        $('#alert_placeholder').replaceWith(alert_div + 'Latest action: Shuffle Disable</div>');
        $("#buttonShuffle").text("Enable Shuffle");
    }
    else {
        shuffle = true
        $('#alert_placeholder').replaceWith(alert_div + 'Latest action: Shuffle Enabled</div>');
        $("#buttonShuffle").text("Disable Shuffle");
    }
}

function namespacesJumpControl() {
    if (namespacesJumpFlag) {
        namespacesJumpFlag = false;
        $("#namespacesJumpButton").text("Enable Auto NS Switch");
        $('#alert_placeholder').replaceWith(alert_div + 'Latest action: Disabled automatic switch of namespace</div>');
        namespacesJumpStatus = 'Disabled'
    } else {
        namespacesJumpFlag = true;
        $("#namespacesJumpButton").text("Disable Auto NS Switch");
        $('#alert_placeholder').replaceWith(alert_div + 'Latest action: Enabled automatic switch of namespace </div>');
        namespacesJumpStatus = 'Enabled'
    }
}

function showPodNameControl() {
    if (showPodName) {
        showPodName = false;
        $("#buttonOnlyPodName").text("Show Pods Name");
    }
    else {
        showPodName = true
        $("#buttonOnlyPodName").text("Hide Pods Name");
    }
}

function podExists(podName) {
    for (i=0; i<aliens.length; i++) {
        if (aliens[i]["name"] == podName) {
            return true;
        }
    }
    return false;
}

function findReplace() {
    for (i=0; i<aliens.length; i++) {
        if (!aliens[i]["active"]) {
            return i;
        }
    }
    return -1;
}

function randNamespaceJump(min, max, jumpRandomFactor) {
    if ((Math.random() * (max - min) + min) > jumpRandomFactor) {
        $('#alert_placeholder').replaceWith(alert_div + 'Latest action: Switch Namespace</div>');
        switchNamespace();
    }
}

window.setInterval(function setAliens() {
    if (shuffle) {
        pods = pods.sort(() => Math.random() - 0.5)
    }

    aliens = [];
    if (pods.length > 0) {
        for (i=0; i<pods.length; i++) {
            if (!podExists(pods[i].name)) {
                var replaceWith = findReplace();
                if (replaceWith != -1) {
                    aliens[replaceWith] = {"name": pods[i].name, "status": pods[i].status, "x": aliens[replaceWith]["x"], "y": aliens[replaceWith]["y"], "active": true}
                    cnt =+ 1;
                }
                else {
                    // Positions come from the current attack formation; they
                    // only depend on the index, so the 1s rebuild is stable.
                    var pos = formationPosition(aliens.length);
                    aliens.push({"name": pods[i].name, "status": pods[i].status, "x": pos.x, "y": pos.y, "active": true});
                    cnt =+ 1;
                }
            }
        }
    }
}, 1000)

window.setInterval(function backgroundTasks() {
    // console.log("Nodes:", nodes);
    // console.log("Virtual Machines:", virtualMachines);
    // console.log("chaos_vms flag:", chaos_vms);
    // console.log("Pods:", pods);

    if (!codename_configured) {
        chaosProgram = $('#chaosProgramTextArea').val();
        chaosProgramWithCodename = chaosProgram.replace(codename_regex, "chaos-codename: " + codename);
        $('#chaosProgramTextArea').val(chaosProgramWithCodename);
        $('#chaosProgramTextArea').text(chaosProgramWithCodename);
        chaosProgram = chaosProgramWithCodename;
        codename_configured = true;
    }

    if (game_mode_switch || programming_mode_switch || log_tail_switch) {
        getMetrics();
        getChaosJobsPodsPhase();
        updateMainMetricsChart();
    }

    if (log_tail_switch) {
	    getChaosJobsLogs();
        getTotalLogsPos();
    }
    
    if (programming_mode_switch && chaos_program_valid) {
        drawChaosProgramFlow();
    }
    
    if (chaos_report_switch) {
        updateElapsedTimeArray(chaosReportprojectName);
        updateChaosReportStartTime(chaosReportprojectName);
        drawCanvasHTTPStatusCodeStats();
        chaosReportKeepAlive(chaosReportprojectName);
    }

}, 2000)

document.addEventListener("keydown", keyDownHandler, false);
document.addEventListener("keyup", keyUpHandler, false);

setSystemSettings();

waitForReachableK8sUrl(function () {
    if (endpoint != null && endpoint != "") {
        console.log("[K-INV] Connected to Kubernetes API at " + endpoint);
         getEndpoint();
    }   
    getNamespaces();
    getSavedPresets();
});

document.getElementById("gameContainer").style.visibility = "hidden";
document.getElementById("metricsPresetsRow").style.visibility = "hidden";
document.getElementById("gameContainer").style.opacity = 0;
document.getElementById("metricsPresetsRow").style.opacity = 0;
document.getElementById("gameContainer").style.visibility = "visible";
document.getElementById("metricsPresetsRow").style.visibility = "visible";
document.getElementById("gameContainer").style.opacity = 1;
document.getElementById("metricsPresetsRow").style.opacity = 1;

// TO DO: Apply also when modals are opened
$('.modal').on('hidden.bs.modal', function () {
 setModalState(false);
});

function waitForReachableK8sUrl(onReady, retryMs = 500) {
    (function poll() {
        if (!k8s_url || !/^https?:\/\/.+/.test(k8s_url)) {
            return setTimeout(poll, retryMs);
        }

        var oReq = new XMLHttpRequest();
        oReq.timeout = 5000;
        oReq.onreadystatechange = function () {
            if (this.readyState === XMLHttpRequest.DONE) {
                if (this.status >= 200 && this.status < 500) {
                    onReady();
                } else {
                    setTimeout(poll, retryMs);
                }
            }
        };
        oReq.ontimeout = function () { setTimeout(poll, retryMs); };
        oReq.onerror = function () { setTimeout(poll, retryMs); };
        oReq.open('GET', k8s_url, true);
        oReq.send();
    })();
}