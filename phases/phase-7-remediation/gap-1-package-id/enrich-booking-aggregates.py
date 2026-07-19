#!/usr/bin/env python3
"""
Phase 7 / Gap 1 — best-effort package_id inference for booking aggregates.

Context
-------
`booking-aggregates.json` has `package_id = null` on all 546 rows: bookings in
new-backoffice carry no structured FK to the package catalogue. The source-level
root cause (free-text package selection vs. a junction table we can't see) can
only be *confirmed* against the live `new-backoffice` MySQL — which is
unreachable from the extraction environment (egress is web-ports-only). See
gap-1 `output/diagnosis.md`.

This script implements the doc-sanctioned Branch-A short-term fallback: infer the
most likely package per booking from indirect, PII-free signals already present
in the snapshot, and label every guess with an explicit confidence. It is
deterministic (no DB, no network, no randomness) and re-runnable.

Guarantees
----------
- ADDITIVE only. Original `package_id` stays null (honest provenance), and every
  existing field/type is preserved. New per-row keys:
    package_id_inferred, package_id_inference_confidence, package_id_inference_basis
- Revenue-invariant. `gross_revenue` is never touched; the script asserts
  `analytics.total_revenue` is byte-identical before/after (gap-4 guardrail #3).
- No PII read or written (operates purely on the already-anonymised aggregate).

Heuristic
---------
per_person = gross_revenue / pax_count. Candidate packages are those whose origin
city matches the booking's pickup/dropoff city AND whose [lowPrice, highPrice]
band contains per_person. Best guess = candidate minimising distance to its
nearest published tier price. Confidence:
  high   — origin known, exactly 1 candidate, per_person within 3% of a real tier
  medium — origin known, 2-4 candidates
  low    — origin unknown (price-only), or >4 candidates, or only a lenient band match
  none   — pax_count or gross_revenue missing/zero, or no candidate at all
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # .../jvto-data-core
PACKAGES = ROOT / "phases/phase-1-packages/output/packages.json"
BOOKINGS = ROOT / "phases/phase-4-booking/output/booking-aggregates.json"

TIER_TOL = 0.03      # within 3% of a real tier => strong price agreement
BAND_LOW = 0.90      # lenient lower bound (discounts)
BAND_HIGH = 1.15     # lenient upper bound (add-ons inflate per-person)


def norm_origin(*cities: str) -> str | None:
    """Map free-text pickup/dropoff city to a catalogue origin (Surabaya/Bali)."""
    blob = " ".join(c for c in cities if c).lower()
    if not blob.strip():
        return None
    if "bali" in blob or "denpasar" in blob or "kuta" in blob or "ubud" in blob:
        return "Bali"
    if ("surabaya" in blob or "juanda" in blob or "sidoarjo" in blob
            or "gresik" in blob or " sub" in blob):
        return "Surabaya"
    return None  # unknown / other -> price-only path


def load_packages() -> list[dict]:
    data = json.loads(PACKAGES.read_text(encoding="utf-8"))
    profiles = []
    for p in data.get("packages", []):
        prod = p.get("product", {}) or {}
        offers = prod.get("offers", {}) or {}
        agg = offers.get("aggregateOffer", {}) or {}
        tiers = [t.get("pricePerPerson") for t in (offers.get("tiers") or [])
                 if isinstance(t.get("pricePerPerson"), (int, float))]
        low = agg.get("lowPrice")
        high = agg.get("highPrice")
        if low is None and tiers:
            low = min(tiers)
        if high is None and tiers:
            high = max(tiers)
        pid = p.get("packageId") or p.get("id")
        if pid is None or low is None or high is None:
            continue
        profiles.append({
            "id": pid,
            "origin": prod.get("originCity"),
            "low": float(low),
            "high": float(high),
            "tiers": [float(t) for t in tiers] or [float(low), float(high)],
            "width": float(high) - float(low),
        })
    return profiles


def nearest_tier_dist(pp: float, tiers: list[float]) -> float:
    return min(abs(pp - t) for t in tiers)


def infer(rec: dict, packages: list[dict]) -> tuple[str | None, str, str]:
    gr = rec.get("gross_revenue")
    px = rec.get("pax_count")
    if not gr or not px:
        return None, "none", "no per-person price (missing pax_count or gross_revenue)"
    pp = gr / px
    origin = norm_origin(rec.get("pickup_city"), rec.get("dropoff_city"))

    pool = [p for p in packages if origin is None or p["origin"] == origin]
    in_band = [p for p in pool if p["low"] <= pp <= p["high"]]
    lenient = [p for p in pool if p["low"] * BAND_LOW <= pp <= p["high"] * BAND_HIGH]
    candidates = in_band or lenient
    if not candidates:
        return None, "none", f"per_person={pp:,.0f} matches no package band (origin={origin or 'unknown'})"

    best = min(candidates, key=lambda p: (nearest_tier_dist(pp, p["tiers"]), p["width"]))
    tier_gap = nearest_tier_dist(pp, best["tiers"])
    strong_price = tier_gap <= TIER_TOL * pp

    if origin and len(in_band) == 1 and strong_price:
        conf = "high"
    elif origin and 1 <= len(in_band) <= 4:
        conf = "medium"
    else:
        conf = "low"

    basis = (f"per_person={pp:,.0f}; origin={origin or 'unknown'}; "
             f"candidates={len(candidates)}; nearest_tier_gap={tier_gap:,.0f}")
    return best["id"], conf, basis


def main() -> int:
    packages = load_packages()
    doc = json.loads(BOOKINGS.read_text(encoding="utf-8"))
    recs = doc["booking_aggregates"]
    revenue_before = doc["analytics"]["total_revenue"]

    counts = {"high": 0, "medium": 0, "low": 0, "none": 0}
    for r in recs:
        pid, conf, basis = infer(r, packages)
        r["package_id_inferred"] = pid
        r["package_id_inference_confidence"] = conf
        r["package_id_inference_basis"] = basis
        counts[conf] += 1

    revenue_after = sum((r.get("gross_revenue") or 0) for r in recs)
    assert doc["analytics"]["total_revenue"] == revenue_before, "analytics.total_revenue mutated!"
    assert abs(revenue_after - revenue_before) < 1e-6, (
        f"row-level revenue drifted: {revenue_after} != {revenue_before}")

    total = len(recs)
    matched = counts["high"] + counts["medium"] + counts["low"]
    doc["_remediation"] = {
        "phase": "phase-7-remediation/gap-1-package-id",
        "generated_by": "enrich-booking-aggregates.py",
        "note": ("package_id_inferred is a heuristic best-effort backfill, NOT a "
                 "confirmed source value. Original package_id remains null. Root "
                 "cause requires live new-backoffice MySQL confirmation "
                 "(see gap-1 diagnosis.md)."),
        "package_id_inference_coverage": {
            "total_bookings": total,
            "inferred_any": matched,
            "inferred_pct": round(100 * matched / total, 1),
            "by_confidence": counts,
        },
        "revenue_invariant_idr": revenue_before,
    }

    BOOKINGS.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")

    print("package_id inference coverage:")
    for k in ("high", "medium", "low", "none"):
        print(f"  {k:6}: {counts[k]:4}  ({100*counts[k]/total:.1f}%)")
    print(f"  inferred (any confidence): {matched}/{total} = {100*matched/total:.1f}%")
    print(f"revenue invariant: {revenue_before:,.0f} IDR (unchanged)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
