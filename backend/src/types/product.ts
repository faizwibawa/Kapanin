/**
 * Product domain types and DTOs (design: "Types" component; Requirement 7).
 *
 * These types are the TypeScript projection of the `products` table defined in
 * `supabase/migrations/0002_products.sql` and are kept in sync with it:
 *   id uuid pk, owner_id uuid, name text not null, category text (nullable),
 *   cost numeric >= 0, price numeric >= 0, margin numeric (nullable),
 *   created_at timestamptz, updated_at timestamptz.
 *
 * Three shapes are distinguished so each layer only sees what it may touch:
 *   - {@link Product}      — a full persisted row (service/route output).
 *   - {@link NewProduct}   — the client-supplied fields for a create. It omits
 *       every server-set field (id, owner_id, created_at, updated_at): the
 *       service stamps `owner_id` from the authenticated owner (Requirement 5.2)
 *       and the database defaults the rest.
 *   - {@link ProductPatch} — a partial update; every field optional.
 *
 * `owner_id` is intentionally NOT part of `NewProduct`/`ProductPatch`: it is
 * never accepted from the client, only derived from the verified JWT.
 */

/** A fully-persisted product row as returned by the database. */
export interface Product {
  readonly id: string;
  readonly owner_id: string;
  readonly name: string;
  readonly category: string | null;
  readonly cost: number;
  readonly price: number;
  readonly margin: number | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Fields a client may supply when creating a product. The server sets
 * `id`, `owner_id`, `created_at`, and `updated_at`.
 */
export interface NewProduct {
  readonly name: string;
  readonly category?: string | null;
  readonly cost: number;
  readonly price: number;
  readonly margin?: number | null;
}

/** Partial update to an existing product; all fields optional. */
export interface ProductPatch {
  readonly name?: string;
  readonly category?: string | null;
  readonly cost?: number;
  readonly price?: number;
  readonly margin?: number | null;
}

/** The server-set fields excluded when comparing a created vs read-back row. */
export const SERVER_SET_PRODUCT_FIELDS = [
  'id',
  'owner_id',
  'created_at',
  'updated_at',
] as const;
