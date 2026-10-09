import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createProductService } from './products.js';
import { createFakeDb, createFakeSupabase } from '../test-support/fakeSupabase.js';
import { SERVER_SET_PRODUCT_FIELDS, type NewProduct, type Product } from '../types/product.js';

/**
 * Sub-task 6.1 — create/read round-trip property test (Property 2).
 *
 * Validates: Requirements 7.1, 7.2
 * Properties: 2 (Create/read round-trip) — for any valid product input `p`,
 *   getById(owner, create(owner, p).id) deep-equals the created row modulo the
 *   server-set fields (id, owner_id, created_at, updated_at).
 *
 * The property runs against the SERVICE wired to an in-memory fake Supabase
 * client, so it is deterministic and needs no live database. `fast-check`
 * generates valid product inputs; a monetary generator keeps cost/price to two
 * decimals and >= 0 to match the schema/DB constraints.
 */

/** A non-negative money value with at most two decimals (matches numeric(12,2)). */
const money = fc
  .integer({ min: 0, max: 9_999_999 })
  .map((cents) => Math.round(cents) / 100);

const validNewProduct: fc.Arbitrary<NewProduct> = fc.record(
  {
    name: fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0),
    category: fc.option(fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0), {
      nil: null,
    }),
    cost: money,
    price: money,
    margin: fc.option(money, { nil: null }),
  },
  { requiredKeys: ['name', 'cost', 'price'] },
);

/** Strip server-set fields so we compare only the client-supplied payload. */
function withoutServerFields(row: Product): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...row };
  for (const field of SERVER_SET_PRODUCT_FIELDS) {
    delete copy[field];
  }
  return copy;
}

describe('Property 2 — create/read round-trip (Requirements 7.1, 7.2)', () => {
  it('getById returns a row deep-equal to the created row (modulo server fields)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), validNewProduct, async (ownerId, input) => {
        const db = createFakeDb();
        const service = createProductService(createFakeSupabase(db));

        const created = await service.create(ownerId, input);
        const read = await service.getById(ownerId, created.id);

        // The product exists and is the same row.
        expect(read).not.toBeNull();
        // Full created vs read-back equality (all fields, including server-set).
        expect(read).toEqual(created);
        // And the client-supplied fields survived the round-trip unchanged
        // (Requirement 7.2: equal apart from server-set fields).
        expect(withoutServerFields(read as Product)).toEqual(withoutServerFields(created));
      }),
      { numRuns: 100 },
    );
  });
});
