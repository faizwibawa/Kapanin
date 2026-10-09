/**
 * Sales domain types and DTOs (design: "Types" component; Requirement 3, 6, 7.6).
 *
 * TypeScript projection of the `sales` table defined in
 * `supabase/migrations/0004_sales.sql`, kept in sync with it:
 *   id uuid pk, owner_id uuid, product_id uuid not null,
 *   quantity integer >= 0, price_sold numeric(12,2) >= 0,
 *   sold_on date (default current_date), created_at timestamptz.
 *
 * Sales are APPEND-ONLY: the table carries `created_at` but no `updated_at`, and
 * the service exposes no update. A recorded sale is history and is not edited;
 * mistakes are handled by recording a corrective entry, not by mutation. This
 * mirrors the schema (no updated_at trigger) and keeps the sale history the AI
 * phase consumes immutable.
 *
 * `owner_id` is never accepted from the client, only derived from the verified
 * JWT (Requirement 5.2). `product_id` is client-supplied.
 */

/** A fully-persisted sale row as returned by the database. */
export interface SaleRow {
  readonly id: string;
  readonly owner_id: string;
  readonly product_id: string;
  readonly quantity: number;
  readonly price_sold: number;
  readonly sold_on: string;
  readonly created_at: string;
}

/**
 * Fields a client may supply when recording a sale. The server sets
 * `id`, `owner_id`, and `created_at`; `sold_on` defaults to current_date when
 * omitted.
 */
export interface NewSale {
  readonly product_id: string;
  readonly quantity: number;
  readonly price_sold: number;
  readonly sold_on?: string;
}

/** The server-set fields excluded when comparing a created vs read-back row. */
export const SERVER_SET_SALE_FIELDS = ['id', 'owner_id', 'created_at'] as const;
