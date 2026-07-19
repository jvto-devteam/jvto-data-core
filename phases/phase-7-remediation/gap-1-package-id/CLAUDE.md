# Gap 1: `package_id` NULL di 100% Booking

## Current State (evidence, dari snapshot 2026-06-13)

```
total bookings: 546
package_id NULL count: 546   ← 100%, tidak ada satupun yang keisi
distinct package_id: 1        ← literalnya cuma nilai "NULL"
```

Query ekstraksi asli (`phases/phase-4-booking/CLAUDE.md`) select
`package_id` langsung dari tabel `bookings` tanpa transformasi:

```sql
SELECT ..., package_id, ... FROM bookings WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
```

Karena ini kolom mentah (bukan hasil JOIN/CASE), NULL 100% berarti salah
satu dari 3 kemungkinan di bawah — **bukan diasumsikan bug ekstraksi.**

## Diagnostic — jalankan ini DULU, jangan lompat ke fix

```sql
-- 1. Pastikan kolomnya memang ada isinya atau memang kosong semua
SELECT COUNT(*) AS total, COUNT(package_id) AS non_null_package_id
FROM bookings;

-- 2. Cek apakah ada kolom lain yang menyimpan info package
SHOW COLUMNS FROM bookings LIKE '%package%';
SHOW COLUMNS FROM bookings LIKE '%product%';
SHOW COLUMNS FROM bookings LIKE '%tour%';

-- 3. Cek apakah ada tabel junction terpisah (booking bisa multi-package
--    atau linked lewat tabel lain, bukan kolom langsung)
SHOW TABLES LIKE '%booking%';
SHOW TABLES LIKE '%order_item%';

-- 4. Kalau ketemu tabel junction di atas, cek isinya
-- SELECT * FROM <nama_tabel_junction> LIMIT 20;

-- 5. Sample 10 booking row mentah (TANPA kolom PII) buat lihat pola
SELECT booking_id, package_id, order_channel_id, travel_date, pickup_city, created_at
FROM bookings
ORDER BY created_at DESC
LIMIT 10;
```

## Branch A — Kolom `package_id` genuinely kosong di source

**Tanda:** Query diagnostic #1 menunjukkan `non_null_package_id = 0`, dan
tidak ada tabel junction alternatif di #3.

**Artinya:** Ini bukan bug ekstraksi — booking di new-backoffice memang
dibuat tanpa link terstruktur ke katalog package. Kemungkinan alur staff
input booking pakai free-text nama paket, bukan pilih dari dropdown/FK.

**Fix (tidak bisa selesai di level query saja):**

1. **Short-term backfill (best-effort, bukan sempurna):** Tulis script
   yang cocokkan tiap booking ke package_id paling mungkin berdasarkan
   sinyal tidak langsung yang tersedia — kombinasi `gross_revenue`
   (dicocokkan ke rentang harga tier package), `pax_count`, dan
   `pickup_city` (pola "Surabaya Airport..." mengindikasikan origin
   tertentu). **Tandai hasil backfill dengan confidence level
   (`high`/`medium`/`low`)** — jangan tulis seolah-olah ini data pasti.
   Simpan sebagai kolom tambahan `package_id_inferred` +
   `package_id_inference_confidence`, JANGAN timpa ekspektasi bahwa
   `package_id` asli tetap NULL (biar jujur soal provenance).
2. **Long-term (perlu keputusan produk, bukan cuma teknis):** Usulkan ke
   Sam supaya form booking di new-backoffice mewajibkan pilih package_id
   dari katalog (dropdown/FK), bukan free text. Ini keputusan di luar
   scope Claude Code — laporkan sebagai rekomendasi, jangan diimplementasi
   sendiri tanpa persetujuan.

## Branch B — Data ada tapi di kolom/tabel lain

**Tanda:** Diagnostic #2 atau #3 menemukan kolom/tabel alternatif yang
punya isi (misal `product_id`, atau tabel `booking_items` dengan FK ke
package).

**Fix (murni perbaikan query ekstraksi, cepat):**

1. Update SQL di `phases/phase-4-booking/CLAUDE.md` (buat versi baru,
   jangan timpa yang lama) untuk JOIN/SELECT dari kolom/tabel yang benar.
   Contoh kalau ternyata ada tabel junction:
   ```sql
   SELECT b.booking_id, bp.package_id, ...
   FROM bookings b
   LEFT JOIN booking_packages bp ON b.booking_id = bp.booking_id
   ```
2. Re-run phase-4 extraction dengan query baru.
3. Validasi: `package_id` non-null rate harus signifikan naik dari 0%.

## Acceptance Criteria

- [ ] Root cause terkonfirmasi lewat diagnostic query (Branch A atau B),
      bukan asumsi
- [ ] Kalau Branch B: ≥90% booking 12 bulan terakhir punya `package_id`
      valid yang match ke salah satu dari 16 package di `packages.json`
- [ ] Kalau Branch A: backfill script menghasilkan confidence label yang
      jelas, dan laporan ke Sam berisi rekomendasi fix proses di sumber
- [ ] `check_conflicts()` lewat MCP tool tidak menunjukkan mismatch baru
      antara `package_id` hasil backfill/fix dan katalog `packages.json`

## Output

`output/diagnosis.md` — hasil ke-5 diagnostic query + kesimpulan branch
mana yang berlaku, plus (kalau Branch B) query fix final yang dipakai.
