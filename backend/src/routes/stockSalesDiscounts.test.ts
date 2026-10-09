import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
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
 * Sub-task 7.3 — per-resource route/service unit tests for stock/sales/discounts.
 *
 * Validates: Requirements 6.2, 7.6 (plus the shared CRUD/validation/404 pattern
 *   inherited from the Products template: 7.3, 7.4, 7.5, 8.1, 8.2).
 *
 * `supertest` drives the REAL app from `createApp`, mounted with an injected
 * LOCAL key set (no network) and an injected FAKE Supabase client (no DB). The
 * fake enforces the composite FK, so cross-owner `product_id` references are
 * rejected end to end. Each resource is seeded with its own owned product so a
 * valid create can succeed.
 *
 * Cross-owner FK decision: this project maps a 23503 FK violation on the child
 * resources to **404** ("Referenced product not found or not owned"),
 * consistent with how an absent/not-owned product id is reported elsewhere.
 */

const ALG = 'RS256';
const KID = 'ssd-test-key';
let privateKey: CryptoKey;
let keySet: KeySet;

const OWNER_A = '11111111-1111-1111-1111-111111111111';
const OWNER_B = '22222222-2222-2222-2222-222222222222';
const PRODUCT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRODUCT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

function product(id: string, owner: string): FakeRow {
  return {
    id,
    owner_id: owner,
    name: 'P',
    category: null,
    cost: 1,
    price: 2,
    margin: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };
}

/** App seeded with PRODUCT_A owned by A and PRODUCT_B owned by B. */
function buildApp() {
  const db = createFakeDb({
    products: [product(PRODUCT_A, OWNER_A), product(PRODUCT_B, OWNER_B)],
  });
  const app = createApp(undefined, {
    authKeySet: keySet,
    supabaseClient: createFakeSupabase(db),
  });
  return { app, db };
}

// ---------------------------------------------------------------------------
// STOCK
// ---------------------------------------------------------------------------
describe('Stock routes (Requirements 6.1, 6.2, 7.6)', () => {
  it('creates owner-scoped stock => 201 stamped with owner', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);
    const res = await request(app)
      .post('/stock')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: PRODUCT_A, quantity: 12, stock_since: '2024-01-01' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ product_id: PRODUCT_A, quantity: 12, owner_id: OWNER_A });
    expect(res.body.id).toBeTypeOf('string');
  });

  it('cross-owner product_id => 404 and no row written', async () => {
    const { app, db } = buildApp();
    const token = await mintToken(OWNER_A);
    // PRODUCT_B belongs to OWNER_B; A cannot reference it.
    const res = await request(app)
      .post('/stock')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: PRODUCT_B, quantity: 1 });
    expect(res.status).toBe(404);
    expect(db.tables.get('stock') ?? []).toHaveLength(0);
  });

  it('no token => 401 and no row written', async () => {
    const { app, db } = buildApp();
    const res = await request(app).post('/stock').send({ product_id: PRODUCT_A, quantity: 1 });
    expect(res.status).toBe(401);
    expect(db.tables.get('stock') ?? []).toHaveLength(0);
  });

  it('rejects a non-integer / missing field with 400', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);
    const res = await request(app)
      .post('/stock')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: PRODUCT_A, quantity: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('list is owner-scoped and filterable by productId', async () => {
    const { app } = buildApp();
    const tokenA = await mintToken(OWNER_A);
    const tokenB = await mintToken(OWNER_B);
    await request(app).post('/stock').set('Authorization', `Bearer ${tokenA}`).send({ product_id: PRODUCT_A, quantity: 1 });
    await request(app).post('/stock').set('Authorization', `Bearer ${tokenA}`).send({ product_id: PRODUCT_A, quantity: 2 });
    await request(app).post('/stock').set('Authorization', `Bearer ${tokenB}`).send({ product_id: PRODUCT_B, quantity: 9 });

    const listA = await request(app).get('/stock').set('Authorization', `Bearer ${tokenA}`);
    expect(listA.status).toBe(200);
    expect(listA.body).toHaveLength(2);
    expect(listA.body.every((r: { owner_id: string }) => r.owner_id === OWNER_A)).toBe(true);

    const filtered = await request(app)
      .get(`/stock?productId=${PRODUCT_A}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(filtered.body).toHaveLength(2);

    const listB = await request(app).get('/stock').set('Authorization', `Bearer ${tokenB}`);
    expect(listB.body).toHaveLength(1);
  });

  it('get/update/delete of an absent or not-owned id => 404', async () => {
    const { app } = buildApp();
    const tokenA = await mintToken(OWNER_A);
    const tokenB = await mintToken(OWNER_B);
    const created = await request(app)
      .post('/stock')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ product_id: PRODUCT_A, quantity: 3 });

    // not-owned
    expect((await request(app).get(`/stock/${created.body.id}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
    expect((await request(app).patch(`/stock/${created.body.id}`).set('Authorization', `Bearer ${tokenB}`).send({ quantity: 5 })).status).toBe(404);
    expect((await request(app).delete(`/stock/${created.body.id}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
    // absent
    expect((await request(app).get('/stock/33333333-3333-4333-8333-333333333333').set('Authorization', `Bearer ${tokenA}`)).status).toBe(404);
  });

  it('updates an owned stock row (quantity)', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);
    const created = await request(app)
      .post('/stock')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: PRODUCT_A, quantity: 3 });
    const res = await request(app)
      .patch(`/stock/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 7 });
    expect(res.status).toBe(200);
    expect(res.body.quantity).toBe(7);
  });

  it('deletes an owned stock row => 204 then 404', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);
    const created = await request(app)
      .post('/stock')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: PRODUCT_A, quantity: 3 });
    expect((await request(app).delete(`/stock/${created.body.id}`).set('Authorization', `Bearer ${token}`)).status).toBe(204);
    expect((await request(app).get(`/stock/${created.body.id}`).set('Authorization', `Bearer ${token}`)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// SALES (append-only: no PATCH)
// ---------------------------------------------------------------------------
describe('Sales routes (Requirements 6.1, 6.2, 7.6)', () => {
  it('creates owner-scoped sale => 201 stamped with owner', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);
    const res = await request(app)
      .post('/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: PRODUCT_A, quantity: 2, price_sold: 14.5, sold_on: '2024-02-01' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ product_id: PRODUCT_A, quantity: 2, price_sold: 14.5, owner_id: OWNER_A });
  });

  it('cross-owner product_id => 404 and no row written', async () => {
    const { app, db } = buildApp();
    const token = await mintToken(OWNER_A);
    const res = await request(app)
      .post('/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: PRODUCT_B, quantity: 1, price_sold: 1 });
    expect(res.status).toBe(404);
    expect(db.tables.get('sales') ?? []).toHaveLength(0);
  });

  it('rejects negative price_sold with 400', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);
    const res = await request(app)
      .post('/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: PRODUCT_A, quantity: 1, price_sold: -1 });
    expect(res.status).toBe(400);
  });

  it('list is owner-scoped and supports product + date-range filtering', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);
    await request(app).post('/sales').set('Authorization', `Bearer ${token}`).send({ product_id: PRODUCT_A, quantity: 1, price_sold: 5, sold_on: '2024-01-10' });
    await request(app).post('/sales').set('Authorization', `Bearer ${token}`).send({ product_id: PRODUCT_A, quantity: 1, price_sold: 5, sold_on: '2024-03-10' });

    const all = await request(app).get('/sales').set('Authorization', `Bearer ${token}`);
    expect(all.body).toHaveLength(2);

    const ranged = await request(app)
      .get('/sales?from=2024-02-01&to=2024-04-01')
      .set('Authorization', `Bearer ${token}`);
    expect(ranged.status).toBe(200);
    expect(ranged.body).toHaveLength(1);
    expect(ranged.body[0].sold_on).toBe('2024-03-10');
  });

  it('has no PATCH route (append-only) => 404 for PATCH', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);
    const created = await request(app)
      .post('/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: PRODUCT_A, quantity: 1, price_sold: 5 });
    const res = await request(app)
      .patch(`/sales/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 2 });
    expect(res.status).toBe(404);
  });

  it('delete not-owned => 404; delete owned => 204', async () => {
    const { app } = buildApp();
    const tokenA = await mintToken(OWNER_A);
    const tokenB = await mintToken(OWNER_B);
    const created = await request(app)
      .post('/sales')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ product_id: PRODUCT_A, quantity: 1, price_sold: 5 });
    expect((await request(app).delete(`/sales/${created.body.id}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
    expect((await request(app).delete(`/sales/${created.body.id}`).set('Authorization', `Bearer ${tokenA}`)).status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// DISCOUNTS (append-only: no PATCH)
// ---------------------------------------------------------------------------
describe('Discounts routes (Requirements 6.1, 6.2, 7.6)', () => {
  it('creates owner-scoped discount => 201 stamped with owner', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);
    const res = await request(app)
      .post('/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: PRODUCT_A, percentage: 25, start_date: '2024-01-01', end_date: '2024-01-31' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ product_id: PRODUCT_A, percentage: 25, owner_id: OWNER_A });
  });

  it('cross-owner product_id => 404 and no row written', async () => {
    const { app, db } = buildApp();
    const token = await mintToken(OWNER_A);
    const res = await request(app)
      .post('/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: PRODUCT_B, percentage: 10, start_date: '2024-01-01', end_date: '2024-01-02' });
    expect(res.status).toBe(404);
    expect(db.tables.get('discounts') ?? []).toHaveLength(0);
  });

  it('rejects percentage > 100 and <= 0 with 400', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);
    const over = await request(app).post('/discounts').set('Authorization', `Bearer ${token}`).send({ product_id: PRODUCT_A, percentage: 150, start_date: '2024-01-01', end_date: '2024-01-31' });
    expect(over.status).toBe(400);
    const zero = await request(app).post('/discounts').set('Authorization', `Bearer ${token}`).send({ product_id: PRODUCT_A, percentage: 0, start_date: '2024-01-01', end_date: '2024-01-31' });
    expect(zero.status).toBe(400);
  });

  it('rejects end_date < start_date with 400', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);
    const res = await request(app)
      .post('/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: PRODUCT_A, percentage: 10, start_date: '2024-02-01', end_date: '2024-01-01' });
    expect(res.status).toBe(400);
  });

  it('list is owner-scoped and filterable by productId', async () => {
    const { app } = buildApp();
    const tokenA = await mintToken(OWNER_A);
    const tokenB = await mintToken(OWNER_B);
    await request(app).post('/discounts').set('Authorization', `Bearer ${tokenA}`).send({ product_id: PRODUCT_A, percentage: 10, start_date: '2024-01-01', end_date: '2024-01-31' });
    await request(app).post('/discounts').set('Authorization', `Bearer ${tokenB}`).send({ product_id: PRODUCT_B, percentage: 20, start_date: '2024-01-01', end_date: '2024-01-31' });

    const listA = await request(app).get('/discounts').set('Authorization', `Bearer ${tokenA}`);
    expect(listA.body).toHaveLength(1);
    expect(listA.body[0].owner_id).toBe(OWNER_A);

    const filtered = await request(app).get(`/discounts?productId=${PRODUCT_A}`).set('Authorization', `Bearer ${tokenA}`);
    expect(filtered.body).toHaveLength(1);
  });

  it('delete not-owned => 404; delete owned => 204', async () => {
    const { app } = buildApp();
    const tokenA = await mintToken(OWNER_A);
    const tokenB = await mintToken(OWNER_B);
    const created = await request(app)
      .post('/discounts')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ product_id: PRODUCT_A, percentage: 10, start_date: '2024-01-01', end_date: '2024-01-31' });
    expect((await request(app).delete(`/discounts/${created.body.id}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
    expect((await request(app).delete(`/discounts/${created.body.id}`).set('Authorization', `Bearer ${tokenA}`)).status).toBe(204);
  });
});
