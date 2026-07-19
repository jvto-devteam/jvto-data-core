#!/usr/bin/env python3
"""
Phase 4 (v2, remediated) — booking aggregates extractor.

Faithful port of new-backoffice's own export pipeline
`app/Http/Controllers/ExportData/ExportDataBookings.php::bookings()` (lines 33-107),
which is the canonical, working join over bookings + booking_details + the derived
order-channel + payment state. This corrects the three Phase 7 gaps at the SOURCE
(not via heuristics):

  * package_id  -> booking_details.package_id  (bookings has NO package_id column)
  * channel     -> derived from agent_id / booking_category_id
                   (bookings has NO order_channel_id column)
                   agent_id==1 -> TWT ; booking_category_id==3 -> KLOOK ; else JVTO
  * payment     -> derived from bookings.payment / bookings.balance
                   payment==0 -> pending ; balance<=0 -> paid ; else partial

Real column names differ from the old snapshot and are mapped back to the EXISTING
output schema so phase-6-mcp (mcp-server.ts / test-tools.mjs) keeps working:
  grand_total->gross_revenue, expense_internal_total->cost_total,
  total_pax->pax_count, meeting_point->pickup_city,
  travel_date_start->travel_month/year, status->operational_status.

SAFETY
  * Credentials come from ENV ONLY (DB_HOST/DB_PORT/DB_USER/DB_PASS/DB_NAME).
    Nothing is hardcoded and nothing is committed.
  * PII-safe: booking id is MD5-hashed; no names/emails/phones/payment accounts.
  * Read-only SELECT. If the driver is missing, env is unset, or the DB is
    unreachable, it prints a clear notice and exits NON-ZERO without writing
    anything (graceful fallback, same spirit as phase-1/phase-3).

USAGE
  DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=... DB_PASS=... DB_NAME=jvto \
    python3 phases/phase-4-booking/extract.py
"""
import hashlib
import json
import os
import sys
from datetime import datetime, date
from decimal import Decimal
from pathlib import Path

OUTPUT = Path(__file__).resolve().parent / "output" / "booking-aggregates.json"
# Catalog used by phase-6-mcp: booking_details.package_id is new-backoffice's raw
# packages.id FK, but get_package()/check_conflicts resolve the catalog `packageId`
# string (e.g. "package-SUB-4D3N-001"). packages.json carries BOTH the numeric id
# and that string, so we translate FK -> catalog packageId at write time.
PACKAGES = Path(__file__).resolve().parents[1] / "phase-1-packages" / "output" / "packages.json"


def load_package_id_map() -> dict:
    """{ new-backoffice packages.id (int) -> catalog packageId (str) } from packages.json."""
    if not PACKAGES.exists():
        return {}
    try:
        data = json.loads(PACKAGES.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {}
    id_map = {}
    for p in data.get("packages", []):
        pkgid = p.get("packageId") or (p.get("product") or {}).get("packageId")
        for raw in (p.get("id"), (p.get("product") or {}).get("id")):
            if raw is not None and pkgid:
                try:
                    id_map[int(raw)] = pkgid
                except (TypeError, ValueError):
                    pass
    return id_map

# 12-month window, mirroring the original phase-4 query.
SQL = """
SELECT
    b.id,
    b.booking_code,
    b.agent_id,
    b.booking_category_id,
    b.channel_tag,
    b.grand_total,
    b.expense_internal_total,
    b.total_pax,
    b.meeting_point,
    b.travel_date_start,
    b.travel_date_end,
    b.status,
    b.payment,
    b.balance,
    b.created_at,
    bd.package_id AS bd_package_id
FROM bookings b
LEFT JOIN booking_details bd
       ON bd.id = (SELECT MIN(bd2.id) FROM booking_details bd2 WHERE bd2.booking_id = b.id)
WHERE b.deleted_at IS NULL
  AND b.status = 'booked'
  AND b.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
ORDER BY b.id ASC
"""


def fail(msg: str) -> int:
    """Graceful fallback: report and exit non-zero WITHOUT writing output."""
    print(f"[phase-4 extract] SKIPPED — {msg}", file=sys.stderr)
    print("[phase-4 extract] no output written; existing snapshot left untouched.",
          file=sys.stderr)
    return 2


def num(v):
    if isinstance(v, Decimal):
        return float(v)
    return v


def derive_channel(agent_id, booking_category_id):
    # Mirrors ExportDataBookings.php:60 order-channel derivation.
    if agent_id == 1:
        return "TWT"
    if booking_category_id == 3:
        return "KLOOK"
    return "JVTO"


def derive_payment_status(payment, balance):
    # Mirrors the app's canonical expression (FinanceController.php:281 et al.),
    # normalized to the snapshot vocabulary paid/partial/pending.
    payment = payment or 0
    balance = 0 if balance is None else balance
    if payment == 0:
        return "pending"
    if balance <= 0:
        return "paid"
    return "partial"


def build_record(r: dict, id_map: dict) -> dict:
    gross = num(r.get("grand_total")) or 0
    cost = num(r.get("expense_internal_total")) or 0
    tds = r.get("travel_date_start")
    tmonth = tds.month if isinstance(tds, (datetime, date)) else None
    tyear = tds.year if isinstance(tds, (datetime, date)) else None
    seed = str(r.get("booking_code") or r.get("id") or "")
    created = r.get("created_at")
    raw_fk = r.get("bd_package_id")
    try:
        catalog_pkgid = id_map.get(int(raw_fk)) if raw_fk is not None else None
    except (TypeError, ValueError):
        catalog_pkgid = None
    return {
        "booking_id_hash": hashlib.md5(seed.encode("utf-8")).hexdigest(),
        "channel": derive_channel(r.get("agent_id"), r.get("booking_category_id")),
        "channel_tag": r.get("channel_tag"),  # additive OTA override (klook/gyg/viator)
        # package_id = catalog packageId (resolvable via get_package); None if the
        # booking references a package outside the 16-package published catalog.
        "package_id": catalog_pkgid,
        "package_fk": raw_fk,  # raw new-backoffice packages.id, for traceability
        "travel_month": tmonth,
        "travel_year": tyear,
        "pax_count": num(r.get("total_pax")),
        "pickup_city": r.get("meeting_point"),
        "dropoff_city": None,
        "gross_revenue": gross,
        "cost_total": cost,
        "profit_estimate": gross - cost,
        "payment_status": derive_payment_status(num(r.get("payment")), num(r.get("balance"))),
        "operational_status": r.get("status"),
        "created_at": created.isoformat() if isinstance(created, (datetime, date)) else created,
    }


def main() -> int:
    try:
        import pymysql  # noqa: WPS433 (optional dependency)
    except ImportError:
        return fail("pymysql not installed (pip install pymysql)")

    # Only host/user/name are required. DB_PASS is optional: a passwordless MySQL
    # user (e.g. the documented local root setup) legitimately has it empty/unset.
    cfg = {k: os.environ.get(f"DB_{k.upper()}") for k in ("host", "user", "name")}
    missing = [k for k, v in cfg.items() if not v]
    if missing:
        return fail("missing env vars: " + ", ".join(f"DB_{k.upper()}" for k in missing))
    password = os.environ.get("DB_PASS", "") or ""
    port = int(os.environ.get("DB_PORT", "3306"))

    try:
        conn = pymysql.connect(
            host=cfg["host"], port=port, user=cfg["user"],
            password=password, database=cfg["name"],
            connect_timeout=8, cursorclass=pymysql.cursors.DictCursor,
        )
    except Exception as e:  # noqa: BLE001 — any connection error => graceful skip
        return fail(f"mysql unreachable: {e}")

    try:
        with conn.cursor() as cur:
            cur.execute(SQL)
            rows = cur.fetchall()
    finally:
        conn.close()

    id_map = load_package_id_map()
    records = [build_record(r, id_map) for r in rows]
    total = len(records)
    total_revenue = sum(r["gross_revenue"] for r in records)
    total_profit = sum(r["profit_estimate"] for r in records)
    pax_vals = [r["pax_count"] for r in records if r["pax_count"]]
    avg_pax = round(sum(pax_vals) / len(pax_vals), 2) if pax_vals else 0

    doc = {
        "booking_aggregates": records,
        "analytics": {
            "total_bookings": total,
            "total_revenue": total_revenue,
            "total_profit": total_profit,
            "average_pax": avg_pax,
        },
        "_remediation": {
            "phase": "phase-4-booking (v2, remediated)",
            "generated_by": "extract.py",
            "source": "new-backoffice ExportDataBookings::bookings()",
            "note": ("package_id/channel/payment_status now derived at source per the "
                     "verified new-backoffice schema; revenue is grand_total-based and "
                     "may legitimately differ from the older snapshot."),
        },
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def pct(pred):
        return round(100 * sum(1 for r in records if pred(r)) / total, 1) if total else 0.0

    print(f"[phase-4 extract] wrote {total} bookings -> {OUTPUT}")
    print(f"  package_id resolved to catalog : {pct(lambda r: r['package_id'] is not None)}%  "
          f"(FK present: {pct(lambda r: r['package_fk'] is not None)}%; "
          f"catalog map size: {len(id_map)})")
    print(f"  channel resolved  : {pct(lambda r: r['channel'] != 'unknown')}%  "
          f"(distinct: {sorted({r['channel'] for r in records})})")
    print(f"  payment variety   : {sorted({r['payment_status'] for r in records})}")
    print(f"  total_revenue_idr : {total_revenue:,.0f}  (grand_total-based)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
