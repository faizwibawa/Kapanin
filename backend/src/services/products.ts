/**
 * Product service (design: "Services" component; Requirements 5.2, 5.3, 7).
 *
 * This is the ONLY layer that talks to the database for products, and it is the
 * reusable template that stock/sales/discounts will follow in Task 7. Two rules
 * run through every method:
 *
 *   1. Owner scoping (Requirement 5.3) — every query is constrained with
 *      `.eq('owner_id', ownerId)` as application-layer defense. RLS is the
 *      authoritative backstop, but the service never relies on it alone, so a
 *      misconfigured policy can never widen access.
 *   2. Owner stamping (Requirement 5.2) — `create` merges `owner_id = ownerId`
 *      into the row and then asserts the returned row's `owner_id === ownerId`
 *      (defense-in-depth, per the design's owner-scoped create pseudocode).
 *
 * The Supabase client is an injected dependency so the service is unit-testable
 * against a fake client with no live database (Requirement 10.2).
 */
import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import { AppError, NotFoundError } from '../middleware/error.js';
import type { Product, NewProduct, ProductPatch } from '../types/product.js';

const TABLE = 'products';

/** The owner-scoped CRUD contract (design "Representative interface"). */
export interface ProductService {
  list(ownerId: string): Promise<Product[]>;
  getById(ownerId: string, id: string): Promise<Product | null>;
  create(ownerId: string, input: NewProduct): Promise<Product>;
  update(ownerId: string, id: string, patch: ProductPatch): Promise<Product>;
  remove(ownerId: string, id: string): Promise<void>;
}

/**
 * Map a PostgrestError to an {@link AppError} with a safe, client-facing
 * message (design "Error Handling" table). The raw DB error is never forwarded
 * to the client; the error handler logs full detail for 5xx server-side only.
 *
 *   23505 unique_violation      -> 409 conflict
 *   23503 foreign_key_violation -> 400 (referenced resource not owned/absent)
 *   23514 check_violation       -> 400 (constraint, e.g. cost/price < 0)
 *   PGRST116 no rows for single  -> handled by callers as 404
 *   otherwise                    -> 500
 */
function mapDbError(error: PostgrestError, context: string): AppError {
  switch (error.code) {
    case '23505':
      return new AppError(409, 'Conflict', 'CONFLICT');
    case '23503':
      return new AppError(400, 'Referenced resource not found or not owned', 'FK_VIOLATION');
    case '23514':
      return new AppError(400, 'Value violates a constraint', 'CONSTRAINT_VIOLATION');
    default:
      // Unexpected: keep the detail server-side (the handler logs it); the
      // AppError message is generic so nothing internal leaks to the client.
      return new AppError(500, `${context} failed`, 'DB_ERROR', undefined);
  }
}

/** True when a PostgrestError signals "no rows returned by `.single()`". */
function isNoRows(error: PostgrestError): boolean {
  return error.code === 'PGRST116';
}

/** Columns selected everywhere so the shape always matches {@link Product}. */
const COLUMNS = 'id, owner_id, name, category, cost, price, margin, created_at, updated_at';

/**
 * Construct a {@link ProductService} bound to an injected Supabase client.
 *
 * Production wires `createSupabaseClient(config)`; tests inject a fake client
 * that mimics the PostgREST builder chain, so these methods run deterministically
 * with no network I/O.
 */
export function createProductService(client: SupabaseClient): ProductService {
  return {
    async list(ownerId: string): Promise<Product[]> {
      const { data, error } = await client
        .from(TABLE)
        .select(COLUMNS)
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: true });

      if (error) throw mapDbError(error, 'List products');
      return (data ?? []) as unknown as Product[];
    },

    async getById(ownerId: string, id: string): Promise<Product | null> {
      const { data, error } = await client
        .from(TABLE)
        .select(COLUMNS)
        .eq('owner_id', ownerId)
        .eq('id', id)
        .maybeSingle();

      if (error) {
        // maybeSingle() does not raise on zero rows, but guard anyway.
        if (isNoRows(error)) return null;
        throw mapDbError(error, 'Get product');
      }
      return (data as unknown as Product | null) ?? null;
    },

    async create(ownerId: string, input: NewProduct): Promise<Product> {
      // Stamp the owner from the authenticated id (Requirement 5.2); the client
      // never supplies owner_id.
      const row = { ...input, owner_id: ownerId };

      const { data, error } = await client
        .from(TABLE)
        .insert(row)
        .select(COLUMNS)
        .single();

      if (error) throw mapDbError(error, 'Create product');
      if (data === null) throw new AppError(500, 'Create product failed', 'DB_ERROR');

      const created = data as unknown as Product;
      // Defense-in-depth: the persisted row MUST belong to the owner we stamped
      // (design owner-scoped create pseudocode postcondition).
      if (created.owner_id !== ownerId) {
        throw new AppError(500, 'Owner stamping invariant violated', 'OWNER_MISMATCH');
      }
      return created;
    },

    async update(ownerId: string, id: string, patch: ProductPatch): Promise<Product> {
      const { data, error } = await client
        .from(TABLE)
        .update(patch)
        .eq('owner_id', ownerId)
        .eq('id', id)
        .select(COLUMNS)
        .maybeSingle();

      if (error) {
        if (isNoRows(error)) throw new NotFoundError('Product not found');
        throw mapDbError(error, 'Update product');
      }
      // An owner-scoped update of an absent/not-owned id matches no row and
      // returns null -> 404 (Requirement 7.5).
      if (data === null) throw new NotFoundError('Product not found');
      return data as unknown as Product;
    },

    async remove(ownerId: string, id: string): Promise<void> {
      // Select the deleted rows so we can tell "deleted" from "nothing matched"
      // (an absent/not-owned id must 404, Requirement 7.5).
      const { data, error } = await client
        .from(TABLE)
        .delete()
        .eq('owner_id', ownerId)
        .eq('id', id)
        .select('id');

      if (error) throw mapDbError(error, 'Delete product');
      if (data === null || data.length === 0) {
        throw new NotFoundError('Product not found');
      }
    },
  };
}
