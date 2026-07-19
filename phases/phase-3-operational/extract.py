#!/usr/bin/env python3
"""Extract operational master data from the new-backoffice MySQL database.

Credentials come from ENV only (DB_HOST/DB_PORT/DB_USER/DB_PASS/DB_NAME); DB_PASS
is optional (passwordless users allowed). Output is written repo-relative. If the
driver / env / DB are unavailable the script skips cleanly (exit != 0) without
writing — same pattern as phases/phase-4-booking/extract.py.
"""

import json
import os
import sys
import concurrent.futures
from datetime import datetime, date
from decimal import Decimal
from pathlib import Path

try:
    import pymysql
except ImportError:
    print("[phase-3 extract] SKIPPED — pymysql not installed (pip install -r requirements.txt)", file=sys.stderr)
    sys.exit(2)

OUTPUT = Path(__file__).resolve().parent / "output"


def _db_config():
    cfg = {k: os.environ.get(f"DB_{k.upper()}") for k in ("host", "user", "name")}
    missing = [k for k, v in cfg.items() if not v]
    if missing:
        print("[phase-3 extract] SKIPPED — missing env: "
              + ", ".join(f"DB_{k.upper()}" for k in missing), file=sys.stderr)
        sys.exit(2)
    return dict(
        host=cfg["host"], port=int(os.environ.get("DB_PORT", "3306")),
        user=cfg["user"], password=os.environ.get("DB_PASS", "") or "",
        database=cfg["name"], connect_timeout=8,
    )


DB = _db_config()


def conn():
    return pymysql.connect(**DB, cursorclass=pymysql.cursors.DictCursor)


def to_str(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    return v


def serialize(row):
    return {k: to_str(v) for k, v in row.items()}


def completeness(record, key_fields):
    """Score 0-1 based on non-null, non-empty key fields."""
    filled = sum(1 for f in key_fields if record.get(f) not in (None, "", 0))
    return round(filled / len(key_fields), 2)


def detect_duplicates(records, name_field="name"):
    """Return set of names that appear more than once."""
    seen = {}
    dupes = set()
    for r in records:
        n = (r.get(name_field) or "").strip().lower()
        if n:
            seen[n] = seen.get(n, 0) + 1
    return {n for n, c in seen.items() if c > 1}


# ── Entity extractors ────────────────────────────────────────────────────────

def extract_hotels():
    c = conn()
    cur = c.cursor()
    cur.execute("""
        SELECT h.id, h.name, h.short_description AS description,
               h.is_publish AS status, h.rating, h.address,
               h.destination_id, h.vendor_id,
               h.created_at, h.updated_at,
               COUNT(r.id) AS room_count
        FROM hotels h
        LEFT JOIN room_hotels r ON r.hotel_id = h.id AND r.deleted_at IS NULL
        WHERE h.deleted_at IS NULL
        GROUP BY h.id
        ORDER BY h.id
    """)
    rows = [serialize(r) for r in cur.fetchall()]
    c.close()

    key_fields = ["name", "description", "status", "rating", "address", "destination_id"]
    dupes = detect_duplicates(rows)
    result = []
    for r in rows:
        result.append({
            "id": f"hotel_{r['id']}",
            "name": r["name"],
            "description": r["description"],
            "status": "active" if r["status"] else "inactive",
            "rating": r["rating"],
            "address": r["address"],
            "destination_id": r["destination_id"],
            "vendor_id": r["vendor_id"],
            "room_count": r["room_count"],
            "completeness": completeness(r, key_fields),
            "is_duplicate": (r["name"] or "").strip().lower() in dupes,
            "last_updated": (r["updated_at"] or r["created_at"] or "")[:10],
            "created_at": (r["created_at"] or "")[:10],
        })
    return result


def extract_vendors():
    c = conn()
    cur = c.cursor()
    cur.execute("""
        SELECT v.id, v.name, v.phone, v.address,
               vc.name AS category,
               v.created_at, v.updated_at
        FROM vendors v
        LEFT JOIN vendor_categories vc ON vc.id = v.vendor_category_id
        ORDER BY v.id
    """)
    rows = [serialize(r) for r in cur.fetchall()]
    c.close()

    key_fields = ["name", "phone", "address", "category"]
    dupes = detect_duplicates(rows)
    result = []
    for r in rows:
        result.append({
            "id": f"vendor_{r['id']}",
            "name": r["name"],
            "description": r["address"],
            "status": "active",
            "phone": r["phone"],
            "category": r["category"],
            "completeness": completeness(r, key_fields),
            "is_duplicate": (r["name"] or "").strip().lower() in dupes,
            "last_updated": (r["updated_at"] or r["created_at"] or "")[:10],
            "created_at": (r["created_at"] or "")[:10],
        })
    return result


def extract_crews():
    c = conn()
    cur = c.cursor()
    cur.execute("""
        SELECT id, name, code, crew_level, is_driver, is_ijen,
               phone, email, star, rank, rate,
               created_at, updated_at
        FROM guide_drivers
        WHERE deleted_at IS NULL
        ORDER BY id
    """)
    rows = [serialize(r) for r in cur.fetchall()]
    c.close()

    key_fields = ["name", "code", "crew_level", "phone", "email"]
    dupes = detect_duplicates(rows)
    result = []
    for r in rows:
        result.append({
            "id": f"crew_{r['id']}",
            "name": r["name"],
            "description": f"Level: {r['crew_level']}, Rank: {r['rank']}",
            "status": "active",
            "code": r["code"],
            "crew_level": r["crew_level"],
            "is_driver": bool(r["is_driver"]),
            "is_ijen": bool(r["is_ijen"]),
            "phone": r["phone"],
            "email": r["email"],
            "star": r["star"],
            "rank": r["rank"],
            "rate": r["rate"],
            "completeness": completeness(r, key_fields),
            "is_duplicate": (r["name"] or "").strip().lower() in dupes,
            "last_updated": (r["updated_at"] or r["created_at"] or "")[:10],
            "created_at": (r["created_at"] or "")[:10],
        })
    return result


def extract_vehicles():
    c = conn()
    cur = c.cursor()
    cur.execute("""
        SELECT id, name, car_name, car_code, code,
               vendor_id, garage_id, start_pax, end_pax,
               price, price_twt, fuel, color,
               is_publish, created_at, updated_at
        FROM cars
        WHERE deleted_at IS NULL
        ORDER BY id
    """)
    rows = [serialize(r) for r in cur.fetchall()]
    c.close()

    key_fields = ["name", "car_code", "vendor_id", "start_pax", "end_pax", "price"]
    dupes = detect_duplicates(rows)
    result = []
    for r in rows:
        result.append({
            "id": f"vehicle_{r['id']}",
            "name": r["car_name"] or r["name"],
            "description": f"Pax: {r['start_pax']}-{r['end_pax']}, Fuel: {r['fuel']}",
            "status": "active" if r["is_publish"] else "inactive",
            "code": r["car_code"] or r["code"],
            "vendor_id": r["vendor_id"],
            "garage_id": r["garage_id"],
            "capacity": {"min": r["start_pax"], "max": r["end_pax"]},
            "price": r["price"],
            "price_twt": r["price_twt"],
            "fuel": r["fuel"],
            "color": r["color"],
            "completeness": completeness(r, key_fields),
            "is_duplicate": (r["car_name"] or r["name"] or "").strip().lower() in dupes,
            "last_updated": (r["updated_at"] or r["created_at"] or "")[:10],
            "created_at": (r["created_at"] or "")[:10],
        })
    return result


def extract_destinations():
    c = conn()
    cur = c.cursor()
    cur.execute("""
        SELECT id, name, destination_code, overview AS description,
               difficulty, route_type, length, elevation_gain,
               lat, `long` AS lng, is_publish,
               created_at, updated_at
        FROM destinations
        WHERE deleted_at IS NULL
        ORDER BY id
    """)
    rows = [serialize(r) for r in cur.fetchall()]
    c.close()

    key_fields = ["name", "description", "difficulty", "route_type", "lat", "lng"]
    dupes = detect_duplicates(rows)
    result = []
    for r in rows:
        result.append({
            "id": f"destination_{r['id']}",
            "name": r["name"],
            "description": r["description"],
            "status": "active" if r["is_publish"] else "inactive",
            "code": r["destination_code"],
            "difficulty": r["difficulty"],
            "route_type": r["route_type"],
            "length_km": r["length"],
            "elevation_gain": r["elevation_gain"],
            "coordinates": {"lat": r["lat"], "lng": r["lng"]},
            "completeness": completeness(r, key_fields),
            "is_duplicate": (r["name"] or "").strip().lower() in dupes,
            "last_updated": (r["updated_at"] or r["created_at"] or "")[:10],
            "created_at": (r["created_at"] or "")[:10],
        })
    return result


def extract_activities():
    c = conn()
    cur = c.cursor()
    cur.execute("""
        SELECT a.id, a.name, a.notes AS description,
               a.activity_code, a.destination_id, a.hotel_id,
               ac.name AS category,
               a.created_at, a.updated_at
        FROM activities a
        LEFT JOIN activity_categories ac ON ac.id = a.activity_category_id
        ORDER BY a.id
    """)
    rows = [serialize(r) for r in cur.fetchall()]
    c.close()

    key_fields = ["name", "description", "destination_id", "category"]
    dupes = detect_duplicates(rows)
    result = []
    for r in rows:
        result.append({
            "id": f"activity_{r['id']}",
            "name": r["name"],
            "description": r["description"],
            "status": "active",
            "code": r["activity_code"],
            "destination_id": r["destination_id"],
            "hotel_id": r["hotel_id"],
            "category": r["category"],
            "completeness": completeness(r, key_fields),
            "is_duplicate": (r["name"] or "").strip().lower() in dupes,
            "last_updated": (r["updated_at"] or r["created_at"] or "")[:10],
            "created_at": (r["created_at"] or "")[:10],
        })
    return result


# ── Run all in parallel ──────────────────────────────────────────────────────

EXTRACTORS = {
    "hotels": extract_hotels,
    "vendors": extract_vendors,
    "crews": extract_crews,
    "vehicles": extract_vehicles,
    "destinations": extract_destinations,
    "activities": extract_activities,
}

# Preflight: fail fast & clean if the DB isn't reachable — don't write partial output.
try:
    conn().close()
except Exception as e:  # noqa: BLE001
    print(f"[phase-3 extract] SKIPPED — mysql unreachable: {e}", file=sys.stderr)
    sys.exit(2)

OUTPUT.mkdir(parents=True, exist_ok=True)
results = {}
errors = {}

with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    futures = {pool.submit(fn): name for name, fn in EXTRACTORS.items()}
    for future in concurrent.futures.as_completed(futures):
        name = futures[future]
        try:
            results[name] = future.result()
            print(f"  {name}: {len(results[name])} records extracted")
        except Exception as e:
            errors[name] = str(e)
            print(f"  {name}: ERROR - {e}")

# Write output files
for name, data in results.items():
    path = f"{OUTPUT}/{name}.json"
    meta = {
        "entity": name,
        "count": len(data),
        "extracted_at": datetime.now().isoformat(),
        "duplicates": sum(1 for r in data if r.get("is_duplicate")),
        "avg_completeness": round(sum(r.get("completeness", 0) for r in data) / len(data), 3) if data else 0,
        "records": data,
    }
    with open(path, "w") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    print(f"  Saved {path} (avg completeness: {meta['avg_completeness']})")

if errors:
    print(f"\nErrors: {errors}")
else:
    print("\nAll entities extracted successfully.")
