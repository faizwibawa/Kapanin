# Kapanin prototype dataset: one store

These three CSVs use English `snake_case` column names and a single store.
Rebuild them with `python3 Kapanin/scripts/prepare_benchmark_csv.py` from the
workspace root. The source files in `example-bizzit-compfest-2025/data/` are
untouched.

| File | Grain | Rows | Key |
| --- | --- | ---: | --- |
| `stores.csv` | one store | 1 | `store_id` |
| `products.csv` | one product | 6,843 | `product_id` |
| `transactions.csv` | one unit sold | 209,929 | `transaction_id` |

All records have `store_id = 1`. The transaction date range is 2023-01-01
through 2026-09-30. The 125,043 rows through 2025-02-28 come from the BizzIT
benchmark; the 84,886 later rows are generated dummy transactions. Use
`transactions.data_origin` to distinguish `imported` from `generated`.
The benchmark itself was also generated synthetically in its notebook.

## Columns

### `stores.csv`

| Column | Meaning |
| --- | --- |
| `store_id` | Store identifier; joins the three files. |
| `store_name` | Demo name. |
| `store_type` | Source store type. |
| `opened_year` | Source opening year. |

### `products.csv`

| Column | Meaning |
| --- | --- |
| `product_id`, `store_id`, `sku` | Product and store identifiers. |
| `product_name`, `category`, `brand` | Catalogue attributes. |
| `unit_cost`, `list_price` | Source unit cost and regular price in IDR. |
| `stock_on_hand` | Simulated remaining stock on `stock_as_of_date`. |
| `stock_as_of_date` | 2026-10-01 for this dataset. |
| `stock_received_date` | Date the current stock is treated as received in the prototype data. This date is generated, not taken from an actual receipt record. |
| `expiry_date` | Product expiry date from the source. |
| `is_seasonal` | Source seasonal flag (`true`/`false`). |

### `transactions.csv`

| Column | Meaning |
| --- | --- |
| `transaction_id` | Generated unique row ID in the form `TRX000000001`; the source has no transaction ID. |
| `store_id`, `product_id` | Foreign keys to store and product. |
| `transaction_date` | Date of sale. |
| `quantity` | Always 1: a source row represents one unit sold. |
| `unit_list_price`, `unit_sale_price` | Regular and realized unit prices in IDR. |
| `discount_rate` | Actual `(unit_list_price - unit_sale_price) / unit_list_price`; `0.10` means 10%. |
| `promotion_type` | `no_discount`, `standard_discount`, `event_discount`, `clearance_discount`, `introductory_discount`, or `bogo`. |
| `event_name` | `regular_day`, `weekend_promo` (Friday–Sunday), `ramadan`, `christmas`, or `new_year`. |
| `data_origin` | `imported` or `generated`. Both groups are synthetic data for this prototype. |

## Generation and limits

The source benchmark sometimes records a nominal discount different from the
price actually paid. The export computes `discount_rate` from prices, caps 80
source sale prices above the regular price, and labels zero actual discount as
`no_discount`. Original source values remain in the untouched benchmark files.

The extension uses a fixed random seed. Product sale probabilities follow
their source sales frequency, with Friday–Sunday, seasonal, and weekly promo
effects. It never sells an expired or out-of-stock product. There are no new
products or restocks: stock is reduced by simulated sales, then expired stock
is treated as discarded. This makes the active catalogue and monthly volume
decline toward September 2026; that decline is an assumption of the generator.

There is **no daily stock history**. `stock_on_hand` describes only
2026-10-01 and must not be joined onto historical transaction dates as though
it were stock on those dates. Missing transaction rows also cannot prove zero
demand because historical availability is unknown. Do not use this synthetic
dataset as evidence that a discount policy works in a real store.

## Mapping to the current Kapanin backend

The notebook projects these CSVs into the current Supabase table shapes in
memory. It does not create another copy of the synthetic dataset.

| Backend field | CSV source | Note |
| --- | --- | --- |
| `products.id/name/category/cost/price` | `products.product_id/product_name/category/unit_cost/list_price` | CSV IDs are demo strings, not backend UUIDs. |
| `stock.product_id/quantity/stock_since` | `products.product_id/stock_on_hand/stock_received_date` | The CSV has one stock snapshot per product. `stock_since` is simulated. |
| `sales.product_id/quantity/price_sold/sold_on` | `transactions.product_id/quantity/unit_sale_price/transaction_date` | Sale price is per unit. |

The snapshot date comes from `stock_as_of_date` in this benchmark. A live
backend request should use an explicit as-of date for its current stock read.
The current backend has no `expiry_date`, historical stock snapshots, or
transaction-level regular price. Discount windows cannot be reliably
reconstructed from individual discounted sale rows. Thus the notebook's
expiry and discount charts are benchmark-only exploration; the backend-ready
priority calculation uses only products, current stock, and sales.
