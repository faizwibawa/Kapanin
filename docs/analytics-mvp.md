# Analytics MVP: prioritas stok

## Endpoint yang tersedia

`GET /analytics/stock-priorities?limit=50&offset=0` memerlukan bearer token Supabase. Untuk toko demo bersama, gunakan `GET /demo/analytics/stock-priorities` tanpa login. `limit` 1–100, `offset` mulai 0. Respons berisi `as_of_date`, `window_start`, `lookback_days`, `basis`, `total`, `summary`, dan `items`.

Perhitungan mengikuti `build_stock_priorities` di `notebooks/main.ipynb`: jumlahkan stok per produk dan unit terjual dalam 28 hari selesai sebelum `as_of_date`. Produk dengan stok nol tidak ditampilkan. Kelompok berurutan: `no_sales_28d`, `cover_gt_90d`, `cover_30_90d`, `cover_le_30d`; dalam kelompok, nilai modal tertahan tertinggi didahulukan. Ini prioritas informatif, bukan prediksi permintaan, risiko kedaluwarsa, efek kausal diskon, atau rekomendasi besaran diskon. Produk yang sempat habis stok bisa terlihat seolah permintaannya rendah.

Endpoint membaca `products`, `stock`, dan `sales`. Demo CSV memakai snapshot stok 2026-10-01, sehingga endpoint demo memakai tanggal tersebut sebagai `as_of_date`. Penjualan yang ditambah setelah tanggal snapshot tidak masuk jendela 28 hari itu.

## Skema yang dipertahankan

`0008_analytics_history.sql` menambah kolom `sales.regular_price_at_sale`, `sales.unit_cost_at_sale`, dan `sales.discount_id`. Kolom harga dan biaya terisi pada transaksi CSV; `discount_id` tetap `null` karena CSV tidak mencatat periode diskon yang dapat dikaitkan dengan pasti. Tabel `discounts` tetap mendukung API diskon.

`0009_remove_unused_history.sql` menghapus `stock_batches`, `product_daily_observations`, `stock_batch_daily_observations`, dan view `product_day`. Tidak ada endpoint yang memakai keempat objek tersebut, dan semua tabel riwayat berisi nol baris sebelum migrasi disiapkan. Migrasi menolak penghapusan bila ada baris baru yang masuk.

Model prediksi produk harian dan dampak diskon tidak dijalankan di backend ini. Data sintetis dan stok snapshot tunggal belum cukup untuk mengukur permintaan saat stok kosong atau efek diskon secara kausal.
