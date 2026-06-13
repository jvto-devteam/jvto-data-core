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
