# Rencana training model Kapanin

## Status saat ini

`notebooks/main.ipynb` menggabungkan EDA, prioritas stok informatif, dan eksperimen prediksi unit terjual **per kategori untuk minggu berikutnya** dengan pemisahan waktu. Model hanya boleh dipakai jika secara konsisten mengalahkan baseline sederhana. Hasil notebook saat ini belum melewati gerbang tersebut.

Data prototipe adalah sintetis. Tidak ada riwayat stok harian atau tanggal kedaluwarsa per batch. Karena itu penjualan tercatat belum bisa dianggap sebagai permintaan sesungguhnya saat stok kosong, dan belum ada label kerugian kedaluwarsa yang teramati.

## Urutan model

| Tahap | Target yang terukur | Pembanding minimum | Syarat data | Keputusan bila gagal |
| --- | --- | --- | --- | --- |
| Permintaan mingguan | Unit terjual per kategori; kemudian per produk aktif | Rata-rata 4/12 minggu dan EWMA | Penjualan harian, ketersediaan stok, kalender | Pakai baseline; jangan tampilkan prediksi model |
| Risiko stok | Unit/nilai modal yang benar-benar tersisa atau terbuang dalam horizon tertentu | Aturan stok, laju jual, dan masa simpan | Riwayat stok per batch, penerimaan, penjualan, pembuangan, tanggal kedaluwarsa | Tampilkan prioritas informatif, bukan skor ML |
| Efek diskon | Perubahan unit dan **laba kotor** akibat pilihan tingkat diskon terhadap tanpa diskon | Kebijakan harga saat ini dan uji terkontrol sederhana | Riwayat harga reguler, diskon yang diterapkan, produk yang tidak dipromosikan, stok tersedia, biaya saat transaksi | Jangan klaim uplift atau diskon optimal |
| Waktu promosi | Nilai keputusan memulai promo pada minggu tertentu | Aturan kedaluwarsa dan forecast sederhana | Semua data di atas serta outcome beberapa horizon | Pertahankan aturan dan pemeriksaan manusia |

LightGBM dapat menjadi kandidat untuk prediksi tabular. TFT hanya kandidat untuk deret waktu setelah baseline dan model yang lebih sederhana diuji. T-Learner memerlukan outcome periode perlakuan dan pembanding yang benar-benar dapat dibandingkan; model tidak boleh dilatih dari transaksi terjual saja.

## Data operasional yang perlu dicatat

Satu baris `product_day` untuk **setiap produk yang aktif pada setiap tanggal**, termasuk hari tanpa penjualan:

- `product_id`, `date`, `units_sold`, `revenue`, `unit_cost_at_date`;
- `stock_open`, `stock_received`, `stock_close`, `stock_available_hours`, `units_discarded`;
- `batch_id`, `expiry_date`, dan jumlah stok per batch;
- `regular_price`, `actual_sale_price`, `discount_rate_applied`, `promotion_id`;
- kalender hari/libur dan indikator kampanye yang diketahui sebelum keputusan.

Pisahkan data mentah (transaksi, penerimaan, stok, promo) dari panel turunan. Simpan waktu kejadian dan waktu pencatatan agar fitur backtest hanya memakai informasi yang sudah tersedia pada tanggal keputusan. Untuk mengukur efek diskon, tentukan dulu outcome, horizon, pembanding, serta cara penugasan promo; uji acak sederhana lebih kuat daripada menyimpulkan efek dari grafik historis.

## Gerbang evaluasi

1. Bekukan target, fitur, periode train/validasi/test, dan baseline sebelum melihat test.
2. Ukur MAE/WAPE dan bias per periode serta kategori; audit minggu stok kosong secara terpisah.
3. Periksa apakah keuntungan model tetap terlihat pada beberapa periode dan cukup besar untuk keputusan bisnis.
4. Untuk kebijakan diskon, ukur **laba kotor setelah diskon dan pembuangan stok** pada kelompok pembanding yang sah. Kenaikan unit terjual saja tidak cukup.
5. Jika gagal, pertahankan baseline atau aturan informatif dan perbaiki pengumpulan data sebelum menambah kompleksitas model.
