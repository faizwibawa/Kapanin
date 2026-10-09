/**
 * Sales service (design: "Services" component; Requirements 5.2, 5.3, 6.1, 7.6).
 *
 * Follows the Products template (Task 6), but sales are APPEND-ONLY: there is
 * no `update` — a recorded sale is immutable history the AI phase consumes.
 * `list`/`getById`/`create`/`remove` keep the owner-scoped pattern:
 *
 *   1. Owner scoping (Requirement 5.3) — every query is `.eq('owner_id', ...)`.
 *   2. Owner stamping (Requirement 5.2) — `create` stamps and re-asserts owner.
 *
 * FK owner integrity (Requirement 6.1 / Property 5): a `product_id` the caller
 * does not own trips the composite FK (23503) -> 404 via {@link mapDbError};
 * nothing is written.
 *
 * The client is injected for deterministic, DB-free unit tests (Requirement 10.2).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError, NotFoundError } from '../middleware/error.js';
import { mapDbError } from './dbError.js';
import type { SaleRow, NewSale } from '../types/sale.js';

const TABLE = 'sales';
const COLUMNS = 'id, owner_id, product_id, quantity, price_sold, sold_on, created_at';

/** Filter for listing sales (owner-scoped); supports product + date range. */
export interface SaleListFilter {
  productId?: string;
  from?: string;
  to?: string;
}

/** The owner-scoped contract for sales (append-only: no update). */
export interface SaleService {
  list(ownerId: string, filter?: SaleListFilter): Promise<SaleRow[]>;
  getById(ownerId: string, id: string): Promise<SaleRow | null>;
  create(ownerId: string, input: NewSale): Promise<SaleRow>;
  remove(ownerId: string, id: string): Promise<void>;
}

/** Construct a {@link SaleService} bound to an injected Supabase client. */
export function createSaleService(client: SupabaseClient): SaleService {
  return {
    async list(ownerId: string, filter?: SaleListFilter): Promise<SaleRow[]> {
      let query = client.from(TABLE).select(COLUMNS).eq('owner_id', ownerId);
      if (filter?.productId !== undefined) {
        query = query.eq('product_id', filter.productId);
      }
      if (filter?.from !== undefined) {
        query = query.gte('sold_on', filter.from);
      }
      if (filter?.to !== undefined) {
        query = query.lte('sold_on', filter.to);
      }
      const { data, error } = await query.order('sold_on', { ascending: true });

      if (error) throw mapDbError(error, 'List sales');
      return (data ?? []) as unknown as SaleRow[];
    },

    async getById(ownerId: string, id: string): Promise<SaleRow | null> {
      const { data, error } = await client
        .from(TABLE)
        .select(COLUMNS)
        .eq('owner_id', ownerId)
        .eq('id', id)
        .maybeSingle();

      if (error) {
        if (error.code === 'PGRST116') return null;
        throw mapDbError(error, 'Get sale');
      }
      return (data as unknown as SaleRow | null) ?? null;
    },

    async create(ownerId: string, input: NewSale): Promise<SaleRow> {
      const row = { ...input, owner_id: ownerId };

      const { data, error } = await client
        .from(TABLE)
        .insert(row)
        .select(COLUMNS)
        .single();

      if (error) throw mapDbError(error, 'Create sale');
      if (data === null) throw new AppError(500, 'Create sale failed', 'DB_ERROR');

      const created = data as unknown as SaleRow;
      if (created.owner_id !== ownerId) {
        throw new AppError(500, 'Owner stamping invariant violated', 'OWNER_MISMATCH');
      }
      return created;
    },

    async remove(ownerId: string, id: string): Promise<void> {
      const { data, error } = await client
        .from(TABLE)
        .delete()
        .eq('owner_id', ownerId)
        .eq('id', id)
        .select('id');

      if (error) throw mapDbError(error, 'Delete sale');
      if (data === null || data.length === 0) {
        throw new NotFoundError('Sale not found');
      }
    },
  };
}
