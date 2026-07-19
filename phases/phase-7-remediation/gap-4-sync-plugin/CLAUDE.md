# Gap 4: Sync Fixed Data ke Plugin `jvto-data-core`

Langkah terakhir, wajib setelah gap 1–3 selesai (atau minimal gap 1 & 3,
plus Track A dari gap 2 — Track B gap 2 boleh nyusul karena itu di repo
`jvto-web`, bukan di sini).

## Kenapa Langkah Ini Perlu

Fix di gap 1–3 cuma mengubah `phases/*/output/*.json` di repo
`jvto-data-core`. Plugin `jvto-data-core` (yang dipakai lewat MCP di
Claude session lain) **membundel salinan statis** dari file-file itu di
`mcp-server/data/`. Tanpa langkah sync ini, plugin akan terus menyajikan
data lama yang masih punya 3 gap di atas — perbaikan di source tidak
otomatis nyampe ke plugin.

## Steps

```bash
# 1. Re-run ekstraksi phase 1 (kalau Track B gap-2 disentuh) dan phase 4
cd phases/phase-1-packages && claude   # kalau ada perubahan
cd phases/phase-4-booking && claude    # wajib, gap 1/2A/3 semua di sini

# 2. Copy hasil regenerated ke plugin (path relatif harus sama persis)
cp phases/phase-1-packages/output/packages.json \
   <path-to-plugin>/jvto-data-core/mcp-server/data/phase-1-packages/output/
cp phases/phase-4-booking/output/booking-aggregates.json \
   <path-to-plugin>/jvto-data-core/mcp-server/data/phase-4-booking/output/

# 3. Bump versi plugin
#    .claude-plugin/plugin.json: "version": "1.0.0" -> "1.1.0"
#    mcp-server/mcp-server.ts: Server version "2.1.0" -> "2.2.0"
#    mcp-server/package.json: "version": "2.1.0" -> "2.2.0"

# 4. Rebuild
cd <path-to-plugin>/jvto-data-core/mcp-server && npx tsc

# 5. Re-run smoke test — HARUS 13/13 pass sebelum re-package
node test-tools.mjs

# 6. Re-zip
cd <path-to-plugin>/jvto-data-core && \
  zip -r /tmp/jvto-data-core.plugin . -x "*.DS_Store" -x "*/node_modules/*"
```

## Validation Checklist (jalankan lewat MCP tool call, bukan cuma baca file)

Panggil `get_booking_analytics()` dan `get_operational_summary()` lewat
tool, lalu cek:

- [ ] `by_channel` punya lebih dari 2 kategori (bukan cuma
      `Website`/`unknown` lagi)
- [ ] `by_payment_status` punya lebih dari 1 nilai (bukan cuma `pending`)
- [ ] Angka `total_gross_revenue_idr` **tidak berubah** dibanding sebelum
      fix (Rp4.645.451.000) — kalau berubah, ada row yang ke-drop/duplikat
      selama proses fix, investigasi ulang sebelum lanjut
- [ ] Sample `get_package(id)` untuk salah satu package_id yang sekarang
      muncul di booking data (hasil gap-1) — pastikan match ke package
      yang valid di `packages.json`, bukan ID yang nyasar

## Output

`output/validation-report.md` — hasil checklist di atas + before/after
comparison table (channel breakdown lama vs baru, payment_status
breakdown lama vs baru, % package_id ter-isi lama vs baru).

## Effort Level

`medium` — mostly mechanical (copy, rebuild, test) asalkan gap 1–3 sudah
selesai dengan bersih. Risiko utama ada di checklist #3 (revenue total
berubah) — kalau itu terjadi, jangan lanjut re-package, balik ke gap yang
relevan dulu.
