import os
import sqlite3
import threading
import time
from datetime import datetime, timezone
from functools import wraps
from urllib.parse import urlparse

import requests
from flask import Flask, g, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
DB_PATH = os.environ.get("PULSEWATCH_DB", os.path.join(BASE_DIR, "pulsewatch.db"))
CHECK_INTERVAL = int(os.environ.get("PULSEWATCH_INTERVAL", "60"))
REQUEST_TIMEOUT = 10

app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get("PULSEWATCH_SECRET", "change-this-secret-key")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS monitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Checking...',
    status_code INTEGER,
    response_time INTEGER,
    last_checked TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, url)
);
CREATE TABLE IF NOT EXISTS checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    url TEXT,
    status TEXT NOT NULL,
    status_code INTEGER,
    response_time INTEGER,
    error TEXT,
    checked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    monitor_id INTEGER REFERENCES monitors(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    message TEXT NOT NULL,
    kind TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
"""


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_db():
    if "db" not in g:
        g.db = connect()
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    with connect() as conn:
        conn.executescript(SCHEMA)
        # Older databases: keep the URL that was actually checked on each history row.
        columns = [r["name"] for r in conn.execute("PRAGMA table_info(checks)")]
        if "url" not in columns:
            conn.execute("ALTER TABLE checks ADD COLUMN url TEXT")
            conn.execute("UPDATE checks SET url=(SELECT url FROM monitors WHERE monitors.id=checks.monitor_id)")


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:
            return jsonify(error="Please log in first."), 401
        return view(*args, **kwargs)

    return wrapper


def normalize_url(raw):
    url = (raw or "").strip()
    if not url:
        raise ValueError("Please enter a URL.")
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    parsed = urlparse(url)
    host = parsed.hostname or ""
    if parsed.scheme not in ("http", "https") or not host or ("." not in host and host != "localhost"):
        raise ValueError("Please enter a valid URL, e.g. https://example.com")
    return url


# The server answered but refused an automated request (login wall, bot protection,
# rate limit). The site itself is up, so these count as Online.
REACHABLE_CODES = {401, 403, 405, 406, 407, 429}


def classify(code, headers):
    if code < 400:
        return "Online", None
    if headers.get("cf-mitigated") or code in REACHABLE_CODES:
        return "Online", f"HTTP {code} - reachable (blocks automated requests)"
    return "Offline", f"HTTP {code}"


def probe(url):
    """Send a request to the site and decide whether it is up or down."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 PulseWatch/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    start = time.perf_counter()
    try:
        resp = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT,
                            allow_redirects=True, stream=True)
        elapsed = int((time.perf_counter() - start) * 1000)
        code = resp.status_code
        status, error = classify(code, resp.headers)
        resp.close()
        return status, code, elapsed, error
    except requests.exceptions.Timeout:
        return "Offline", None, int((time.perf_counter() - start) * 1000), "Request timed out"
    except requests.exceptions.SSLError:
        return "Offline", None, int((time.perf_counter() - start) * 1000), "SSL certificate error"
    except requests.exceptions.ConnectionError:
        return "Offline", None, int((time.perf_counter() - start) * 1000), "Could not connect (DNS / refused)"
    except requests.exceptions.RequestException as exc:
        return "Offline", None, int((time.perf_counter() - start) * 1000), str(exc)[:200]


def run_check(conn, monitor):
    status, code, elapsed, error = probe(monitor["url"])
    ts = now_iso()
    previous = monitor["status"]
    conn.execute(
        "UPDATE monitors SET status=?, status_code=?, response_time=?, last_checked=? WHERE id=?",
        (status, code, elapsed, ts, monitor["id"]),
    )
    conn.execute(
        "INSERT INTO checks (monitor_id, url, status, status_code, response_time, error, checked_at) VALUES (?,?,?,?,?,?,?)",
        (monitor["id"], monitor["url"], status, code, elapsed, error, ts),
    )
    if status != previous and (status == "Offline" or previous == "Offline"):
        if status == "Offline":
            msg = f"{monitor['url']} is DOWN" + (f" ({error})" if error else "")
            kind = "down"
        else:
            msg = f"{monitor['url']} is back UP ({elapsed} ms)"
            kind = "up"
        conn.execute(
            "INSERT INTO alerts (user_id, monitor_id, url, message, kind, created_at) VALUES (?,?,?,?,?,?)",
            (monitor["user_id"], monitor["id"], monitor["url"], msg, kind, ts),
        )
    conn.commit()
    return conn.execute("SELECT * FROM monitors WHERE id=?", (monitor["id"],)).fetchone()


def monitor_dict(row):
    return {
        "id": row["id"],
        "url": row["url"],
        "status": row["status"],
        "statusCode": row["status_code"],
        "responseTime": row["response_time"],
        "lastChecked": row["last_checked"],
        "createdAt": row["created_at"],
    }


def get_owned_monitor(monitor_id):
    row = get_db().execute(
        "SELECT * FROM monitors WHERE id=? AND user_id=?", (monitor_id, session["user_id"])
    ).fetchone()
    return row


# ---------- Auth ----------

@app.post("/api/signup")
def signup():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    email = (data.get("email") or "").strip().lower() or None
    password = data.get("password") or ""
    if len(username) < 3:
        return jsonify(error="Username must be at least 3 characters."), 400
    if len(password) < 6:
        return jsonify(error="Password must be at least 6 characters."), 400
    if email and "@" not in email:
        return jsonify(error="Please enter a valid email."), 400
    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO users (username, email, password_hash, created_at) VALUES (?,?,?,?)",
            (username, email, generate_password_hash(password), now_iso()),
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify(error="That username or email is already registered."), 409
    session.clear()
    session["user_id"] = cur.lastrowid
    session["username"] = username
    session.permanent = bool(data.get("remember"))
    return jsonify(user={"id": cur.lastrowid, "username": username, "email": email}), 201


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    ident = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not ident or not password:
        return jsonify(error="Please enter your username/email and password."), 400
    user = get_db().execute(
        "SELECT * FROM users WHERE username=? OR email=?", (ident, ident.lower())
    ).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify(error="Invalid username/email or password."), 401
    session.clear()
    session["user_id"] = user["id"]
    session["username"] = user["username"]
    session.permanent = bool(data.get("remember"))
    return jsonify(user={"id": user["id"], "username": user["username"], "email": user["email"]})


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/me")
def me():
    if "user_id" not in session:
        return jsonify(user=None)
    user = get_db().execute("SELECT id, username, email FROM users WHERE id=?", (session["user_id"],)).fetchone()
    if not user:
        session.clear()
        return jsonify(user=None)
    return jsonify(user={"id": user["id"], "username": user["username"], "email": user["email"]})


# ---------- Monitors ----------

@app.get("/api/monitors")
@login_required
def list_monitors():
    rows = get_db().execute(
        "SELECT * FROM monitors WHERE user_id=? ORDER BY id", (session["user_id"],)
    ).fetchall()
    return jsonify(monitors=[monitor_dict(r) for r in rows])


@app.post("/api/monitors")
@login_required
def add_monitor():
    data = request.get_json(silent=True) or {}
    try:
        url = normalize_url(data.get("url"))
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    db = get_db()
    existing = db.execute(
        "SELECT * FROM monitors WHERE user_id=? AND url=?", (session["user_id"], url)
    ).fetchone()
    if existing:
        if data.get("allowExisting"):
            return jsonify(monitor=monitor_dict(run_check(db, existing)))
        return jsonify(error="This URL is already being monitored."), 409
    cur = db.execute(
        "INSERT INTO monitors (user_id, url, created_at) VALUES (?,?,?)",
        (session["user_id"], url, now_iso()),
    )
    db.commit()
    row = db.execute("SELECT * FROM monitors WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(monitor=monitor_dict(run_check(db, row))), 201


@app.put("/api/monitors/<int:monitor_id>")
@login_required
def edit_monitor(monitor_id):
    row = get_owned_monitor(monitor_id)
    if not row:
        return jsonify(error="Monitor not found."), 404
    data = request.get_json(silent=True) or {}
    try:
        url = normalize_url(data.get("url"))
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    db = get_db()
    try:
        db.execute(
            "UPDATE monitors SET url=?, status='Checking...', status_code=NULL, response_time=NULL, last_checked=NULL WHERE id=?",
            (url, monitor_id),
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify(error="This URL is already being monitored."), 409
    row = db.execute("SELECT * FROM monitors WHERE id=?", (monitor_id,)).fetchone()
    return jsonify(monitor=monitor_dict(run_check(db, row)))


@app.delete("/api/monitors/<int:monitor_id>")
@login_required
def delete_monitor(monitor_id):
    if not get_owned_monitor(monitor_id):
        return jsonify(error="Monitor not found."), 404
    db = get_db()
    db.execute("DELETE FROM monitors WHERE id=?", (monitor_id,))
    db.commit()
    return jsonify(ok=True)


@app.post("/api/monitors/<int:monitor_id>/recheck")
@login_required
def recheck_monitor(monitor_id):
    row = get_owned_monitor(monitor_id)
    if not row:
        return jsonify(error="Monitor not found."), 404
    return jsonify(monitor=monitor_dict(run_check(get_db(), row)))


@app.post("/api/monitors/recheck-all")
@login_required
def recheck_all():
    db = get_db()
    rows = db.execute("SELECT * FROM monitors WHERE user_id=?", (session["user_id"],)).fetchall()
    updated = [monitor_dict(run_check(db, r)) for r in rows]
    return jsonify(monitors=updated)


# ---------- History & alerts ----------

@app.get("/api/history")
@login_required
def history():
    limit = min(int(request.args.get("limit", 200)), 1000)
    params = [session["user_id"]]
    sql = (
        "SELECT c.*, COALESCE(c.url, m.url) AS url FROM checks c JOIN monitors m ON m.id=c.monitor_id "
        "WHERE m.user_id=?"
    )
    if request.args.get("monitor"):
        sql += " AND m.id=?"
        params.append(int(request.args["monitor"]))
    if request.args.get("status") in ("Online", "Offline"):
        sql += " AND c.status=?"
        params.append(request.args["status"])
    sql += " ORDER BY c.id DESC LIMIT ?"
    params.append(limit)
    rows = get_db().execute(sql, params).fetchall()
    return jsonify(history=[{
        "id": r["id"], "monitorId": r["monitor_id"], "url": r["url"], "status": r["status"],
        "statusCode": r["status_code"], "responseTime": r["response_time"],
        "error": r["error"], "checkedAt": r["checked_at"],
    } for r in rows])


@app.get("/api/alerts")
@login_required
def alerts():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM alerts WHERE user_id=? ORDER BY id DESC LIMIT 20", (session["user_id"],)
    ).fetchall()
    unread = db.execute(
        "SELECT COUNT(*) FROM alerts WHERE user_id=? AND is_read=0", (session["user_id"],)
    ).fetchone()[0]
    return jsonify(unread=unread, alerts=[{
        "id": r["id"], "url": r["url"], "message": r["message"], "kind": r["kind"],
        "read": bool(r["is_read"]), "createdAt": r["created_at"],
    } for r in rows])


@app.post("/api/alerts/read")
@login_required
def mark_alerts_read():
    db = get_db()
    db.execute("UPDATE alerts SET is_read=1 WHERE user_id=?", (session["user_id"],))
    db.commit()
    return jsonify(ok=True)


@app.delete("/api/alerts")
@login_required
def clear_alerts():
    db = get_db()
    db.execute("DELETE FROM alerts WHERE user_id=?", (session["user_id"],))
    db.commit()
    return jsonify(ok=True)


# ---------- Static frontend ----------

@app.get("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.get("/<path:filename>")
def static_files(filename):
    return send_from_directory(FRONTEND_DIR, filename)


# ---------- Background scheduler ----------

def scheduler_loop():
    while True:
        time.sleep(CHECK_INTERVAL)
        try:
            with connect() as conn:
                for row in conn.execute("SELECT * FROM monitors").fetchall():
                    run_check(conn, row)
        except Exception as exc:  # keep the scheduler alive
            print("Scheduler error:", exc)


def start_scheduler():
    threading.Thread(target=scheduler_loop, daemon=True).start()


init_db()

if __name__ == "__main__":
    start_scheduler()
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
