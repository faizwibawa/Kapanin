/**
 * Request validation schemas for discounts (design: Routers "validate ... with
 * `zod` before touching services"; Requirements 8.1, 8.2, 3.5, 3.7).
 *
 * Mirrors the DB check constraints in `0005_discounts.sql`:
 *   percentage in (0, 100], start_date/end_date dates, end_date >= start_date.
 * An out-of-range payload is rejected with a 400 and field-level detail BEFORE
 * any service/DB call (Property 7). Discounts are append-only — no patch schema.
 *
 * `owner_id` is deliberately absent: stamped from the verified JWT, never from
 * the body (`.strict()` rejects it if smuggled).
 */
import { z } from 'zod';

/** A calendar date in ISO `YYYY-MM-DD` form (matches the Postgres `date` type). */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD form')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'must be a valid calendar date');

/**
 * Create payload. `product_id` required uuid; `percentage` in (0, 100];
 * `start_date`/`end_date` required ISO dates; a cross-field `.refine` enforces
 * `end_date >= start_date` (Requirement 3.7) at the request layer, so a
 * backwards window never reaches the DB.
 */
export const NewDiscountSchema = z
  .object({
    product_id: z.string().uuid('product_id must be a valid uuid'),
    percentage: z
      .number()
      .finite()
      .gt(0, 'percentage must be > 0')
      .max(100, 'percentage must be <= 100'),
    start_date: isoDate,
    end_date: isoDate,
  })
  .strict()
  .refine((d) => d.end_date >= d.start_date, {
    message: 'end_date must be on or after start_date',
    path: ['end_date'],
  });

/** Params schema: a route `:id` must be a UUID (matches the DB uuid PK). */
export const DiscountIdParamSchema = z.object({
  id: z.string().uuid('id must be a valid uuid'),
});

/** Query schema for list filtering (owner-scoped list for later AI use, 7.6). */
export const DiscountListQuerySchema = z
  .object({
    productId: z.string().uuid('productId must be a valid uuid').optional(),
  })
  .strict();

export type NewDiscountInput = z.infer<typeof NewDiscountSchema>;
