/**
 * Request validation schemas for stock (design: Routers "validate ... with
 * `zod` before touching services"; Requirements 8.1, 8.2, 3.4).
 *
 * These schemas mirror the DB check constraints in `0003_stock.sql`
 * (quantity integer >= 0, product_id uuid) so an out-of-range payload is
 * rejected with a 400 and field-level detail BEFORE any service/DB call
 * (Property 7 — constraint honouring at the request layer).
 *
 * `owner_id` is deliberately absent: the owner is stamped from the verified
 * JWT, never trusted from the body (`.strict()` rejects it if smuggled).
 */
import { z } from 'zod';

/** A calendar date in ISO `YYYY-MM-DD` form (matches the Postgres `date` type). */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD form')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'must be a valid calendar date');

/**
 * Create payload. `product_id` is a required uuid; `quantity` is a required
 * non-negative integer; `stock_since` is an optional ISO date (DB defaults it
 * to current_date when omitted). `.strict()` blocks unknown keys so a client
 * cannot smuggle `owner_id`/`id`.
 */
export const NewStockSchema = z
  .object({
    product_id: z.string().uuid('product_id must be a valid uuid'),
    quantity: z.number().int('quantity must be an integer').min(0, 'quantity must be >= 0'),
    stock_since: isoDate.optional(),
  })
  .strict();

/**
 * Update payload: same field rules, every field optional, at least one present.
 * `product_id` is NOT updatable — a stock row is tied to its product; moving it
 * to another product is a new row, not a patch.
 */
export const StockPatchSchema = z
  .object({
    quantity: z.number().int('quantity must be an integer').min(0, 'quantity must be >= 0').optional(),
    stock_since: isoDate.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'at least one field must be provided',
  });

/** Params schema: a route `:id` must be a UUID (matches the DB uuid PK). */
export const StockIdParamSchema = z.object({
  id: z.string().uuid('id must be a valid uuid'),
});

/** Query schema for list filtering by product (owner-scoped list, 7.6). */
export const StockListQuerySchema = z
  .object({
    productId: z.string().uuid('productId must be a valid uuid').optional(),
  })
  .strict();

export type NewStockInput = z.infer<typeof NewStockSchema>;
export type StockPatchInput = z.infer<typeof StockPatchSchema>;
