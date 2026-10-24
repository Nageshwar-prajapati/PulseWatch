const urlInput = document.getElementById("url");
const addUrlBtn = document.getElementById("addUrlBtn");
const recheckAllBtn = document.getElementById("recheckAllBtn");
const urlTableBody = document.getElementById("urlTableBody");
const totalUrls = document.getElementById("totalUrls");
const onlineUrls = document.getElementById("onlineUrls");
const offlineUrls = document.getElementById("offlineUrls");
const lastCheck = document.getElementById("lastCheck");
const recentAlert = document.getElementById("recentAlert");
const notificationList = document.getElementById("notificationList");
const clearNotesBtn = document.getElementById("clearNotesBtn");

let monitoredUrls = [];
let statusChart = null;

addUrlBtn.addEventListener("click", addURL);
urlInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") addURL();
});
recheckAllBtn.addEventListener("click", recheckAllURLs);
clearNotesBtn.addEventListener("click", function () { PW.clearAlerts(); });

async function loadURLs() {
    try {
        const data = await PW.api("/api/monitors");
        monitoredUrls = data.monitors;
        render();
    } catch (e) { /* redirected to login or network error */ }
}

function render() {
    displayURLs();
    updateDashboard();
}

function replaceMonitor(updated) {
    const i = monitoredUrls.findIndex(m => m.id === updated.id);
    if (i === -1) monitoredUrls.push(updated); else monitoredUrls[i] = updated;
}

async function addURL() {
    const url = urlInput.value.trim();
    if (url === "") { alert("Please enter a URL."); return; }

    addUrlBtn.disabled = true;
    addUrlBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
        const data = await PW.api("/api/monitors", { method: "POST", body: { url: url } });
        replaceMonitor(data.monitor);
        urlInput.value = "";
        render();
        PW.toast(data.monitor.url + " is " + (data.monitor.status === "Online" ? "UP" : "DOWN"),
            data.monitor.status === "Online" ? "success" : "error");
        PW.refreshAlerts();
    } catch (e) {
        alert(e.message);
    }
    addUrlBtn.disabled = false;
    addUrlBtn.textContent = "Add URL";
}

function makeButton(cls, html, title, onClick) {
    const b = document.createElement("button");
    b.className = cls;
    b.innerHTML = html;
    b.title = title;
    b.addEventListener("click", onClick);
    return b;
}

function displayURLs() {
    urlTableBody.innerHTML = "";

    if (monitoredUrls.length === 0) {
        urlTableBody.innerHTML = '<tr><td colspan="5">No URLs yet. Add one above.</td></tr>';
        return;
    }

    monitoredUrls.forEach(function (item) {
        const row = document.createElement("tr");

        const urlCell = document.createElement("td");
        urlCell.textContent = item.url.replace(/^https?:\/\//, "");
        urlCell.title = item.url;

        const statusCell = document.createElement("td");
        const statusSpan = document.createElement("span");
        statusSpan.classList.add("status");
        if (item.status === "Online") statusSpan.classList.add("online");
        else if (item.status === "Offline") statusSpan.classList.add("offline");
        else statusSpan.classList.add("checking-status");
        statusSpan.textContent = item.status;
        if (item.statusCode) statusSpan.title = "HTTP " + item.statusCode;
        statusCell.appendChild(statusSpan);

        const responseCell = document.createElement("td");
        responseCell.textContent = item.responseTime != null ? item.responseTime + " ms" : "--";

        const lastCheckedCell = document.createElement("td");
        lastCheckedCell.textContent = PW.formatDateTime(item.lastChecked);

        const actionCell = document.createElement("td");
        const recheckButton = makeButton("recheck", '<i class="fa-solid fa-rotate"></i>', "Recheck now", function () {
            recheckURL(item, recheckButton, statusSpan);
        });
        actionCell.appendChild(recheckButton);
        actionCell.appendChild(makeButton("view", '<i class="fa-solid fa-eye"></i>', "View", function () { viewURL(item); }));
        actionCell.appendChild(makeButton("edit", '<i class="fa-solid fa-pen"></i>', "Edit", function () { editURL(item); }));
        actionCell.appendChild(makeButton("delete", '<i class="fa-solid fa-trash"></i>', "Delete", function () { deleteURL(item.id); }));

        row.appendChild(urlCell);
        row.appendChild(statusCell);
        row.appendChild(responseCell);
        row.appendChild(lastCheckedCell);
        row.appendChild(actionCell);
        urlTableBody.appendChild(row);
    });
}

async function recheckURL(item, button, statusSpan) {
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i>';
    statusSpan.className = "status checking-status";
    statusSpan.textContent = "Checking...";
    try {
        const data = await PW.api("/api/monitors/" + item.id + "/recheck", { method: "POST" });
        replaceMonitor(data.monitor);
        render();
        PW.toast(data.monitor.url + " is " + (data.monitor.status === "Online" ? "UP" : "DOWN") +
            " (" + data.monitor.responseTime + " ms)", data.monitor.status === "Online" ? "success" : "error");
        PW.refreshAlerts();
    } catch (e) {
        alert(e.message);
        render();
    }
}

async function recheckAllURLs() {
    if (monitoredUrls.length === 0) return;
    recheckAllBtn.disabled = true;
    recheckAllBtn.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i> Checking...';
    try {
        const data = await PW.api("/api/monitors/recheck-all", { method: "POST" });
        monitoredUrls = data.monitors;
        render();
        PW.toast("Rechecked " + data.monitors.length + " URL(s)", "info");
        PW.refreshAlerts();
    } catch (e) {
        alert(e.message);
    }
    recheckAllBtn.disabled = false;
    recheckAllBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> Recheck All';
}

function updateDashboard() {
    totalUrls.textContent = monitoredUrls.length;
    const online = monitoredUrls.filter(m => m.status === "Online").length;
    const offline = monitoredUrls.filter(m => m.status === "Offline").length;
    onlineUrls.textContent = online;
    offlineUrls.textContent = offline;

    const checked = monitoredUrls.filter(m => m.lastChecked).map(m => m.lastChecked).sort();
    lastCheck.textContent = checked.length ? PW.formatTime(checked[checked.length - 1]) : "--";

    updateStatusChart(online, offline);
    updateRecentAlert();
}

function updateStatusChart(online, offline) {
    const canvas = document.getElementById("statusChart");
    if (!canvas || typeof Chart === "undefined") return;

    const centerTextPlugin = {
        id: "centerText",
        afterDraw: function (chart) {
            const ctx = chart.ctx;
            const area = chart.chartArea;
            const x = (area.left + area.right) / 2;
            const y = (area.top + area.bottom) / 2;
            const data = chart.data.datasets[0].data;
            ctx.save();
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = "bold 14px Arial";
            ctx.fillStyle = "#22c55e";
            ctx.fillText("● Online  " + data[0], x, y - 20);
            ctx.font = "bold 22px Arial";
            ctx.fillStyle = "#172033";
            ctx.fillText(data[0] + data[1], x, y + 2);
            ctx.font = "bold 14px Arial";
            ctx.fillStyle = "#ef4444";
            ctx.fillText("● Offline  " + data[1], x, y + 28);
            ctx.restore();
        }
    };

    if (statusChart === null) {
        statusChart = new Chart(canvas, {
            type: "doughnut",
            data: {
                labels: ["Online", "Offline"],
                datasets: [{
                    data: [online, offline],
                    backgroundColor: ["#22c55e", "#ef4444"],
                    borderColor: "#ffffff",
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "65%",
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                const data = context.dataset.data;
                                const total = data[0] + data[1];
                                if (total === 0) return context.label + ": 0";
                                return context.label + ": " + context.raw + " (" + ((context.raw / total) * 100).toFixed(1) + "%)";
                            }
                        }
                    }
                }
            },
            plugins: [centerTextPlugin]
        });
    } else {
        statusChart.data.datasets[0].data = [online, offline];
        statusChart.update();
    }
}

function updateRecentAlert() {
    const offlineSites = monitoredUrls.filter(m => m.status === "Offline");
    if (offlineSites.length === 0) {
        recentAlert.textContent = "All monitored sites are up";
        recentAlert.style.color = "#249447";
        return;
    }
    recentAlert.innerHTML = "";
    recentAlert.style.color = "";
    offlineSites.forEach(function (item) {
        const alertItem = document.createElement("div");
        alertItem.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> ' +
            PW.escapeHtml(item.url + " is DOWN" + (item.statusCode ? " (HTTP " + item.statusCode + ")" : ""));
        alertItem.style.marginBottom = "10px";
        alertItem.style.color = "#ef4444";
        alertItem.style.fontWeight = "bold";
        recentAlert.appendChild(alertItem);
    });
}

document.addEventListener("pw:alerts", function (e) {
    const alerts = e.detail.alerts;
    clearNotesBtn.hidden = alerts.length === 0;
    if (!alerts.length) { notificationList.textContent = "No notifications"; return; }
    notificationList.innerHTML = alerts.slice(0, 8).map(a =>
        `<div class="note ${a.kind}">${PW.escapeHtml(a.message)}<small>${PW.formatDateTime(a.createdAt)}</small></div>`
    ).join("");
});

function viewURL(item) {
    alert(
        "URL: " + item.url +
        "\nStatus: " + item.status +
        "\nHTTP Code: " + (item.statusCode || "--") +
        "\nResponse Time: " + (item.responseTime != null ? item.responseTime + " ms" : "--") +
        "\nLast Checked: " + PW.formatDateTime(item.lastChecked)
    );
}

async function editURL(item) {
    const newURL = prompt("Enter new URL:", item.url);
    if (newURL === null) return;
    if (newURL.trim() === "") { alert("URL cannot be empty."); return; }
    try {
        const data = await PW.api("/api/monitors/" + item.id, { method: "PUT", body: { url: newURL } });
        replaceMonitor(data.monitor);
        render();
    } catch (e) {
        alert(e.message);
    }
}

async function deleteURL(id) {
    if (!confirm("Are you sure you want to delete this URL?")) return;
    try {
        await PW.api("/api/monitors/" + id, { method: "DELETE" });
        monitoredUrls = monitoredUrls.filter(m => m.id !== id);
        render();
    } catch (e) {
        alert(e.message);
    }
}

PW.requireAuth().then(function () {
    loadURLs();
    // The server re-checks every URL in the background; refresh the view regularly.
    setInterval(loadURLs, 15000);
}).catch(function () {});
