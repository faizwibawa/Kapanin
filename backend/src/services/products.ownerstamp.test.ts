import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { createProductService } from './products.js';
import { createFakeDb, createFakeSupabase } from '../test-support/fakeSupabase.js';
import type { NewProduct } from '../types/product.js';

/**
 * Sub-task 6.2 — owner-stamping property test (Property 3).
 *
 * Validates: Requirement 5.2
 * Properties: 3 (Owner stamping) — any successful create returns a row whose
 *   `owner_id` equals the authenticated owner's id.
 *
 * Two complementary checks:
 *   1. Against the in-memory fake client, over generated owner ids + inputs:
 *      the returned row's `owner_id` equals the owner passed to `create` and
 *      never the (absent) client-supplied value.
 *   2. Against an injected spy client: the row handed to `.insert()` carries
 *      `owner_id === ownerId`, proving the service stamps it rather than
 *      trusting the body.
 */

const money = fc.integer({ min: 0, max: 9_999_999 }).map((c) => c / 100);

const validNewProduct: fc.Arbitrary<NewProduct> = fc.record(
  {
    name: fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0),
    category: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
    cost: money,
    price: money,
    margin: fc.option(money, { nil: null }),
  },
  { requiredKeys: ['name', 'cost', 'price'] },
);

describe('Property 3 — owner stamping (Requirement 5.2)', () => {
  it('create returns a row whose owner_id equals the authenticated owner id', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), validNewProduct, async (ownerId, input) => {
        const db = createFakeDb();
        const service = createProductService(createFakeSupabase(db));

        const created = await service.create(ownerId, input);

        expect(created.owner_id).toBe(ownerId);
      }),
      { numRuns: 100 },
    );
  });

  it('stamps owner_id onto the inserted row even if the body tries to set another owner', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        validNewProduct,
        async (ownerId, attackerOwnerId, input) => {
          fc.pre(ownerId !== attackerOwnerId);

          // A spy client that records the inserted row and echoes it back as the
          // DB would, with owner_id taken from the inserted payload.
          const insert = vi.fn((row: Record<string, unknown>) => ({
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: {
                    id: 'generated-id',
                    created_at: '2024-01-01T00:00:00.000Z',
                    updated_at: '2024-01-01T00:00:00.000Z',
                    category: null,
                    margin: null,
                    ...row,
                  },
                  error: null,
                }),
            }),
          }));
          const spyClient = { from: vi.fn(() => ({ insert })) } as never;

          const service = createProductService(spyClient);
          // Even if a caller tried to pass owner_id, the service only forwards
          // NewProduct fields + the authenticated ownerId; simulate the attempt
          // by spreading an attacker owner into the input object.
          const tainted = { ...input, owner_id: attackerOwnerId } as NewProduct;
          const created = await service.create(ownerId, tainted);

          // The row the service asked the DB to insert carries the AUTH owner.
          const insertedRow = insert.mock.calls[0][0] as Record<string, unknown>;
          expect(insertedRow.owner_id).toBe(ownerId);
          // And the returned row's owner is the authenticated owner.
          expect(created.owner_id).toBe(ownerId);
        },
      ),
      { numRuns: 50 },
    );
  });
});
