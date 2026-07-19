# Gap 2 — Channel Attribution — Diagnosis

**Date:** 2026-07-19 · **Effort:** high · Two independent tracks.

## Environment note

Track A's diagnostic SQL needs the live `new-backoffice` MySQL, which is
**unreachable from this environment** (egress is web-ports-only; port 3306 is
blocked; no MySQL client; the HTTPS proxy won't relay MySQL). Track A is therefore
confirmed only as far as the committed snapshot allows; the confirm-SQL is
provided for whoever has DB access. Track B is fully derivable from the snapshot
and is complete here.

---

## Track A — Booking channel (source: new-backoffice `bookings`)

### Evidence reproduced from snapshot (546 rows)

| channel | bookings | revenue | share |
|---|---|---|---|
| Website | 167 | Rp2,092,305,000 | 45.0% |
| **unknown (null)** | **379** | **Rp2,553,146,000** | **55.0%** |
| total | 546 | Rp4,645,451,000 | 100% |

69.4% of bookings and 55.0% of revenue carry no channel. The phase-4 query selects
`order_channel_id` (an id) but the output field is `channel` (a name) — so an
id→name resolution exists somewhere and fails for the null rows.

### Diagnostic SQL — run when DB access exists

```sql
-- 1. Distribution of the raw id (before name resolution)
SELECT order_channel_id, COUNT(*) n FROM bookings GROUP BY order_channel_id ORDER BY n DESC;

-- 2. Locate the lookup table
SHOW TABLES LIKE '%channel%';
-- 3. Inspect it: SELECT * FROM order_channels;

-- 4. Which ids have no lookup match?
SELECT DISTINCT b.order_channel_id
FROM bookings b LEFT JOIN order_channels oc ON b.order_channel_id = oc.id
WHERE oc.id IS NULL;
```

**Branch decision:**
- **A1 — lookup incomplete / mapping only covers "Website"** if query #1 shows many
  distinct ids but #4 shows most are unmapped. Fix (fast, pipeline-only): complete
  the id→name mapping for every active JVTO channel and re-run phase-4.
- **A2 — `order_channel_id` is itself NULL at source** if query #1 shows the id
  column is null on the unattributed rows. Fix is a *process* gap (channel never
  recorded at booking time, esp. OTA/webhook inflows) → recommendation to Sam, not
  an extraction fix.

### Why no `channel` value was fabricated here

The only channel-adjacent signal in the snapshot is flight codes embedded in
`pickup_city` (e.g. `Surabaya Airport Terminal 2 SQ922`). A flight number
indicates an airport pickup — **it does not identify the booking channel**
(Website vs Klook vs B2B). Writing a guessed `channel` would directly corrupt the
ROI/Ads attribution this gap exists to restore, so **`channel` is left unchanged**
and no `channel_inferred` field was added. Restoring attribution genuinely
requires the DB lookup (A1) or a source-process fix (A2). This is BLOCKED pending
DB access.

---

## Track B — Package `orderChannelEnabled` flags (source: CMS / package-registry)

### Evidence reproduced from snapshot — all 16 packages

| flag | true | false |
|---|---|---|
| JVTO | 16 | 0 |
| **KLOOK** | **0** | **16** |
| TRAVELOKA | 0 | 16 |
| TIKETCOM | 0 | 16 |
| OTHERS | 0 | 16 |

This is **not an extraction bug** — `phase-1-packages` faithfully reflects the
source (`product.channelMetadata.orderChannelEnabled`). `KLOOK = false` on every
package means the field was never updated in the source-of-truth since Klook
listings went live. Fixing it means editing the SSOT, which lives in the
**`jvto-web`** repo — out of scope for `jvto-data-core`. Recorded as a follow-up
(below), not fixed from here.

---

## Acceptance criteria

- [~] Track A `channel` null → <15%: **BLOCKED pending DB.** Cannot be met without
      the id→name lookup (A1) or a source fix (A2); guessing would poison
      attribution. Confirm-SQL + branch tree provided.
- [~] Track A unknown-revenue share proportionate: same blocker.
- [x] Track B reported as finding + recommendation to `jvto-web` (below).
- [~] `get_booking_analytics().by_channel` >2 categories: **not met, by design** —
      `by_channel` is derived from the record `channel` field at runtime, so it
      stays 2 (Website/unknown) until real source attribution exists. Documented
      rather than faked.

## Follow-up recommendations

**To Sam / new-backoffice (Track A):** run diagnostic #1/#4 to decide A1 vs A2;
if A1, complete the channel id→name mapping (Website, Klook, B2B/The Window
Travel, WhatsApp Direct, …) and re-run phase-4; if A2, ensure booking-create
paths (Klook API, Website form, OTA webhooks) always send an explicit channel id.

**To jvto-web team (Track B) — separate task, different repo:** verify against the
Klook merchant dashboard which packages are genuinely live, set
`orderChannelEnabled.KLOOK = true` for those in `package-registry.json`, then
re-run `phase-1-packages` so `packages.json` refreshes.
