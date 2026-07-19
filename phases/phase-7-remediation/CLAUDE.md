# Phase 7: Remediation — Booking Data Gaps

Perbaiki 3 pain point di booking-aggregates yang nge-block finance & marketing
skill di jvto-web ecosystem. Semua 3 gap ada di sumber yang sama
(`new-backoffice` MySQL, tabel `bookings`), jadi dikerjakan sebagai satu
remediation phase dengan 3 sub-investigasi paralel, lalu satu sinkronisasi
akhir ke `jvto-data-core` plugin.

## Kenapa Phase Ini Ada

Snapshot 2026-06-13 dari `phase-4-booking` menunjukkan:

| Field | Kondisi sekarang | Dampak |
|---|---|---|
| `package_id` | **NULL di 546/546 booking (100%)** | Tidak bisa join booking↔package. Nol analitik per-paket. |
| `channel` | **NULL di 379/546 (69.4%)**, setara **Rp2.553.146.000 (55%) revenue** tak teratribusi | ROI campaign/Ads tidak bisa dihitung akurat |
| `payment_status` | **"pending" di 546/546 (100%), nol variasi** | `invoice-chase`/`cash-flow-snapshot` tidak bisa filter siapa yang belum bayar |

Ketiganya diambil langsung dari kolom mentah di query SQL phase-4
(`phases/phase-4-booking/CLAUDE.md`) — bukan hasil transformasi kompleks —
jadi kemungkinan besar root cause ada di **sumber data / proses bisnis**,
bukan cuma bug di script ekstraksi. Setiap sub-phase mulai dengan
**diagnostic query** untuk membuktikan itu sebelum nulis fix apapun.

## Urutan Kerja

```bash
cd phases/phase-7-remediation/gap-1-package-id && claude    # 1. diagnose + fix package_id
cd phases/phase-7-remediation/gap-2-channel-attribution && claude  # 2. diagnose + fix channel
cd phases/phase-7-remediation/gap-3-payment-status && claude       # 3. diagnose + fix payment_status
cd phases/phase-7-remediation/gap-4-sync-plugin && claude          # 4. re-run phase 1+4, sync ke plugin
```

Gap 1–3 independen satu sama lain (boleh paralel via subagent kalau mau),
tapi **gap-4 wajib terakhir** karena dia yang re-run ekstraksi dan sinkron
hasil final ke plugin `jvto-data-core`.

## Aturan Main

1. **Diagnose dulu, jangan langsung fix.** Setiap sub-CLAUDE.md punya query
   diagnostic di awal. Hasil query itu yang menentukan cabang fix mana yang
   dipakai — jangan skip ke bagian "remediation" tanpa run diagnostic dulu.
2. **Read-only sampai diagnostic selesai.** Jangan UPDATE/ALTER tabel
   `bookings` di new-backoffice sebelum root cause dikonfirmasi. Kalau fix
   ternyata perlu ubah data sumber (bukan cuma query ekstraksi), stop dan
   laporkan ke Sam dulu — itu keputusan bisnis, bukan keputusan teknis.
3. **Tidak ada PII.** Aturan phase-4 asli tetap berlaku: jangan pernah
   select/log nama, email, telepon, atau data pembayaran customer di query
   diagnostic maupun output.
4. **Dokumentasikan root cause yang ketemu**, bahkan kalau fix-nya di luar
   scope teknis (misal: ternyata payment_status emang gak pernah di-update
   secara manual oleh staff — itu temuan valid, tulis di laporan, jangan
   dipaksa "diperbaiki" lewat query).

## Effort & Impact Ringkas

| Gap | Diagnostic effort | Fix effort (best case) | Fix effort (worst case) | Impact kalau fixed |
|---|---|---|---|---|
| #1 package_id | low (3 query) | medium — perbaiki query ekstraksi | high — perlu backfill + proses baru di booking form | Buka analitik revenue/margin per-paket untuk `content-strategy`, `price-check`, `month-end-prep` |
| #2 channel | low (3 query) | low — lengkapi mapping channel ID→nama | medium — proses tagging channel di titik booking masuk | Pulihkan atribusi Rp2,55M (55% revenue) untuk ROI Ads/campaign |
| #3 payment_status | low (3 query) | low — join ke tabel payments yang sudah ada | high — perlu integrasi Xendit (sudah pernah dieksplorasi) | Buka otomasi `invoice-chase`/`cash-flow-snapshot` |

## Output

- `gap-1-package-id/output/diagnosis.md` + query fix (kalau ketemu)
- `gap-2-channel-attribution/output/diagnosis.md` + query fix
- `gap-3-payment-status/output/diagnosis.md` + query fix
- `gap-4-sync-plugin/output/validation-report.md` — hasil re-run + acceptance
  criteria check
- `phases/phase-4-booking/output/booking-aggregates.json` — regenerated
- `phases/phase-1-packages/output/packages.json` — regenerated (kalau gap-2
  Track B disentuh)
- Plugin `jvto-data-core` versi baru (bump ke 1.1.0) dengan data yang sudah
  diperbaiki

## Tools & Integrations

- MySQL: `new-backoffice` (127.0.0.1:3007, db `jvto`) — read-only sampai
  root cause dikonfirmasi
- Referensi: `phases/phase-4-booking/CLAUDE.md`, `phases/phase-1-packages/CLAUDE.md`
  (query asli, jangan diubah — bikin versi baru di sub-phase ini)

## Effort Level

`high` — ini debugging data pipeline lintas sistem, bukan extraction
biasa. Butuh keputusan bisnis di beberapa titik (lihat "Aturan Main" #2),
jangan diselesaikan penuh-otomatis tanpa checkpoint ke Sam.
