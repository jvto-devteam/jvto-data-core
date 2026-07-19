# Phase 4: Booking Aggregates (NO PII)

Extract booking aggregate data dari new-backoffice MySQL — tanpa data personal.

## Sumber Data

MySQL lokal: 127.0.0.1:3007, DB: jvto, user: root

## Query (TANPA PII)

```sql
SELECT
  MD5(booking_id) as booking_id_hash,
  order_channel_id,
  package_id,
  MONTH(travel_date) as travel_month,
  YEAR(travel_date) as travel_year,
  pax_count,
  pickup_city,
  dropoff_city,
  gross_revenue,
  cost_total,
  (gross_revenue - cost_total) as profit_estimate,
  payment_status,
  operational_status,
  created_at
FROM bookings
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
```

## JANGAN Include

- customer name, email, phone, passport
- payment details, WhatsApp logs

## Output

- `output/booking-aggregates.json` - Aggregate data + analytics summary

## Validation

- Tidak ada PII di output
- Analytics (total_bookings, total_revenue, avg_pax) terisi

---

## Query v2 (remediated — Phase 7) — gunakan ini

⚠️ **Query v1 di atas ditulis untuk skema yang TIDAK cocok dengan `new-backoffice`
sebenarnya.** Kolom `order_channel_id`, `package_id`, `gross_revenue`, `pax_count`,
`pickup_city`, `payment_status`, `operational_status`, `travel_date` **tidak ada** di
tabel `bookings`. Query v1 dipertahankan hanya sebagai jejak provenance — jangan dipakai.

Skema asli (diverifikasi dari `new-backoffice`
`app/Http/Controllers/ExportData/ExportDataBookings.php::bookings()`):

| Output field | Sumber asli di `new-backoffice` |
|---|---|
| `package_id` | `booking_details.package_id` (bookingDetail[0]) — **bukan** di `bookings` |
| `channel` | diturunkan: `agent_id=1→TWT`; `booking_category_id=3→KLOOK`; else `JVTO` |
| `channel_tag` | `bookings.channel_tag` ENUM(klook/gyg/viator) — override OTA manual |
| `payment_status` | `payment=0→pending`; `balance<=0→paid`; else `partial` |
| `gross_revenue` | `bookings.grand_total` |
| `cost_total` | `bookings.expense_internal_total` |
| `pax_count` | `bookings.total_pax` |
| `pickup_city` | `bookings.meeting_point` |
| `travel_month/year` | dari `bookings.travel_date_start` |
| `operational_status` | `bookings.status` |

**Cara jalan (kredensial dari ENV, bukan hardcode — jangan commit kredensial):**
```bash
DB_HOST=... DB_PORT=3306 DB_USER=... DB_PASS=... DB_NAME=jvto \
  python3 phases/phase-4-booking/extract.py
```
Script `extract.py` adalah port setia dari `ExportDataBookings::bookings()`: read-only,
PII-safe (booking id di-MD5), filter `status='booked'` + `deleted_at IS NULL`, window 12
bulan. Kalau DB tak terjangkau / driver / ENV tidak ada → skip rapi (exit ≠ 0, tidak
menimpa snapshot). Output tetap `{ booking_aggregates, analytics }` supaya `phase-6-mcp`
tidak berubah.

> Catatan: `total_revenue` v2 berbasis `grand_total`, jadi wajar berbeda dari snapshot
> lama (Rp4.645.451.000) — itu bukan bug. `cost_total` kini nyata (`expense_internal_total`),
> memperbaiki bug `cost_total=0`/`profit=revenue` di snapshot lama.
