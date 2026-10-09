/**
 * Stock service (design: "Services" component; Requirements 5.2, 5.3, 6.1, 7.6).
 *
 * Follows the Products template (Task 6) exactly, applying the two rules that
 * run through every owner-scoped service:
 *
 *   1. Owner scoping (Requirement 5.3) — every query is constrained with
 *      `.eq('owner_id', ownerId)`. RLS is the authoritative backstop; the
 *      service never relies on it alone.
 *   2. Owner stamping (Requirement 5.2) — `create` merges `owner_id = ownerId`
 *      and then asserts the returned row's `owner_id === ownerId`.
 *
 * FK owner integrity (Requirement 6.1 / Property 5): a `product_id` the caller
 * does not own trips the composite FK and surfaces as a 23503, which
 * {@link mapDbError} maps to a 404 (see `dbError.ts` for the 400-vs-404
 * rationale) — nothing is written.
 *
 * The Supabase client is injected so the service is unit-testable against a
 * fake client with no live database (Requirement 10.2).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError, NotFoundError } from '../middleware/error.js';
import { isNoRows, mapDbError } from './dbError.js';
import type { StockRow, NewStock, StockPatch } from '../types/stock.js';

const TABLE = 'stock';
const COLUMNS = 'id, owner_id, product_id, quantity, stock_since, updated_at';

/** The owner-scoped CRUD contract for stock (mirrors ProductService). */
export interface StockService {
  list(ownerId: string, filter?: { productId?: string }): Promise<StockRow[]>;
  getById(ownerId: string, id: string): Promise<StockRow | null>;
  create(ownerId: string, input: NewStock): Promise<StockRow>;
  update(ownerId: string, id: string, patch: StockPatch): Promise<StockRow>;
  remove(ownerId: string, id: string): Promise<void>;
}

/** Construct a {@link StockService} bound to an injected Supabase client. */
export function createStockService(client: SupabaseClient): StockService {
  return {
    async list(ownerId: string, filter?: { productId?: string }): Promise<StockRow[]> {
      let query = client.from(TABLE).select(COLUMNS).eq('owner_id', ownerId);
      if (filter?.productId !== undefined) {
        query = query.eq('product_id', filter.productId);
      }
      const { data, error } = await query.order('updated_at', { ascending: true });

      if (error) throw mapDbError(error, 'List stock');
      return (data ?? []) as unknown as StockRow[];
    },

    async getById(ownerId: string, id: string): Promise<StockRow | null> {
      const { data, error } = await client
        .from(TABLE)
        .select(COLUMNS)
        .eq('owner_id', ownerId)
        .eq('id', id)
        .maybeSingle();

      if (error) {
        if (isNoRows(error)) return null;
        throw mapDbError(error, 'Get stock');
      }
      return (data as unknown as StockRow | null) ?? null;
    },

    async create(ownerId: string, input: NewStock): Promise<StockRow> {
      // Stamp the owner from the authenticated id (Requirement 5.2).
      const row = { ...input, owner_id: ownerId };

      const { data, error } = await client
        .from(TABLE)
        .insert(row)
        .select(COLUMNS)
        .single();

      if (error) throw mapDbError(error, 'Create stock');
      if (data === null) throw new AppError(500, 'Create stock failed', 'DB_ERROR');

      const created = data as unknown as StockRow;
      if (created.owner_id !== ownerId) {
        throw new AppError(500, 'Owner stamping invariant violated', 'OWNER_MISMATCH');
      }
      return created;
    },

    async update(ownerId: string, id: string, patch: StockPatch): Promise<StockRow> {
      const { data, error } = await client
        .from(TABLE)
        .update(patch)
        .eq('owner_id', ownerId)
        .eq('id', id)
        .select(COLUMNS)
        .maybeSingle();

      if (error) {
        if (isNoRows(error)) throw new NotFoundError('Stock not found');
        throw mapDbError(error, 'Update stock');
      }
      if (data === null) throw new NotFoundError('Stock not found');
      return data as unknown as StockRow;
    },

    async remove(ownerId: string, id: string): Promise<void> {
      const { data, error } = await client
        .from(TABLE)
        .delete()
        .eq('owner_id', ownerId)
        .eq('id', id)
        .select('id');

      if (error) throw mapDbError(error, 'Delete stock');
      if (data === null || data.length === 0) {
        throw new NotFoundError('Stock not found');
      }
    },
  };
}
