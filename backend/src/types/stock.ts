/**
 * Stock domain types and DTOs (design: "Types" component; Requirement 3, 6, 7.6).
 *
 * TypeScript projection of the `stock` table defined in
 * `supabase/migrations/0003_stock.sql`, kept in sync with it:
 *   id uuid pk, owner_id uuid, product_id uuid not null,
 *   quantity integer >= 0, stock_since date (default current_date),
 *   updated_at timestamptz.
 *
 * As with products, three shapes separate what each layer may touch:
 *   - {@link StockRow}   — a full persisted row (service/route output).
 *   - {@link NewStock}   — client-supplied create fields. It carries
 *       `product_id` (the client picks which product) but NEVER `owner_id`:
 *       the service stamps `owner_id` from the authenticated owner
 *       (Requirement 5.2) and the DB defaults id/stock_since/updated_at.
 *   - {@link StockPatch} — a partial update; every field optional.
 *
 * `owner_id` is intentionally NOT part of `NewStock`/`StockPatch`: it is never
 * accepted from the client, only derived from the verified JWT.
 */

/** A fully-persisted stock row as returned by the database. */
export interface StockRow {
  readonly id: string;
  readonly owner_id: string;
  readonly product_id: string;
  readonly quantity: number;
  readonly stock_since: string;
  readonly updated_at: string;
}

/**
 * Fields a client may supply when creating a stock row. The server sets
 * `id`, `owner_id`, and `updated_at`; `stock_since` defaults to current_date
 * when omitted.
 */
export interface NewStock {
  readonly product_id: string;
  readonly quantity: number;
  readonly stock_since?: string;
}

/** Partial update to an existing stock row; all fields optional. */
export interface StockPatch {
  readonly quantity?: number;
  readonly stock_since?: string;
}

/** The server-set fields excluded when comparing a created vs read-back row. */
export const SERVER_SET_STOCK_FIELDS = ['id', 'owner_id', 'updated_at'] as const;
