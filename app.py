import math
import os
import sqlite3
from functools import wraps

from flask import (Flask, g, jsonify, redirect, render_template, request,
                   session, url_for)

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "change-this-secret")
ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASS = os.environ.get("ADMIN_PASS", "admin123")
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "jobs.db")


# ---------- database ----------
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript("""
        CREATE TABLE IF NOT EXISTS places (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            apply_link TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
    """)
    db.commit()
    db.close()


def haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("is_admin"):
            if request.path.startswith("/admin/api/"):
                return jsonify(error="Not authorised"), 401
            return redirect(url_for("login"))
        return fn(*args, **kwargs)
    return wrapper


# ---------- public pages & API ----------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/places")
def nearby_places():
    try:
        lat = float(request.args["lat"])
        lng = float(request.args["lng"])
        radius = float(request.args.get("radius_km", 10))
    except (KeyError, ValueError):
        return jsonify(error="lat and lng are required numbers"), 400

    rows = get_db().execute("""
        SELECT p.id, p.name, p.lat, p.lng, COUNT(j.id) AS job_count
        FROM places p JOIN jobs j ON j.place_id = p.id
        GROUP BY p.id
    """).fetchall()

    out = []
    for r in rows:
        d = haversine_km(lat, lng, r["lat"], r["lng"])
        if d <= radius:
            out.append({**dict(r), "distance_km": round(d, 2)})
    out.sort(key=lambda x: x["distance_km"])
    return jsonify(out)


@app.route("/api/places/<int:place_id>/jobs")
def place_jobs(place_id):
    db = get_db()
    place = db.execute("SELECT * FROM places WHERE id = ?", (place_id,)).fetchone()
    if not place:
        return jsonify(error="Place not found"), 404
    jobs = db.execute(
        "SELECT id, title, description, apply_link, created_at FROM jobs "
        "WHERE place_id = ? ORDER BY created_at DESC", (place_id,)).fetchall()
    return jsonify(place=dict(place), jobs=[dict(j) for j in jobs])


# ---------- admin ----------
@app.route("/admin/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        if (request.form.get("username") == ADMIN_USER
                and request.form.get("password") == ADMIN_PASS):
            session["is_admin"] = True
            return redirect(url_for("admin"))
        error = "Invalid username or password"
    return render_template("login.html", error=error)


@app.route("/admin/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/admin")
@admin_required
def admin():
    return render_template("admin.html")


@app.route("/admin/api/jobs", methods=["GET"])
@admin_required
def admin_list_jobs():
    rows = get_db().execute("""
        SELECT j.id, j.title, j.description, j.apply_link, p.name AS place_name,
               p.lat, p.lng
        FROM jobs j JOIN places p ON p.id = j.place_id
        ORDER BY j.created_at DESC
    """).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/admin/api/jobs", methods=["POST"])
@admin_required
def admin_add_job():
    data = request.get_json(silent=True) or {}
    place_name = (data.get("place_name") or "").strip()
    title = (data.get("title") or "").strip()
    try:
        lat = float(data.get("lat"))
        lng = float(data.get("lng"))
    except (TypeError, ValueError):
        return jsonify(error="Select a place on the map first"), 400
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return jsonify(error="Invalid coordinates"), 400
    if not place_name or not title:
        return jsonify(error="Place name and job title are required"), 400

    db = get_db()
    # reuse the place if same name already exists within ~100 m
    place = None
    for p in db.execute("SELECT * FROM places WHERE lower(name) = lower(?)", (place_name,)):
        if haversine_km(lat, lng, p["lat"], p["lng"]) < 0.1:
            place = p
            break
    if place:
        place_id = place["id"]
    else:
        place_id = db.execute("INSERT INTO places (name, lat, lng) VALUES (?, ?, ?)",
                              (place_name, lat, lng)).lastrowid

    db.execute(
        "INSERT INTO jobs (place_id, title, description, apply_link) VALUES (?, ?, ?, ?)",
        (place_id, title, (data.get("description") or "").strip(),
         (data.get("apply_link") or "").strip()))
    db.commit()
    return jsonify(ok=True), 201


@app.route("/admin/api/jobs/<int:job_id>", methods=["DELETE"])
@admin_required
def admin_delete_job(job_id):
    db = get_db()
    db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
    db.execute("DELETE FROM places WHERE id NOT IN (SELECT DISTINCT place_id FROM jobs)")
    db.commit()
    return jsonify(ok=True)


init_db()

if __name__ == "__main__":
    app.run(debug=True)
