# Analytics MVP: prioritas stok dan panel harian

## Endpoint yang tersedia di kode

`GET /analytics/stock-priorities?limit=50&offset=0` memerlukan bearer token Supabase. `limit` 1–100, `offset` mulai 0. Respons berisi `as_of_date` UTC, `window_start`, `lookback_days`, `basis`, `total`, `summary`, dan `items`. Setiap item berisi produk, stok sekarang, unit terjual dalam 28 **hari selesai** sebelum `as_of_date`, `days_of_cover`, perkiraan sisa 28 hari, nilai modal yang tertahan, dan kelompok prioritas.

Perhitungan mengikuti `build_stock_priorities` di `notebooks/main.ipynb`: seluruh baris stok produk dijumlahkan, lalu penjualan di `[as_of_date - 28 hari, as_of_date)` dijumlahkan. Produk dengan stok nol tidak ditampilkan. Kelompok berurutan: `no_sales_28d`, `cover_gt_90d`, `cover_30_90d`, `cover_le_30d`; dalam kelompok, nilai modal tertahan tertinggi didahulukan. Ini triase informatif, **bukan** prediksi permintaan, risiko kedaluwarsa, efek kausal diskon, atau rekomendasi besaran diskon. Produk yang sempat habis stok bisa terlihat seolah permintaannya rendah. Ambang 30/90 hari masih perlu divalidasi bersama pemilik toko.

Contoh:

```json
{
  "as_of_date": "2026-10-16",
  "window_start": "2026-09-18",
  "lookback_days": 28,
  "basis": "current_stock_and_recorded_sales",
  "total": 1,
  "limit": 50,
  "offset": 0,
  "summary": {"no_sales_28d": {"products": 1, "tied_cost_28d_proxy": 40000}},
  "items": [{"product_id": "...", "name": "Produk A", "category": null,
    "stock_quantity": 10, "units_sold_28d": 0, "days_of_cover": null,
    "remaining_28d_proxy": 10, "tied_cost_28d_proxy": 40000,
    "priority_group": "no_sales_28d"}]
}
```

`summary` selalu memuat empat kelompok, termasuk yang bernilai nol. Endpoint membaca data milik pengguna terautentikasi saja dan memaginasi pembacaan database internal, terpisah dari pagination respons.

## Kontrak data untuk model berikutnya

Migrasi `0008_analytics_history.sql` menambah:

- `stock_batches`: satu penerimaan barang per batch, jumlah awal, biaya, dan tanggal kedaluwarsa aktual bila ada.
- `product_daily_observations`: satu catatan per produk per tanggal lokal toko, termasuk hari tanpa penjualan. Catat stok buka/tutup, penerimaan, pembuangan, jam tersedia (0–24), harga reguler, biaya, dan promosi yang **benar-benar berjalan** pada hari itu.
- `stock_batch_daily_observations`: saldo tutup dan pembuangan per batch per hari, mengaitkan batch ke observasi produk pada tanggal yang sama.
- Kolom nullable pada `sales`: `regular_price_at_sale`, `unit_cost_at_sale`, `discount_id`. Isi pada transaksi baru saat terjadi; nilai `null` pada data lama tetap berarti tidak diketahui.
- View `product_day`: gabungkan observasi produk dengan penjualan aktual per hari. Satu baris per produk per tanggal yang **tercatat**. `units_sold = 0` hanya untuk hari tercatat tanpa penjualan; tanggal tanpa observasi tidak muncul.

Urutan operasional: catat penerimaan batch; pada setiap hari lokal toko simpan observasi lengkap untuk **semua produk aktif** termasuk stok nol dan tanpa promo; simpan sale dengan harga/biaya/promosi saat transaksi; catat pembuangan serta saldo setiap batch; tutup hari setelah data penjualan dan stok direkonsiliasi. Gunakan zona waktu toko yang konsisten untuk `observed_on` dan `sold_on`; saat ini endpoint prioritas memakai tanggal UTC, jadi tetapkan zona waktu toko sebelum memakai hasilnya sebagai keputusan harian. `recorded_at` menyimpan kapan observasi tersedia agar backtest dapat menghindari informasi yang belum diketahui pada waktu keputusan.

Sebelum training, audit: kelengkapan produk-hari, jumlah saldo batch vs `stock_close`, `stock_open + stock_received - units_sold - units_discarded = stock_close` (perhitungkan penyesuaian manual jika ada), jam tersedia 0 pada hari stok kosong, dan kesesuaian `discount_id` dengan promosi yang diterapkan. Simpan tanggal yang gagal audit sebagai *unknown*, jangan isi dengan nol. View ini adalah panel observasi, belum dataset fitur/label siap training. Untuk uplift diskon, diperlukan juga periode tanpa promo yang sebanding dan cara penugasan promo yang tercatat.

Migrasi dan view masih berupa file repo; jalankan di database proyek setelah meninjau skema. Belum ada endpoint penulisan untuk tiga tabel baru, jadi pengumpulan data harian memerlukan integrasi kasir/stok atau pekerjaan backend berikutnya.
