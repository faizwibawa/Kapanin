/**
 * Request validation schemas for products (design: Routers "validate ... with
 * `zod` before touching services"; Requirement 8.1, 8.2).
 *
 * These schemas are the single source of truth for what a client may send on a
 * create/update. They mirror the DB check constraints in
 * `0002_products.sql` (cost >= 0, price >= 0, name required) so an obviously
 * bad payload is rejected with a 400 and field-level detail *before* any
 * service or database call, rather than surfacing later as a DB error.
 *
 * `owner_id` and the server-set timestamp/id fields are deliberately absent:
 * the owner is stamped from the verified JWT, never trusted from the body.
 */
import { z } from 'zod';

/**
 * Create payload. `name` is required and non-empty; `cost`/`price` are required
 * and non-negative finite numbers; `category`/`margin` are optional and may be
 * null. `.strict()` rejects unknown keys so a client cannot smuggle an
 * `owner_id` or `id` through the body.
 */
export const NewProductSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required'),
    category: z.string().trim().min(1).nullish(),
    cost: z.number().finite().min(0, 'cost must be >= 0'),
    price: z.number().finite().min(0, 'price must be >= 0'),
    margin: z.number().finite().nullish(),
  })
  .strict();

/**
 * Update payload: the same field rules, every field optional, but at least one
 * field must be present (an empty patch is a client mistake, not a no-op).
 */
export const ProductPatchSchema = z
  .object({
    name: z.string().trim().min(1, 'name must be non-empty').optional(),
    category: z.string().trim().min(1).nullish(),
    cost: z.number().finite().min(0, 'cost must be >= 0').optional(),
    price: z.number().finite().min(0, 'price must be >= 0').optional(),
    margin: z.number().finite().nullish(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'at least one field must be provided',
  });

/** Params schema: a route `:id` must be a UUID (matches the DB uuid PK). */
export const ProductIdParamSchema = z.object({
  id: z.string().uuid('id must be a valid uuid'),
});

export type NewProductInput = z.infer<typeof NewProductSchema>;
export type ProductPatchInput = z.infer<typeof ProductPatchSchema>;
