"""Build three clean, reproducible one-store CSVs from the local BizzIT data.

Run: python3 Kapanin/scripts/prepare_benchmark_csv.py
The original benchmark files remain untouched. Added sales and stock age are synthetic.
"""

import csv
import hashlib
import random
from collections import Counter
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "example-bizzit-compfest-2025" / "data"
DESTINATION = ROOT / "Kapanin" / "data" / "store_1"
REFERENCE_DATE = date(2025, 3, 1)
END_DATE = date(2026, 9, 30)
FINAL_AS_OF = END_DATE + timedelta(days=1)
FIRST_SOURCE_DATE = date(2023, 1, 1)
LAST_SOURCE_DATE = REFERENCE_DATE - timedelta(days=1)
PRECISION = Decimal("0.000001")
STORE_COLUMNS = ["store_id", "store_name", "store_type", "opened_year"]
PRODUCT_COLUMNS = [
    "product_id", "store_id", "sku", "product_name", "category", "brand",
    "unit_cost", "list_price", "stock_on_hand", "stock_as_of_date",
    "stock_received_date", "expiry_date", "is_seasonal",
]
TRANSACTION_COLUMNS = [
    "transaction_id", "store_id", "product_id", "transaction_date", "quantity",
    "unit_list_price", "unit_sale_price", "discount_rate", "promotion_type",
    "event_name", "data_origin",
]
PROMOTION_TYPES = {
    "Tanpa Diskon": "no_discount",
    "Generic Product Discount": "standard_discount",
    "Event Based Discount": "event_discount",
    "Expired Discount": "clearance_discount",
    "Discount Perkenalan": "introductory_discount",
    "BOGO": "bogo",
}
EVENT_NAMES = {
    "Hari Biasa": "regular_day",
    "Promo Akhir Pekan": "weekend_promo",
    "Ramadan": "ramadan",
    "Natal": "christmas",
    "Tahun Baru": "new_year",
}


def read_store(filename):
    with (SOURCE / filename).open(newline="", encoding="utf-8-sig") as source:
        reader = csv.DictReader(source)
        if not reader.fieldnames or "id_toko" not in reader.fieldnames:
            raise ValueError(f"Missing id_toko in {filename}")
        return list(reader.fieldnames), [row for row in reader if row["id_toko"] == "1"]


def write_csv(filename, columns, rows):
    with (DESTINATION / filename).open("w", newline="", encoding="utf-8") as output:
        writer = csv.DictWriter(output, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def ratio(numerator, denominator):
    return str((numerator / denominator).quantize(PRECISION, rounding=ROUND_HALF_UP))


def extend_transactions(products_by_id, transactions):
    """Simulate sales after the benchmark ends, with stock and expiry limits."""
    rng = random.Random(20261016)
    historical_counts = Counter(row["id_produk"] for row in transactions)
    historical_days = (LAST_SOURCE_DATE - FIRST_SOURCE_DATE).days + 1
    stock_left = {pid: int(row["stock"]) for pid, row in products_by_id.items()}
    sold_new = Counter()
    expiry = {pid: date.fromisoformat(row["expire_date"]) for pid, row in products_by_id.items()}
    product_ids = sorted(products_by_id)
    day = REFERENCE_DATE
    weekly_promos = {}
    generated = 0

    while day <= END_DATE:
        active = [pid for pid in product_ids if expiry[pid] >= day and stock_left[pid] > 0]
        if day.weekday() == 0 or not weekly_promos:
            weekly_promos = {}
            promo_candidates = [
                pid for pid in active
                if Decimal(products_by_id[pid]["harga_jual"])
                - Decimal(products_by_id[pid]["harga_beli"]) > 100
            ]
            for pid in rng.sample(promo_candidates, k=int(len(promo_candidates) * 0.15)):
                product = products_by_id[pid]
                price = Decimal(product["harga_jual"])
                cost = Decimal(product["harga_beli"])
                options = [d for d in (5, 10, 15, 20) if price * (100 - d) / 100 >= cost + 100]
                if options:
                    weekly_promos[pid] = rng.choice(options)

        weekend_factor = 1.18 if day.weekday() >= 4 else 1.0
        season_factor = 1.12 if day.month in (6, 12) else 1.0
        for pid in active:
            promo_percent = weekly_promos.get(pid, 0)
            base_rate = historical_counts[pid] / historical_days
            probability = min(0.4, base_rate * weekend_factor * season_factor * (1 + 2.5 * promo_percent / 100))
            if rng.random() >= probability:
                continue
            product = products_by_id[pid]
            price = Decimal(product["harga_jual"])
            cost = Decimal(product["harga_beli"])
            if promo_percent:
                candidate = Decimal(round(float(price * (100 - promo_percent) / 100) / 100) * 100)
                paid = min(price, max(cost + 100, candidate))
            else:
                paid = price
            generated += 1
            stock_left[pid] -= 1
            sold_new[pid] += 1
            discount = ratio(price - paid, price)
            promo_label = "Generic Product Discount" if paid < price else "Tanpa Diskon"
            transactions.append({
                "id_produk": pid,
                "minggu": str((day - FIRST_SOURCE_DATE).days // 7 + 1),
                "tanggal_transaksi": day.isoformat(),
                "current_event": "Promo Akhir Pekan" if day.weekday() >= 4 else "Hari Biasa",
                "id_toko": "1",
                "harga_promosi": str(paid),
                "diskon": discount,
                "tipe_diskon": promo_label,
                "margin_promosi": ratio(paid - cost, paid),
                "hari_jual": str((day - date.fromisoformat(product["tanggal_stok_masuk_sintetis"])).days),
                "kedaluwarsa": str((expiry[pid] - day).days),
                "jumlah": "1",
                "harga_normal": str(price),
                "harga_promosi_sumber": "",
                "diskon_sumber": "",
                "tipe_diskon_sumber": "",
                "margin_promosi_sumber": "",
                "laba_kotor": str(paid - cost),
                "asal_data": "sintetis_2025_2026",
                "id_promo_sintetis": f"PROMO-{day - timedelta(days=day.weekday()):%Y%m%d}-{pid}" if paid < price else "",
                "hari_menuju_expire_produk": str((expiry[pid] - day).days),
            })
        day += timedelta(days=1)

    for pid, product in products_by_id.items():
        remaining = stock_left[pid]
        discarded = remaining if expiry[pid] < FINAL_AS_OF else 0
        product["stock"] = str(remaining - discarded)
        product["stock_as_of_date_asumsi"] = FINAL_AS_OF.isoformat()
        product["total_terjual_tambahan_sintetis"] = str(sold_new[pid])
        product["total_dibuang_kedaluwarsa_sintetis"] = str(discarded)
        if product["stock"] == "0":
            product["umur_stok_hari_sintetis"] = "0"
        else:
            product["umur_stok_hari_sintetis"] = str(
                (FINAL_AS_OF - date.fromisoformat(product["tanggal_stok_masuk_sintetis"])).days
            )
    return generated


def main():
    DESTINATION.mkdir(parents=True, exist_ok=True)
    product_columns, products = read_store("produk_v4.csv")
    products_by_id = {}
    for row in products:
        product_id = row["id_produk"]
        if product_id in products_by_id:
            raise ValueError(f"Duplicate product: {product_id}")
        cost, price = Decimal(row["harga_beli"]), Decimal(row["harga_jual"])
        if price <= cost or price <= 0:
            raise ValueError(f"Invalid product prices: {product_id}")
        row["margin_sumber"] = row["margin"]
        row["margin"] = ratio(price - cost, price)
        row["stock_awal_2025_03_01_sumber"] = row["stock"]
        row["asal_data"] = "benchmark"
        row["stock_as_of_date_asumsi"] = REFERENCE_DATE.isoformat()
        # No receipt date exists in the source. This stable demo date is synthetic.
        digest = hashlib.sha256(product_id.encode("utf-8")).digest()
        age = 1 + int.from_bytes(digest[:4], "big") % 180
        row["tanggal_stok_masuk_sintetis"] = (REFERENCE_DATE - timedelta(days=age)).isoformat()
        row["umur_stok_hari_sintetis"] = str(age)
        products_by_id[product_id] = row

    store_columns, stores = read_store("toko.csv")
    if len(stores) != 1:
        raise ValueError(f"Expected one store, got {len(stores)}")
    stores[0]["jumlah_sku_sumber"] = stores[0]["jumlah_sku"]
    stores[0]["jumlah_sku"] = str(len(products))
    stores[0]["nama_toko_sintetis"] = "Toko 1"
    stores[0]["tanggal_referensi_data"] = FINAL_AS_OF.isoformat()
    stores[0]["asal_data"] = "benchmark_dengan_periode_sintetis"

    transaction_columns, transactions = read_store("transaksi_v4.csv")
    for row in transactions:
        product = products_by_id.get(row["id_produk"])
        if product is None:
            raise ValueError(f"Unknown transaction product: {row['id_produk']}")
        list_price = Decimal(product["harga_jual"])
        cost = Decimal(product["harga_beli"])
        source_paid = Decimal(row["harga_promosi"])
        paid = min(source_paid, list_price)
        if paid <= 0 or paid < cost:
            raise ValueError(f"Invalid transaction price: product {row['id_produk']}")
        row["jumlah"] = "1"  # Source generator emits one unit per row.
        row["harga_normal"] = str(list_price)
        for field in ("harga_promosi", "diskon", "tipe_diskon", "margin_promosi"):
            row[f"{field}_sumber"] = row[field]
        row["harga_promosi"] = str(paid)
        row["diskon"] = ratio(list_price - paid, list_price)
        if paid == list_price:
            row["tipe_diskon"] = "Tanpa Diskon"
        row["margin_promosi"] = ratio(paid - cost, paid)
        row["laba_kotor"] = str(paid - cost)
        row["asal_data"] = "benchmark"
        row["id_promo_sintetis"] = ""
        row["hari_menuju_expire_produk"] = str((date.fromisoformat(product["expire_date"]) - date.fromisoformat(row["tanggal_transaksi"])).days)
    generated = extend_transactions(products_by_id, transactions)
    clean_stores = [{
        "store_id": row["id_toko"],
        "store_name": row["nama_toko_sintetis"],
        "store_type": row["tipe"],
        "opened_year": row["buka_sejak"],
    } for row in stores]
    clean_products = [{
        "product_id": row["id_produk"],
        "store_id": row["id_toko"],
        "sku": row["kode_sku"],
        "product_name": row["nama_produk"],
        "category": row["kategori_produk"],
        "brand": row["brand"],
        "unit_cost": row["harga_beli"],
        "list_price": row["harga_jual"],
        "stock_on_hand": row["stock"],
        "stock_as_of_date": row["stock_as_of_date_asumsi"],
        "stock_received_date": row["tanggal_stok_masuk_sintetis"],
        "expiry_date": row["expire_date"],
        "is_seasonal": row["produk_musiman"].lower(),
    } for row in products]
    clean_transactions = []
    for sequence, row in enumerate(transactions, start=1):
        if row["tipe_diskon"] not in PROMOTION_TYPES:
            raise ValueError(f"Unknown promotion type: {row['tipe_diskon']}")
        if row["current_event"] not in EVENT_NAMES:
            raise ValueError(f"Unknown event: {row['current_event']}")
        clean_transactions.append({
            "transaction_id": f"TRX{sequence:09d}",
            "store_id": row["id_toko"],
            "product_id": row["id_produk"],
            "transaction_date": row["tanggal_transaksi"],
            "quantity": row["jumlah"],
            "unit_list_price": row["harga_normal"],
            "unit_sale_price": row["harga_promosi"],
            "discount_rate": row["diskon"],
            "promotion_type": PROMOTION_TYPES[row["tipe_diskon"]],
            "event_name": EVENT_NAMES[row["current_event"]],
            "data_origin": "imported" if row["asal_data"] == "benchmark" else "generated",
        })
    write_csv("stores.csv", STORE_COLUMNS, clean_stores)
    write_csv("products.csv", PRODUCT_COLUMNS, clean_products)
    write_csv("transactions.csv", TRANSACTION_COLUMNS, clean_transactions)

    for name, rows in (("stores.csv", stores), ("products.csv", products), ("transactions.csv", transactions)):
        print(f"{name}: {len(rows):,} rows")
    print(f"New synthetic transactions: {generated:,}")


if __name__ == "__main__":
    main()
