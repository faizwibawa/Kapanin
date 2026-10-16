# Status model Kapanin

`notebooks/main.ipynb` berisi EDA, prioritas stok informatif, dan eksperimen prediksi unit terjual per kategori untuk minggu berikutnya. Eksperimen belum konsisten mengalahkan baseline sederhana, sehingga tidak dipakai oleh backend. Endpoint `GET /analytics/stock-priorities` memakai aturan transparan dari notebook, bukan inferensi model.

Data demo bersifat sintetis. Yang tersedia adalah katalog, satu snapshot stok bertanggal 2026-10-01, dan transaksi penjualan. Riwayat stok harian, penerimaan per batch, serta hasil pembuangan tidak ada. Karena itu penjualan saat stok kosong tidak dapat diartikan sebagai permintaan sebenarnya; risiko kedaluwarsa dan efek kausal diskon juga belum bisa diukur dari data ini.

Migrasi `0009_remove_unused_history.sql` menghapus tabel observasi harian, batch, dan view `product_day` yang tidak digunakan. Skema aktif tetap menyimpan harga reguler dan biaya pada transaksi untuk analisis deskriptif. Tidak ada pipeline training atau model produk harian yang direncanakan dalam implementasi backend saat ini.

Jika keputusan produk tentang model berubah kelak, kebutuhan data, baseline, dan evaluasinya perlu dirancang ulang sebelum membuat tabel baru. Hasil eksperimen lama tidak boleh ditampilkan sebagai prediksi atau rekomendasi diskon yang sudah tervalidasi.
