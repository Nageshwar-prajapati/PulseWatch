// The app must be served by app.py; opening the HTML files directly cannot reach the backend.
if (location.protocol === "file:") {
    document.addEventListener("DOMContentLoaded", function () {
        document.body.innerHTML = '<div style="max-width:640px;margin:80px auto;padding:30px;font-family:Arial,sans-serif;background:#fff;border:1px solid #c8dff3;border-radius:12px;line-height:1.6">' +
            '<h2 style="margin-bottom:12px">PulseWatch server is not running</h2>' +
            '<p>Do not open the HTML files directly. Extract the zip, then:</p>' +
            '<ol style="margin:12px 0 12px 22px"><li><b>Windows:</b> double-click <code>start.bat</code> in the <code>pulsewatch</code> folder</li>' +
            '<li><b>Mac/Linux:</b> run <code>./start.sh</code></li></ol>' +
            '<p>Then open <a href="http://localhost:5000">http://localhost:5000</a></p></div>';
    });
}

// Shared helpers: API calls, auth guard, navbar (login/logout) and alert bell.
const PW = (function () {
    async function api(path, options) {
        const opts = Object.assign({ headers: { "Content-Type": "application/json" }, credentials: "same-origin" }, options || {});
        if (opts.body && typeof opts.body !== "string") opts.body = JSON.stringify(opts.body);
        const res = await fetch(path, opts);
        let data = {};
        try { data = await res.json(); } catch (e) { /* empty body */ }
        if (res.status === 401 && !path.startsWith("/api/login") && !path.startsWith("/api/signup")) {
            goToLogin();
            throw new Error(data.error || "Please log in first.");
        }
        if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
        return data;
    }

    function goToLogin() {
        const next = encodeURIComponent(location.pathname.replace(/^\//, "") || "index.html");
        location.href = "login.html?next=" + next;
    }

    function formatDateTime(iso) {
        if (!iso) return "--";
        const d = new Date(iso);
        const pad = n => String(n).padStart(2, "0");
        let h = d.getHours();
        const ampm = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(h)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ampm}`;
    }

    function formatTime(iso) {
        if (!iso) return "--";
        return formatDateTime(iso).split(" ").slice(1).join(" ");
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    function toast(message, type) {
        const el = document.createElement("div");
        el.className = "pw-toast " + (type || "info");
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(() => el.classList.add("show"), 10);
        setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 3500);
    }

    let currentUser = null;

    async function setupNav() {
        const data = await api("/api/me");
        currentUser = data.user;
        setupProfileMenu(currentUser);
        if (currentUser) setupBell();
        return currentUser;
    }

    function setupProfileMenu(user) {
        const link = document.getElementById("profileLink");
        if (!link) return;
        const wrap = link.parentNode;
        const menu = document.createElement("div");
        menu.className = "pw-menu";
        if (user) {
            menu.innerHTML = `
                <div class="pw-menu-head">
                    <i class="fa-solid fa-circle-user"></i>
                    <div><strong>${escapeHtml(user.username)}</strong><small>${escapeHtml(user.email || "No email added")}</small></div>
                </div>
                <a href="dashboard.html"><i class="fa-solid fa-gauge"></i> Dashboard</a>
                <a href="history.html"><i class="fa-solid fa-clock-rotate-left"></i> History</a>
                <a href="#" class="pw-logout"><i class="fa-solid fa-right-from-bracket"></i> Logout</a>`;
            menu.querySelector(".pw-logout").addEventListener("click", async function (e) {
                e.preventDefault();
                await api("/api/logout", { method: "POST" });
                location.href = "login.html";
            });
        } else {
            menu.innerHTML = `
                <div class="pw-menu-head">
                    <i class="fa-solid fa-circle-user"></i>
                    <div><strong>Guest</strong><small>You are not logged in</small></div>
                </div>
                <a href="login.html"><i class="fa-solid fa-right-to-bracket"></i> Login</a>
                <a href="login.html?mode=signup"><i class="fa-solid fa-user-plus"></i> Sign Up</a>`;
        }
        wrap.appendChild(menu);
        link.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            menu.classList.toggle("open");
        });
        document.addEventListener("click", function (e) {
            if (!wrap.contains(e.target)) menu.classList.remove("open");
        });
    }

    async function clearAlerts() {
        if (!confirm("Clear all notifications?")) return;
        try {
            await api("/api/alerts", { method: "DELETE" });
            toast("Notifications cleared", "success");
        } catch (e) {
            toast(e.message, "error");
        }
        PW.refreshAlerts();
    }

    async function requireAuth() {
        const user = await setupNav();
        if (!user) { goToLogin(); throw new Error("not logged in"); }
        return user;
    }

    let lastAlertId = null;

    function setupBell() {
        const bell = document.querySelector(".nav-right .notification");
        if (!bell) return;
        const wrap = document.createElement("div");
        wrap.className = "pw-bell";
        bell.parentNode.insertBefore(wrap, bell);
        wrap.appendChild(bell);
        const badge = document.createElement("span");
        badge.className = "pw-badge";
        wrap.appendChild(badge);
        const panel = document.createElement("div");
        panel.className = "pw-panel";
        wrap.appendChild(panel);

        bell.addEventListener("click", async function (e) {
            e.stopPropagation();
            panel.classList.toggle("open");
            if (panel.classList.contains("open")) {
                await api("/api/alerts/read", { method: "POST" });
                badge.style.display = "none";
            }
        });
        document.addEventListener("click", e => { if (!wrap.contains(e.target)) panel.classList.remove("open"); });
        panel.addEventListener("click", async function (e) {
            if (e.target.closest(".pw-clear")) {
                e.stopPropagation();
                await clearAlerts();
            }
        });

        async function refresh() {
            try {
                const data = await api("/api/alerts");
                badge.textContent = data.unread;
                badge.style.display = data.unread > 0 ? "flex" : "none";
                panel.innerHTML = '<div class="pw-panel-head"><h4>Alerts</h4>' + (data.alerts.length ? '<button type="button" class="pw-clear">Clear all</button>' : "") + "</div>" + (data.alerts.length === 0
                    ? '<p class="pw-empty">No alerts yet</p>'
                    : data.alerts.map(a => `<div class="pw-alert ${a.kind}"><strong>${a.kind === "down" ? "DOWN" : "UP"}</strong> ${escapeHtml(a.message)}<small>${formatDateTime(a.createdAt)}</small></div>`).join(""));
                if (data.alerts.length) {
                    const newest = data.alerts[0];
                    if (lastAlertId !== null && newest.id > lastAlertId && !newest.read) {
                        toast(newest.message, newest.kind === "down" ? "error" : "success");
                        if ("Notification" in window && Notification.permission === "granted") {
                            new Notification("PulseWatch", { body: newest.message });
                        }
                    }
                    lastAlertId = newest.id;
                } else {
                    lastAlertId = 0;
                }
                document.dispatchEvent(new CustomEvent("pw:alerts", { detail: data }));
            } catch (e) { /* ignore */ }
        }
        if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
        refresh();
        setInterval(refresh, 15000);
        PW.refreshAlerts = refresh;
    }

    return { api, requireAuth, clearAlerts, setupNav, formatDateTime, formatTime, escapeHtml, toast, refreshAlerts: function () {} };
})();
