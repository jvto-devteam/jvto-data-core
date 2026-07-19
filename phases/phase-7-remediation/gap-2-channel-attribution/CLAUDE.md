# Gap 2: Channel Attribution — 69,4% NULL, 55% Revenue Tak Teratribusi

Ada **2 track terpisah** untuk gap ini — jangan digabung, root cause dan
fix-nya beda sistem:

- **Track A** — `channel` NULL di level booking (`phase-4-booking`,
  sumber: new-backoffice MySQL)
- **Track B** — `orderChannelEnabled.KLOOK` = `false` di semua 16 package
  (`phase-1-packages`, sumber: llm-wiki/jvto-web `package-registry.json`)

## Current State (evidence)

```
Track A — booking channel:
  channel: {null: 379, "Website": 167}   → 69.4% NULL
  unknown-channel revenue: Rp2.553.146.000 dari Rp4.645.451.000 = 55.0%

Track B — package channel enablement (semua 16 package):
  JVTO: 16 true, 0 false
  KLOOK: 0 true, 16 false        ← padahal Klook channel aktif JVTO
  TRAVELOKA: 0 true, 16 false
  TIKETCOM: 0 true, 16 false
```

---

## Track A — Booking Channel Resolution

Query asli select `order_channel_id` (kolom ID) tapi output JSON field-nya
`channel` (string nama). ID→nama itu artinya ADA proses resolusi/JOIN di
suatu tempat yang tidak sepenuhnya berhasil untuk 69,4% baris.

### Diagnostic

```sql
-- 1. Distribusi order_channel_id mentah (sebelum di-resolve ke nama)
SELECT order_channel_id, COUNT(*) AS n
FROM bookings
GROUP BY order_channel_id
ORDER BY n DESC;

-- 2. Cari tabel lookup channel
SHOW TABLES LIKE '%channel%';

-- 3. Kalau ketemu (misal `order_channels`), cek isinya lengkap atau tidak
-- SELECT * FROM order_channels;

-- 4. Silang cek: channel_id mana yang TIDAK punya pasangan di lookup table
-- SELECT DISTINCT b.order_channel_id
-- FROM bookings b
-- LEFT JOIN order_channels oc ON b.order_channel_id = oc.id
-- WHERE oc.id IS NULL;
```

### Branch A1 — Lookup table tidak lengkap / mapping hardcode cuma cover "Website"

**Tanda:** Diagnostic #1 menunjukkan `order_channel_id` punya banyak nilai
distinct (bukan cuma NULL), tapi #4 menunjukkan sebagian besar ID itu
tidak match ke lookup table manapun.

**Fix (murni pipeline, cepat, prioritaskan ini duluan):**

1. Lengkapi mapping channel ID→nama supaya cover semua channel aktif JVTO
   (Website, Klook, The Window Travel B2B, WhatsApp Direct, dll — cross-check
   daftar channel aktif ke Sam/Inan kalau tidak yakin daftarnya lengkap).
2. Update query ekstraksi di `phases/phase-4-booking/` versi baru pakai
   JOIN yang benar, atau CASE WHEN yang cover semua channel ID yang ada.
3. Re-run phase-4.

### Branch A2 — `order_channel_id` genuinely NULL di source

**Tanda:** Diagnostic #1 menunjukkan banyak baris dengan `order_channel_id`
itu sendiri NULL (bukan cuma gagal resolve).

**Fix:** Ini gap proses, bukan cuma query — channel tidak pernah dicatat
saat booking masuk (terutama untuk booking yang datang dari OTA/webhook
yang mungkin tidak mengisi field ini). Rekomendasi:
- Backfill heuristik: pola `pickup_city` yang berisi kode penerbangan
  (`Surabaya Airport Terminal 2 SQ922` dst.) mengindikasikan booking
  terkait maskapai/OTA tertentu — bisa jadi sinyal tidak langsung, tapi
  **confidence rendah**, jangan diklaim sebagai fakta.
- Long-term: pastikan integrasi channel (Klook API, form Website) selalu
  mengirim channel ID eksplisit saat create booking. Ini keputusan
  engineering di new-backoffice, laporkan sebagai rekomendasi ke Sam.

---

## Track B — Package `orderChannelEnabled` Flags (Sumber: CMS, bukan Pipeline)

**Ini bukan bug ekstraksi.** `phase-1-packages/CLAUDE.md` mengonfirmasi
data ini diambil langsung dari `package-registry.json` di llm-wiki dan
jvto-web — extraction cuma mencerminkan apa yang tertulis di sumbernya.
Kalau `KLOOK: false` untuk semua 16 package padahal Klook itu channel
aktif secara komersial, berarti field itu **tidak pernah diupdate** di
CMS/SSOT sejak Klook listing di-live-kan.

### Fix (bukan tugas Claude Code di jvto-data-core — tapi flag ke jvto-web)

1. **Verifikasi manual** (Sam/Inan): cek Klook merchant dashboard, daftar
   package mana yang aktual live di sana.
2. **Update source of truth**: edit `package-registry.json` di repo
   `jvto-web` (atau llm-wiki kalau itu yang canonical) untuk set
   `orderChannelEnabled.KLOOK = true` pada package yang benar-benar live
   di Klook. Ini pekerjaan di repo `jvto-web`, bukan `jvto-data-core` —
   catat sebagai follow-up task terpisah, jangan coba fix dari sini.
3. Re-run `phase-1-packages` extraction setelah source-nya diupdate, supaya
   `packages.json` di sini ikut ter-refresh.

## Acceptance Criteria

- [ ] Track A: `channel` NULL rate turun dari 69,4% ke <15% (booking asli
      tanpa channel info dianggap wajar ada sisa kecil, jangan dipaksa 0%)
- [ ] Track A: unknown-channel revenue share turun dari 55% ke level yang
      proporsional dengan sisa NULL rate
- [ ] Track B: minimal dilaporkan sebagai temuan + rekomendasi ke tim
      `jvto-web` — tidak wajib selesai di phase ini kalau butuh akses ke
      repo lain
- [ ] `get_booking_analytics()` lewat MCP tool menunjukkan `by_channel`
      dengan breakdown lebih dari 2 kategori (saat ini cuma Website/unknown)

## Output

`output/diagnosis.md` — hasil diagnostic Track A + kesimpulan branch,
query fix final (kalau A1), dan catatan follow-up terpisah untuk Track B.
