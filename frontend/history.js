const historyBody = document.getElementById("historyBody");
const monitorFilter = document.getElementById("monitorFilter");
const statusFilter = document.getElementById("statusFilter");
const refreshBtn = document.getElementById("refreshBtn");
const summary = document.getElementById("summary");

async function loadMonitors() {
    const data = await PW.api("/api/monitors");
    const current = monitorFilter.value;
    monitorFilter.innerHTML = '<option value="">All URLs</option>' + data.monitors.map(m =>
        `<option value="${m.id}">${PW.escapeHtml(m.url.replace(/^https?:\/\//, ""))}</option>`).join("");
    monitorFilter.value = current;
}

async function loadHistory() {
    const params = new URLSearchParams({ limit: 500 });
    if (monitorFilter.value) params.set("monitor", monitorFilter.value);
    if (statusFilter.value) params.set("status", statusFilter.value);
    const data = await PW.api("/api/history?" + params.toString());
    const rows = data.history;

    const total = rows.length;
    const up = rows.filter(r => r.status === "Online").length;
    const avg = total ? Math.round(rows.reduce((s, r) => s + (r.responseTime || 0), 0) / total) : 0;
    summary.innerHTML = `
        <div><span>Total checks</span><strong>${total}</strong></div>
        <div><span>Up</span><strong class="up">${up}</strong></div>
        <div><span>Down</span><strong class="down">${total - up}</strong></div>
        <div><span>Uptime</span><strong>${total ? ((up / total) * 100).toFixed(1) + "%" : "--"}</strong></div>
        <div><span>Avg response</span><strong>${total ? avg + " ms" : "--"}</strong></div>`;

    if (!total) {
        historyBody.innerHTML = '<tr><td colspan="6">No checks recorded yet. Add a URL on the Dashboard.</td></tr>';
        return;
    }
    historyBody.innerHTML = rows.map(r => `
        <tr>
            <td title="${PW.escapeHtml(r.url)}">${PW.escapeHtml(r.url.replace(/^https?:\/\//, ""))}</td>
            <td><span class="status ${r.status === "Online" ? "online" : "offline"}">${r.status}</span></td>
            <td>${r.statusCode || "--"}</td>
            <td>${r.responseTime != null ? r.responseTime + " ms" : "--"}</td>
            <td>${r.error ? PW.escapeHtml(r.error) : "OK"}</td>
            <td>${PW.formatDateTime(r.checkedAt)}</td>
        </tr>`).join("");
}

monitorFilter.addEventListener("change", loadHistory);
statusFilter.addEventListener("change", loadHistory);
refreshBtn.addEventListener("click", function () { loadMonitors().then(loadHistory); });

PW.requireAuth().then(async function () {
    await loadMonitors();
    await loadHistory();
    setInterval(loadHistory, 30000);
}).catch(function () {});
