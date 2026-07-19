# Gap 3 — `payment_status` stuck at "pending" (100%, zero variance) — Diagnosis

**Date:** 2026-07-19 · **Effort:** high · **Status:** ✅ **ROOT CAUSE CONFIRMED — Branch A (a real payments table exists)**, from `new-backoffice` source. This *overturns* the earlier snapshot-only Branch-B lean (retained below for provenance).

---

## ✅ UPDATE — source-confirmed from `jvto-devteam/new-backoffice` (Laravel)

Cloned into the session; the models/controllers confirm a real payment source exists:

> **⚠️ Correction (verified against `ExportDataBookings.php:53-59` & `FinanceController.php:281`).**
> An earlier revision proposed summing `booking_payments.amount`. Two fixes: the amount
> column is **`nominal`** (with an implicit `is_paid=1` global scope), *and* the app does
> **not** recompute status from payments — it reads the denormalized **`bookings.payment`
> / `bookings.balance`** columns. The corrected derivation below uses those.

- Payment state is denormalized on `bookings`: the app's canonical expression is
  `payment == 0 → Unpaid`; `balance <= 0 → Paid`; else `DP Paid` (partial)
  (`FinanceController.php:281`, `ClientController.php:132`, `CrmController.php:201`).
- Amount *collected* (if needed) = `SUM(booking_payments.nominal)` where `is_paid=1`
  (global scope) — `DashboardController.php:331`, `ExportDataBookings.php:176`.
- Xendit (`xendit_payouts`) and TWT invoicing exist too, but are not needed for status.

→ **This is Branch A, not Branch B.** `payment_status` was uniformly "pending" only
because the extraction read a `payment_status` field that isn't the real source.

**Confirmed fix — corrected phase-4 payment derivation:**
```sql
SELECT b.id,
  CASE
    WHEN b.payment = 0   THEN 'pending'   -- nothing paid
    WHEN b.balance <= 0  THEN 'paid'      -- fully settled
    ELSE 'partial'                        -- DP paid, balance remaining
  END AS payment_status
FROM bookings b
WHERE b.deleted_at IS NULL AND b.status = 'booked';
```
Implemented in `phases/phase-4-booking/extract.py` (`derive_payment_status`). The data
to fix `payment_status` **already exists** — no new integration is required. The Xendit
recommendation to Sam stands only for *automation*, not as a prerequisite.

---

## Environment note

The diagnostic SQL below needs the live `new-backoffice` MySQL, which is
**unreachable from this environment** (egress web-ports-only; 3306 blocked; no
MySQL client; proxy won't relay MySQL). Whether a separate `payments` table exists
(Branch A) can only be confirmed with DB access. The snapshot evidence below is
strong but cannot, by itself, prove the *absence* of a payments table.

## Evidence reproduced from snapshot (546 rows, snapshot 2026-06-13; today 2026-07-19)

| field | values |
|---|---|
| `payment_status` | `pending`: 546 — **one value for every row** |
| `operational_status` (same query) | `booked`: 358 · `pending wise`: 59 · `null`: 129 |
| travel date already in the **past** | **507 / 546** |
| … of those, `operational_status = booked` | 330 |
| … of those, `payment_status = pending` | 507 (all — since it's 100% pending) |

**Interpretation.** In the *same* extraction query, `operational_status` varies
but `payment_status` does not. A failed extraction would yield `NULL`, not a
uniform `"pending"`. And **507 bookings whose travel date has already passed** —
330 of them marked `booked` — are still "pending" payment, which is not
operationally plausible (people don't travel unpaid en masse). This is the
signature of a **field that is written once at booking creation and never
updated**, i.e. Branch B.

## Diagnostic SQL — run when DB access exists

```sql
-- 1. Confirm one value across the WHOLE table (not just the 12-month window)
SELECT payment_status, COUNT(*) FROM bookings GROUP BY payment_status;

-- 2. Is there a real payments/transactions table? (Sam explored Xendit BI SNAP)
SHOW TABLES LIKE '%payment%';
SHOW TABLES LIKE '%transaction%';
SHOW TABLES LIKE '%invoice%';
-- 3. If found (NO PII / no account numbers):
--    DESCRIBE payments;
--    SELECT booking_id, amount, status, paid_at FROM payments LIMIT 20;

-- 4. Extra proof the flag is unreliable
SELECT COUNT(*) FROM bookings
WHERE operational_status = 'booked' AND payment_status = 'pending'
  AND travel_date < CURDATE();
```

**Branch decision:**
- **Branch A — a real payments/transactions table exists** (query #2/#3): derive
  `payment_status` from it instead of the dead flag:
  ```sql
  SELECT b.booking_id,
    CASE WHEN COALESCE(SUM(p.amount),0) >= b.gross_revenue THEN 'paid'
         WHEN COALESCE(SUM(p.amount),0) > 0                THEN 'partial'
         ELSE 'pending' END AS payment_status_derived
  FROM bookings b LEFT JOIN payments p ON b.booking_id = p.booking_id
  GROUP BY b.booking_id;
  ```
  Then update a new phase-4 query to use the derivation and re-run.
- **Branch B — no payments table (or empty)**: `payment_status` cannot be fixed
  from extraction — the data simply isn't recorded anywhere structured.

**Snapshot lean: Branch B.** The evidence above (uniform value + 507 past-travel
rows still "pending") strongly indicates the flag is never maintained. But query
#2 is required to *rule out* a separate payments table before declaring Branch B
final.

## Why nothing was fabricated

No `payment_status_inferred` field was written. `operational_status` +
past-travel-date could produce a weak guess, but feeding guessed payment states
into `invoice-chase` / `cash-flow-snapshot` would create false "paid"/"unpaid"
signals in finance workflows — the exact harm this gap exists to prevent. The
authoritative `payment_status` is left unchanged.

## Acceptance criteria

- [x] Root cause identified via snapshot evidence; confirm-SQL provided.
      ⚠️ Branch A vs B final confirmation **BLOCKED pending DB** (query #2).
- [~] Branch A ≥2 distinct values after fix: not applicable yet (no DB).
- [x] Branch B report to Sam: recorded (below). Field needs a real payment source,
      not a query patch.
- [~] Spot-check 5 top bookings vs Gmail payment records: requires DB + Gmail
      cross-reference by a human; left as a manual follow-up for Sam.

## Recommendation to Sam (business decision — not a code fix)

1. Prioritise the previously-scoped **Xendit (BI SNAP) integration** — it produces
   a real per-booking transaction record, which makes `payment_status` derivable
   (Branch A) permanently.
2. Interim: keep `invoice-chase` on its current manual Gmail cross-reference;
   do **not** promise full automation until a reliable payment source exists.
3. If a payments table already exists (query #2), this becomes a fast
   extraction-only fix — check that first.
