# Gap 3: `payment_status` Stuck di "pending" — 100%, Nol Variasi

## Current State (evidence)

```
payment_status: {"pending": 546}   ← satu nilai doang untuk SEMUA booking

Bandingkan operational_status (kolom lain, query sama):
operational_status: {"booked": 358, "pending wise": 59, null: 129}
```

Fakta bahwa `operational_status` punya variasi tapi `payment_status` tidak,
di query yang sama, adalah sinyal kuat: `payment_status` itu **field yang
tidak pernah di-update**, bukan field yang gagal di-extract (kalau gagal
extract, harusnya NULL, bukan konsisten "pending").

## Diagnostic — jalankan ini DULU

```sql
-- 1. Konfirmasi memang cuma satu nilai di seluruh tabel (bukan cuma di
--    12 bulan terakhir yang di-filter query asli)
SELECT payment_status, COUNT(*) FROM bookings GROUP BY payment_status;

-- 2. Cek apakah ada tabel payment/transaction terpisah yang justru
--    punya data real (ini paling mungkin, karena Sam sempat eksplorasi
--    integrasi Xendit BI SNAP — kemungkinan ada tabel payment historis
--    yang terpisah dari flag di tabel bookings)
SHOW TABLES LIKE '%payment%';
SHOW TABLES LIKE '%transaction%';
SHOW TABLES LIKE '%invoice%';

-- 3. Kalau ketemu tabel di atas, cek strukturnya dan sample data (TANPA
--    kolom PII/nomor rekening customer)
-- DESCRIBE payments;
-- SELECT booking_id, amount, status, paid_at FROM payments LIMIT 20;

-- 4. Silang cek: apakah ada booking yang jelas-jelas sudah selesai
--    (operational_status = 'booked', travel_date sudah lewat) tapi
--    payment_status masih 'pending' — ini bukti tambahan field ini
--    tidak reliable
SELECT COUNT(*) FROM bookings
WHERE operational_status = 'booked' AND payment_status = 'pending'
  AND travel_date < CURDATE();
```

## Branch A — Ada tabel payments/transactions terpisah dengan data real

**Tanda:** Diagnostic #2/#3 menemukan tabel dengan data pembayaran asli
(amount, status, tanggal).

**Fix (murni pipeline, cepat, prioritaskan ini):**

1. Jangan pakai `bookings.payment_status` lagi sebagai sumber. Derive
   status dari tabel payments:
   ```sql
   SELECT
     b.booking_id,
     CASE
       WHEN COALESCE(SUM(p.amount), 0) >= b.gross_revenue THEN 'paid'
       WHEN COALESCE(SUM(p.amount), 0) > 0 THEN 'partial'
       ELSE 'pending'
     END AS payment_status_derived
   FROM bookings b
   LEFT JOIN payments p ON b.booking_id = p.booking_id
   GROUP BY b.booking_id
   ```
   (Sesuaikan nama kolom/tabel dengan hasil diagnostic #3 — ini template,
   bukan query final.)
2. Update `phases/phase-4-booking/` versi baru pakai derivasi ini,
   bukan kolom `payment_status` mentah.
3. Re-run phase-4.

## Branch B — Tidak ada tabel payment terpisah, memang tidak pernah dicatat

**Tanda:** Diagnostic #2 tidak menemukan tabel payment/transaction sama
sekali, atau tabelnya ada tapi kosong.

**Fix (bukan hal yang bisa diselesaikan lewat query ekstraksi):**

Ini mengonfirmasi kebutuhan yang sudah pernah dieksplorasi Sam sebelumnya
— integrasi Xendit (BI SNAP API) untuk payment automation end-to-end.
Tanpa sistem pencatatan pembayaran yang reliable, `payment_status` di
level data-core tidak bisa diperbaiki dari sisi ekstraksi — datanya
memang tidak ada di manapun secara terstruktur.

**Rekomendasi ke Sam (bukan tugas teknis Claude Code):**
1. Prioritaskan integrasi Xendit yang sudah pernah di-scope, karena itu
   akan otomatis menghasilkan record transaksi real per booking.
2. Sebagai interim, `invoice-chase` skill bisa terus pakai cross-reference
   manual ke Gmail (yang sudah jadi mekanismenya sekarang) — jangan
   dijanjikan otomatis penuh sebelum sumber data pembayaran ada.

## Acceptance Criteria

- [ ] Root cause terkonfirmasi (Branch A atau B) via diagnostic query
- [ ] Kalau Branch A: `payment_status` menunjukkan minimal 2 nilai
      berbeda (bukan cuma "pending" seragam) setelah fix, dan proporsinya
      make sense dibanding `operational_status` (booking dengan status
      "booked" harusnya mayoritas "paid" atau "partial", bukan "pending")
- [ ] Kalau Branch B: laporan eksplisit ke Sam bahwa field ini butuh
      integrasi Xendit untuk benar-benar diperbaiki, bukan quick-fix query
- [ ] Spot-check manual: ambil 5 booking dari `top_5_bookings_by_revenue`
      hasil `get_booking_analytics()`, cocokkan payment_status baru
      terhadap catatan pembayaran di Gmail (kalau ada) untuk validasi akurasi

## Output

`output/diagnosis.md` — hasil diagnostic + kesimpulan branch + (kalau
Branch A) query derivasi final yang dipakai.
