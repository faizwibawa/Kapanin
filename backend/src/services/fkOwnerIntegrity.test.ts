import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createFakeDb, createFakeSupabase, type FakeRow } from '../test-support/fakeSupabase.js';
import { createStockService } from './stock.js';
import { createSaleService } from './sales.js';
import { createDiscountService } from './discounts.js';
import { AppError } from '../middleware/error.js';

/**
 * Sub-task 7.1 — FK-owner-integrity property test (Property 5).
 *
 * Validates: Requirements 6.1
 * Properties: 5 (FK owner integrity) — for any attempt to create a
 *   stock/sale/discount referencing a `product_id` NOT owned by the caller, the
 *   operation fails (4xx) and persists nothing.
 *
 * The property runs against the SERVICES wired to the in-memory fake Supabase
 * client, which enforces the composite FK `(product_id, owner_id) ->
 * products(id, owner_id)` exactly as Postgres would: a child insert whose
 * (product_id, owner_id) has no matching products row fails with 23503 and
 * writes nothing. We seed the referenced product as owned by a DIFFERENT owner
 * (or leave it absent) and assert the create throws a 4xx AND that the child
 * table stays empty.
 */

const money = fc.integer({ min: 0, max: 9_999_999 }).map((c) => c / 100);
const date = fc
  .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31'), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

/** Two distinct owner ids and a product id for the seeded cross-owner product. */
const scenario = fc
  .tuple(fc.uuid(), fc.uuid(), fc.uuid())
  .filter(([caller, other]) => caller !== other);

function seedForeignProduct(owner: string, productId: string): Record<string, FakeRow[]> {
  return {
    products: [
      {
        id: productId,
        owner_id: owner,
        name: 'Foreign',
        category: null,
        cost: 1,
        price: 2,
        margin: null,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      },
    ],
  };
}

async function expect4xxAndNoWrite(
  table: string,
  seed: Record<string, FakeRow[]> | undefined,
  run: (client: ReturnType<typeof createFakeSupabase>, db: ReturnType<typeof createFakeDb>) => Promise<unknown>,
): Promise<void> {
  const db = createFakeDb(seed);
  const client = createFakeSupabase(db);
  let threw: unknown = null;
  try {
    await run(client, db);
  } catch (err) {
    threw = err;
  }
  // Must fail with a 4xx AppError...
  expect(threw).toBeInstanceOf(AppError);
  const status = (threw as AppError).status;
  expect(status).toBeGreaterThanOrEqual(400);
  expect(status).toBeLessThan(500);
  // ...and persist nothing in the child table.
  expect(db.tables.get(table) ?? []).toHaveLength(0);
}

describe('Property 5 — FK owner integrity (Requirement 6.1)', () => {
  it('stock create referencing a product not owned by the caller fails 4xx, writes nothing', async () => {
    await fc.assert(
      fc.asyncProperty(scenario, fc.nat(10_000), async ([caller, other, productId], qty) => {
        // product owned by `other`, created by `caller` => cross-owner reference.
        await expect4xxAndNoWrite('stock', seedForeignProduct(other, productId), (client) =>
          createStockService(client).create(caller, { product_id: productId, quantity: qty }),
        );
      }),
      { numRuns: 50 },
    );
  });

  it('sale create referencing a product not owned by the caller fails 4xx, writes nothing', async () => {
    await fc.assert(
      fc.asyncProperty(
        scenario,
        fc.nat(10_000),
        money,
        async ([caller, other, productId], qty, price) => {
          await expect4xxAndNoWrite('sales', seedForeignProduct(other, productId), (client) =>
            createSaleService(client).create(caller, {
              product_id: productId,
              quantity: qty,
              price_sold: price,
            }),
          );
        },
      ),
      { numRuns: 50 },
    );
  });

  it('discount create referencing a product not owned by the caller fails 4xx, writes nothing', async () => {
    await fc.assert(
      fc.asyncProperty(
        scenario,
        fc.integer({ min: 1, max: 100 }),
        date,
        async ([caller, other, productId], pct, start) => {
          await expect4xxAndNoWrite('discounts', seedForeignProduct(other, productId), (client) =>
            createDiscountService(client).create(caller, {
              product_id: productId,
              percentage: pct,
              start_date: start,
              end_date: start,
            }),
          );
        },
      ),
      { numRuns: 50 },
    );
  });

  it('child create referencing an ABSENT product (no products row) also fails 4xx, writes nothing', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.uuid(), fc.nat(10_000), async (caller, productId, qty) => {
        // No seed at all => the referenced product does not exist.
        await expect4xxAndNoWrite('stock', undefined, (client) =>
          createStockService(client).create(caller, { product_id: productId, quantity: qty }),
        );
      }),
      { numRuns: 50 },
    );
  });
});
