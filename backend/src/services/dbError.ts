/**
 * Shared Supabase/PostgREST error mapping (design "Error Handling" table).
 *
 * The Products service (Task 6) introduced the `mapDbError` pattern inline. The
 * stock/sales/discounts services (Task 7) reuse the SAME mapping, so it lives
 * here as the single source of truth rather than being copy-pasted per service.
 * The raw DB error is never forwarded to the client; the error handler logs the
 * full detail for 5xx server-side only.
 *
 *   23505 unique_violation      -> 409 conflict
 *   23503 foreign_key_violation -> fkStatus (see below)
 *   23514 check_violation       -> 400 (e.g. quantity < 0, percentage > 100)
 *   PGRST116 no rows for single  -> handled by callers as 404
 *   otherwise                    -> 500
 *
 * Cross-owner FK decision (Requirement 6.1 / Property 5): a stock/sale/discount
 * referencing a `product_id` the caller does not own trips the composite FK
 * `(product_id, owner_id) -> products(id, owner_id)` and surfaces as 23503. The
 * design permits 400 OR 404 for this case; this project maps it to **404**
 * ("Referenced product not found or not owned"), consistent with how an
 * absent/not-owned product id is reported everywhere else — from the caller's
 * owner-scoped view, a product they do not own simply does not exist. All three
 * child resources pass `fkStatus = 404` for a uniform contract.
 */
import type { PostgrestError } from '@supabase/supabase-js';
import { AppError } from '../middleware/error.js';

/** True when a PostgrestError signals "no rows returned by `.single()`". */
export function isNoRows(error: PostgrestError): boolean {
  return error.code === 'PGRST116';
}

/**
 * Map a PostgrestError to an {@link AppError} with a safe, client-facing
 * message. `fkStatus` controls the status for a foreign-key violation (23503):
 * child resources pass 404 (referenced product not owned/absent); the base
 * Products slice historically used 400 for its own FKs.
 */
export function mapDbError(
  error: PostgrestError,
  context: string,
  fkStatus: 400 | 404 = 404,
): AppError {
  switch (error.code) {
    case '23505':
      return new AppError(409, 'Conflict', 'CONFLICT');
    case '23503':
      return new AppError(
        fkStatus,
        'Referenced product not found or not owned',
        'FK_VIOLATION',
      );
    case '23514':
      return new AppError(400, 'Value violates a constraint', 'CONSTRAINT_VIOLATION');
    default:
      return new AppError(500, `${context} failed`, 'DB_ERROR', undefined);
  }
}
