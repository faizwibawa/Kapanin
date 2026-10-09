import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fc from 'fast-check';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  createLocalJWKSet,
  type CryptoKey,
  type JSONWebKeySet,
} from 'jose';
import { createApp } from '../app.js';
import { type KeySet } from '../middleware/auth.js';
import { createFakeDb, createFakeSupabase, type FakeRow } from '../test-support/fakeSupabase.js';

/**
 * Sub-task 7.2 — constraint-honouring property test (Property 7).
 *
 * Validates: Requirements 3.4, 3.5, 3.6, 3.7
 * Properties: 7 (Constraint honouring) — for any input violating a check
 *   constraint (negative quantity, percentage outside (0,100], end_date <
 *   start_date), the create fails with a 4xx and NO row is written.
 *
 * Driven end-to-end through the REAL app (`createApp`) with an injected local
 * key set and a fake Supabase client. A valid owned product is seeded so the
 * composite FK is satisfied — this isolates the constraint failure from the FK
 * failure, proving it is the out-of-range VALUE that is rejected (400 from the
 * zod request schema, which mirrors the DB check constraints). After each
 * attempt we assert the child table stayed empty (no row written).
 */

const ALG = 'RS256';
const KID = 'constraint-test-key';
let privateKey: CryptoKey;
let keySet: KeySet;

const OWNER = '11111111-1111-1111-1111-111111111111';
const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function mintToken(sub: string): Promise<string> {
  return new SignJWT({ sub })
    .setProtectedHeader({ alg: ALG, kid: KID })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

beforeAll(async () => {
  const kp = await generateKeyPair(ALG);
  privateKey = kp.privateKey as CryptoKey;
  const publicJwk = await exportJWK(kp.publicKey);
  publicJwk.kid = KID;
  publicJwk.alg = ALG;
  publicJwk.use = 'sig';
  const jwks: JSONWebKeySet = { keys: [publicJwk] };
  keySet = createLocalJWKSet(jwks);
});

/** A product owned by OWNER so the composite FK passes; isolates constraints. */
function seedOwnedProduct(): Record<string, FakeRow[]> {
  return {
    products: [
      {
        id: PRODUCT_ID,
        owner_id: OWNER,
        name: 'P',
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

function buildApp() {
  const db = createFakeDb(seedOwnedProduct());
  const app = createApp(undefined, {
    authKeySet: keySet,
    supabaseClient: createFakeSupabase(db),
  });
  return { app, db };
}

describe('Property 7 — constraint honouring (Requirements 3.4, 3.5, 3.6, 3.7)', () => {
  it('negative stock quantity => 4xx and no stock row written', async () => {
    const token = await mintToken(OWNER);
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: -100_000, max: -1 }), async (qty) => {
        const { app, db } = buildApp();
        const res = await request(app)
          .post('/stock')
          .set('Authorization', `Bearer ${token}`)
          .send({ product_id: PRODUCT_ID, quantity: qty });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
        expect(db.tables.get('stock') ?? []).toHaveLength(0);
      }),
      { numRuns: 40 },
    );
  });

  it('negative sale quantity => 4xx and no sale row written', async () => {
    const token = await mintToken(OWNER);
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: -100_000, max: -1 }), async (qty) => {
        const { app, db } = buildApp();
        const res = await request(app)
          .post('/sales')
          .set('Authorization', `Bearer ${token}`)
          .send({ product_id: PRODUCT_ID, quantity: qty, price_sold: 10 });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
        expect(db.tables.get('sales') ?? []).toHaveLength(0);
      }),
      { numRuns: 40 },
    );
  });

  it('discount percentage outside (0, 100] => 4xx and no discount row written', async () => {
    const token = await mintToken(OWNER);
    // Generate percentages that are <= 0 OR > 100 (the two out-of-range sides).
    const outOfRangePct = fc.oneof(
      fc.integer({ min: -1000, max: 0 }),
      fc.integer({ min: 101, max: 100_000 }),
    );
    await fc.assert(
      fc.asyncProperty(outOfRangePct, async (pct) => {
        const { app, db } = buildApp();
        const res = await request(app)
          .post('/discounts')
          .set('Authorization', `Bearer ${token}`)
          .send({
            product_id: PRODUCT_ID,
            percentage: pct,
            start_date: '2024-01-01',
            end_date: '2024-01-31',
          });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
        expect(db.tables.get('discounts') ?? []).toHaveLength(0);
      }),
      { numRuns: 40 },
    );
  });

  it('discount end_date < start_date => 4xx and no discount row written', async () => {
    const token = await mintToken(OWNER);
    // Generate an ordered pair then swap so end_date is strictly before start.
    const backwardsWindow = fc
      .tuple(
        fc.date({ min: new Date('2020-01-02'), max: new Date('2030-12-31'), noInvalidDate: true }),
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-30'), noInvalidDate: true }),
      )
      .map(([a, b]) => {
        const d1 = a.toISOString().slice(0, 10);
        const d2 = b.toISOString().slice(0, 10);
        // start is the later date, end is the earlier date.
        return d1 >= d2 ? { start: d1, end: d2 } : { start: d2, end: d1 };
      })
      .filter(({ start, end }) => end < start);
    await fc.assert(
      fc.asyncProperty(backwardsWindow, async ({ start, end }) => {
        const { app, db } = buildApp();
        const res = await request(app)
          .post('/discounts')
          .set('Authorization', `Bearer ${token}`)
          .send({
            product_id: PRODUCT_ID,
            percentage: 10,
            start_date: start,
            end_date: end,
          });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
        expect(db.tables.get('discounts') ?? []).toHaveLength(0);
      }),
      { numRuns: 40 },
    );
  });
});
