# Gap 1 — `package_id` NULL in 100% of bookings — Diagnosis

**Date:** 2026-07-19 · **Effort:** high · **Status:** root cause *narrowed*, not
*confirmed* (see environment note).

## Environment note (read first)

Phase 7 is designed to run the diagnostic SQL below against the live
`new-backoffice` MySQL (`jvto`). **That database is unreachable from the
extraction environment:** outbound egress is limited to web ports (80/443), port
3306 times out to every host, no MySQL client/driver is installed, and the HTTPS
proxy will not relay MySQL traffic. Valid credentials to a clone database were
provided out-of-band but are on the same blocked network path.

Consequently, live schema introspection (`SHOW TABLES`, `SHOW COLUMNS`, junction
discovery) **could not be executed here.** This diagnosis is derived from the
committed snapshot `phases/phase-4-booking/output/booking-aggregates.json` (546
rows, snapshot 2026-06-13) and the exact SQL to confirm the branch is provided
for whoever has DB access.

## Evidence reproduced from the snapshot

| Check | Snapshot result |
|---|---|
| total bookings | 546 |
| `package_id` non-null | **0 / 546 (100% null)** |
| distinct `package_id` | 1 (the value `null`) |
| any alternative linkage field in the aggregate output | none present |

This matches the reported current state exactly. Because `package_id` is selected
raw (no JOIN/CASE in the phase-4 query), 100% null means one of two things — and
the snapshot alone cannot distinguish them.

## Diagnostic SQL — run when DB access exists

```sql
-- 1. Is the column genuinely empty, or just empty in the 12-month window?
SELECT COUNT(*) AS total, COUNT(package_id) AS non_null_package_id FROM bookings;

-- 2. Is package info held in another column?
SHOW COLUMNS FROM bookings LIKE '%package%';
SHOW COLUMNS FROM bookings LIKE '%product%';
SHOW COLUMNS FROM bookings LIKE '%tour%';

-- 3. Is there a junction / line-item table?
SHOW TABLES LIKE '%booking%';
SHOW TABLES LIKE '%order_item%';
-- if found: SELECT * FROM <junction> LIMIT 20;

-- 4. Raw sample (NO PII columns)
SELECT booking_id, package_id, order_channel_id, travel_date, pickup_city, created_at
FROM bookings ORDER BY created_at DESC LIMIT 10;
```

**Branch decision:**
- **Branch B (data lives elsewhere)** if #2/#3 surface a populated column/junction
  table → pure extraction fix: add the JOIN in a new phase-4 query, re-run,
  expect ≥90% fill. *This is the preferred outcome; check it first.*
- **Branch A (genuinely empty at source)** if #1 shows `non_null_package_id = 0`
  and #3 finds no junction → not an extraction bug; bookings were created without
  a structured catalogue FK (likely free-text package entry). Fix is the
  best-effort backfill below plus a process recommendation to Sam.

**Snapshot lean:** the aggregate carries no package linkage of any kind and the
field is uniformly null (not a mix), which is *consistent with* Branch A, but
Branch B cannot be excluded without query #3. Treat the backfill below as interim
regardless of branch — it never overwrites the real (null) `package_id`.

## Interim fix applied — heuristic backfill (Branch-A short-term, doc-sanctioned)

Script: [`../enrich-booking-aggregates.py`](../enrich-booking-aggregates.py)
(deterministic, DB-free, PII-free, re-runnable). It adds three **additive** fields
per row and never mutates `package_id`:

- `package_id_inferred` — best-guess catalogue id, or `null`
- `package_id_inference_confidence` — `high` / `medium` / `low` / `none`
- `package_id_inference_basis` — the signals used (per-person price, origin, candidate count, nearest-tier gap)

**Method:** `per_person = gross_revenue / pax_count`, matched against each
package's origin city (`product.originCity`, from `pickup`/`dropoff_city`) and
price band (`product.offers.aggregateOffer.{low,high}Price` + published `tiers`).
Best guess = candidate nearest to a real tier price.

**Coverage (546 bookings):**

| Confidence | Count | Share |
|---|---|---|
| high | 26 | 4.8% |
| medium | 159 | 29.1% |
| low | 229 | 41.9% |
| none | 132 | 24.2% |
| **inferred (any)** | **414** | **75.8%** |

`none` is dominated by rows with `pax_count = 0` or no revenue (can't derive a
per-person price). The low **high**-confidence share is expected and honest: the
16 packages have **heavily overlapping price tiers** (e.g. `3,570,000` appears in
several Surabaya packages), so per-person price rarely resolves to a single
package. **This is precisely why a real source FK — not a heuristic — is needed;
the backfill is a bridge, not a fix.**

## Secondary finding (provenance inconsistency, flag to Sam)

`phase-1-packages/output/packages.json` (16 packages, sourced from the live web
API `.../api/packages/web`) is inconsistent with its sibling
`package-sources.json` (**35** slug-style entities like `bromo-1d1n`, sourced from
llm-wiki/jvto-web). They come from different extraction runs with different
schemas. Package-id matching quality is capped until the catalogue has one
canonical identity set. Recommend reconciling phase-1 sources before relying on
per-package booking analytics.

## Acceptance criteria

- [x] Root cause **narrowed** via snapshot evidence + exact confirm-SQL provided.
      ⚠️ Full Branch A/B confirmation is **BLOCKED pending DB access** (queries #1–#3).
- [~] Branch B ≥90% fill — *not applicable yet* (Branch not confirmed; no DB).
- [x] Branch A backfill produces explicit confidence labels; recommendation to
      Sam recorded (below). Original `package_id` preserved as null.
- [x] No new catalogue mismatch introduced — every `package_id_inferred` is a real
      id from `packages.json`; `check_conflicts()` unaffected (additive fields only).

## Recommendation to Sam (business/process — not a code change)

1. Make `package_id` a required FK (dropdown) in the new-backoffice booking form,
   so future bookings link to the catalogue structurally instead of free text.
2. If a junction/line-item table already exists (Branch B, query #3), point the
   phase-4 extraction at it — that turns 75.8% low-confidence guesses into
   near-100% real links with no process change.
3. Reconcile the phase-1 catalogue identity (16 vs 35) before per-package revenue
   reporting is trusted downstream.
