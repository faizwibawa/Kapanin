/**
 * Request validation schemas for sales (design: Routers "validate ... with
 * `zod` before touching services"; Requirements 8.1, 8.2, 3.4).
 *
 * Mirrors the DB check constraints in `0004_sales.sql` (quantity integer >= 0,
 * price_sold numeric >= 0, product_id uuid) so an out-of-range payload is
 * rejected with a 400 and field-level detail BEFORE any service/DB call
 * (Property 7). Sales are append-only, so there is no patch schema.
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
 * Create payload. `product_id` required uuid; `quantity` required non-negative
 * integer; `price_sold` required non-negative finite number; `sold_on` optional
 * ISO date (DB defaults current_date when omitted).
 */
export const NewSaleSchema = z
  .object({
    product_id: z.string().uuid('product_id must be a valid uuid'),
    quantity: z.number().int('quantity must be an integer').min(0, 'quantity must be >= 0'),
    price_sold: z.number().finite().min(0, 'price_sold must be >= 0'),
    sold_on: isoDate.optional(),
  })
  .strict();

/** Params schema: a route `:id` must be a UUID (matches the DB uuid PK). */
export const SaleIdParamSchema = z.object({
  id: z.string().uuid('id must be a valid uuid'),
});

/** Query schema for list filtering (owner-scoped list for later AI use, 7.6). */
export const SaleListQuerySchema = z
  .object({
    productId: z.string().uuid('productId must be a valid uuid').optional(),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be a date in YYYY-MM-DD form')
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be a date in YYYY-MM-DD form')
      .optional(),
  })
  .strict();

export type NewSaleInput = z.infer<typeof NewSaleSchema>;
