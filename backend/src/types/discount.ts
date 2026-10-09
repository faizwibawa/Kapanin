/**
 * Discounts domain types and DTOs (design: "Types" component; Requirement 3, 6, 7.6).
 *
 * TypeScript projection of the `discounts` table defined in
 * `supabase/migrations/0005_discounts.sql`, kept in sync with it:
 *   id uuid pk, owner_id uuid, product_id uuid not null,
 *   percentage numeric in (0, 100], start_date date not null,
 *   end_date date not null (end_date >= start_date), created_at timestamptz.
 *
 * Discounts are APPEND-ONLY: the table carries `created_at` but no
 * `updated_at`, and the service exposes no update — a discount window, once
 * recorded, is part of the pricing history the AI phase reasons over. A changed
 * plan is a new discount row, not a mutation.
 *
 * `owner_id` is never accepted from the client, only derived from the verified
 * JWT (Requirement 5.2). `product_id` is client-supplied.
 */

/** A fully-persisted discount row as returned by the database. */
export interface DiscountRow {
  readonly id: string;
  readonly owner_id: string;
  readonly product_id: string;
  readonly percentage: number;
  readonly start_date: string;
  readonly end_date: string;
  readonly created_at: string;
}

/**
 * Fields a client may supply when creating a discount. The server sets
 * `id`, `owner_id`, and `created_at`.
 */
export interface NewDiscount {
  readonly product_id: string;
  readonly percentage: number;
  readonly start_date: string;
  readonly end_date: string;
}

/** The server-set fields excluded when comparing a created vs read-back row. */
export const SERVER_SET_DISCOUNT_FIELDS = ['id', 'owner_id', 'created_at'] as const;
