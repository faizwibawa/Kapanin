/**
 * Discounts service (design: "Services" component; Requirements 5.2, 5.3, 6.1, 7.6).
 *
 * Follows the Products template (Task 6); discounts are APPEND-ONLY like sales
 * (no `update`) — a discount window is pricing history, not a mutable record.
 * `list`/`getById`/`create`/`remove` keep the owner-scoped pattern:
 *
 *   1. Owner scoping (Requirement 5.3) — every query is `.eq('owner_id', ...)`.
 *   2. Owner stamping (Requirement 5.2) — `create` stamps and re-asserts owner.
 *
 * Constraint honouring (Requirement 3.5, 3.7 / Property 7): percentage in
 * (0, 100] and end_date >= start_date are enforced first by the zod request
 * schema (400) and, as a backstop, by the DB check constraints (23514 -> 400).
 *
 * FK owner integrity (Requirement 6.1 / Property 5): a `product_id` the caller
 * does not own trips the composite FK (23503) -> 404 via {@link mapDbError}.
 *
 * The client is injected for deterministic, DB-free unit tests (Requirement 10.2).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError, NotFoundError } from '../middleware/error.js';
import { mapDbError } from './dbError.js';
import type { DiscountRow, NewDiscount } from '../types/discount.js';

const TABLE = 'discounts';
const COLUMNS = 'id, owner_id, product_id, percentage, start_date, end_date, created_at';

/** The owner-scoped contract for discounts (append-only: no update). */
export interface DiscountService {
  list(ownerId: string, filter?: { productId?: string }): Promise<DiscountRow[]>;
  getById(ownerId: string, id: string): Promise<DiscountRow | null>;
  create(ownerId: string, input: NewDiscount): Promise<DiscountRow>;
  remove(ownerId: string, id: string): Promise<void>;
}

/** Construct a {@link DiscountService} bound to an injected Supabase client. */
export function createDiscountService(client: SupabaseClient): DiscountService {
  return {
    async list(ownerId: string, filter?: { productId?: string }): Promise<DiscountRow[]> {
      let query = client.from(TABLE).select(COLUMNS).eq('owner_id', ownerId);
      if (filter?.productId !== undefined) {
        query = query.eq('product_id', filter.productId);
      }
      const { data, error } = await query.order('start_date', { ascending: true });

      if (error) throw mapDbError(error, 'List discounts');
      return (data ?? []) as unknown as DiscountRow[];
    },

    async getById(ownerId: string, id: string): Promise<DiscountRow | null> {
      const { data, error } = await client
        .from(TABLE)
        .select(COLUMNS)
        .eq('owner_id', ownerId)
        .eq('id', id)
        .maybeSingle();

      if (error) {
        if (error.code === 'PGRST116') return null;
        throw mapDbError(error, 'Get discount');
      }
      return (data as unknown as DiscountRow | null) ?? null;
    },

    async create(ownerId: string, input: NewDiscount): Promise<DiscountRow> {
      const row = { ...input, owner_id: ownerId };

      const { data, error } = await client
        .from(TABLE)
        .insert(row)
        .select(COLUMNS)
        .single();

      if (error) throw mapDbError(error, 'Create discount');
      if (data === null) throw new AppError(500, 'Create discount failed', 'DB_ERROR');

      const created = data as unknown as DiscountRow;
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

      if (error) throw mapDbError(error, 'Delete discount');
      if (data === null || data.length === 0) {
        throw new NotFoundError('Discount not found');
      }
    },
  };
}
