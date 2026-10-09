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
 * Sub-task 6.3 — endpoint unit/integration tests for Products.
 *
 * Validates: Requirements 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4
 *
 * `supertest` drives the REAL app from `createApp`, mounted with:
 *   - an injected LOCAL key set (tokens minted below, like the Task 4 tests) so
 *     the auth middleware verifies with no network I/O, and
 *   - an injected FAKE Supabase client so the data path is deterministic with
 *     no live database.
 * The tests cover each endpoint, zod validation failures (400 + field detail),
 * not-found (404) for get/update/delete of absent/not-owned ids, and list
 * returning only the owner's products.
 */

const ALG = 'RS256';
const KID = 'products-test-key';

let privateKey: CryptoKey;
let keySet: KeySet;

async function mintToken(sub: string, email?: string): Promise<string> {
  return new SignJWT({ sub, ...(email ? { email } : {}) })
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

/** Build an app over a fresh fake DB; returns the app and its backing db. */
function buildApp(seed?: Record<string, FakeRow[]>) {
  const db = createFakeDb(seed);
  const app = createApp(undefined, {
    authKeySet: keySet,
    supabaseClient: createFakeSupabase(db),
  });
  return { app, db };
}

const OWNER_A = '11111111-1111-1111-1111-111111111111';
const OWNER_B = '22222222-2222-2222-2222-222222222222';

describe('POST /products (Requirements 7.1, 8.1)', () => {
  it('creates a product, returns 201 and the created row stamped with the owner', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);

    const res = await request(app)
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Kopi', category: 'Minuman', cost: 10.5, price: 15 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Kopi',
      category: 'Minuman',
      cost: 10.5,
      price: 15,
      owner_id: OWNER_A,
    });
    expect(res.body.id).toBeTypeOf('string');
    expect(res.body.created_at).toBeTypeOf('string');
  });

  it('requires auth: no token => 401 and no create', async () => {
    const { app, db } = buildApp();
    const res = await request(app)
      .post('/products')
      .send({ name: 'Kopi', cost: 1, price: 2 });
    expect(res.status).toBe(401);
    expect(db.tables.get('products') ?? []).toHaveLength(0);
  });
});

describe('POST /products validation failures (Requirements 8.1, 8.2)', () => {
  it('rejects an empty name with 400 and field-level detail', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);

    const res = await request(app)
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '   ', cost: 1, price: 2 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.some((d: { path: string }) => d.path === 'name')).toBe(true);
  });

  it('rejects a negative cost with 400', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);

    const res = await request(app)
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', cost: -1, price: 2 });

    expect(res.status).toBe(400);
    expect(res.body.details.some((d: { path: string }) => d.path === 'cost')).toBe(true);
  });

  it('rejects a negative price with 400', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);

    const res = await request(app)
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', cost: 1, price: -2 });

    expect(res.status).toBe(400);
    expect(res.body.details.some((d: { path: string }) => d.path === 'price')).toBe(true);
  });

  it('rejects an unknown field (e.g. owner_id in the body) with 400', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);

    const res = await request(app)
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', cost: 1, price: 2, owner_id: OWNER_B });

    expect(res.status).toBe(400);
  });
});

describe('GET /products — list returns only the owner rows (Requirement 7.3)', () => {
  it('lists only the authenticated owner products', async () => {
    const { app } = buildApp();
    const tokenA = await mintToken(OWNER_A);
    const tokenB = await mintToken(OWNER_B);

    // Owner A creates two; owner B creates one.
    await request(app).post('/products').set('Authorization', `Bearer ${tokenA}`).send({ name: 'A1', cost: 1, price: 2 });
    await request(app).post('/products').set('Authorization', `Bearer ${tokenA}`).send({ name: 'A2', cost: 1, price: 2 });
    await request(app).post('/products').set('Authorization', `Bearer ${tokenB}`).send({ name: 'B1', cost: 1, price: 2 });

    const resA = await request(app).get('/products').set('Authorization', `Bearer ${tokenA}`);
    expect(resA.status).toBe(200);
    expect(resA.body).toHaveLength(2);
    expect(resA.body.every((p: { owner_id: string }) => p.owner_id === OWNER_A)).toBe(true);

    const resB = await request(app).get('/products').set('Authorization', `Bearer ${tokenB}`);
    expect(resB.body).toHaveLength(1);
    expect(resB.body[0].name).toBe('B1');
  });
});

describe('GET /products/:id (Requirements 7.2, 7.5, 8.2)', () => {
  it('returns an owned product by id', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);
    const created = await request(app)
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Teh', cost: 2, price: 4 });

    const res = await request(app)
      .get(`/products/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
  });

  it('returns 404 for an id owned by another owner (not-owned)', async () => {
    const { app } = buildApp();
    const tokenA = await mintToken(OWNER_A);
    const tokenB = await mintToken(OWNER_B);
    const created = await request(app)
      .post('/products')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Teh', cost: 2, price: 4 });

    const res = await request(app)
      .get(`/products/${created.body.id}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
  });

  it('returns 400 for a non-uuid id', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);
    const res = await request(app)
      .get('/products/not-a-uuid')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('returns 404 for an absent (well-formed) id', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);
    const res = await request(app)
      .get('/products/33333333-3333-3333-3333-333333333333')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /products/:id (Requirements 7.4, 7.5, 8.2)', () => {
  it('updates an owned product', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);
    const created = await request(app)
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Old', cost: 1, price: 2 });

    const res = await request(app)
      .patch(`/products/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New', price: 9 });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New');
    expect(res.body.price).toBe(9);
  });

  it('returns 404 updating another owner product', async () => {
    const { app } = buildApp();
    const tokenA = await mintToken(OWNER_A);
    const tokenB = await mintToken(OWNER_B);
    const created = await request(app)
      .post('/products')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Old', cost: 1, price: 2 });

    const res = await request(app)
      .patch(`/products/${created.body.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'Hijack' });

    expect(res.status).toBe(404);
  });

  it('returns 400 for an empty patch', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);
    const created = await request(app)
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', cost: 1, price: 2 });

    const res = await request(app)
      .patch(`/products/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid patch value (negative price)', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);
    const created = await request(app)
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', cost: 1, price: 2 });

    const res = await request(app)
      .patch(`/products/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ price: -5 });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /products/:id (Requirements 7.4, 7.5)', () => {
  it('deletes an owned product and returns 204', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);
    const created = await request(app)
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'ToDelete', cost: 1, price: 2 });

    const res = await request(app)
      .delete(`/products/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);

    const after = await request(app)
      .get(`/products/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(404);
  });

  it('returns 404 deleting another owner product and leaves it intact', async () => {
    const { app } = buildApp();
    const tokenA = await mintToken(OWNER_A);
    const tokenB = await mintToken(OWNER_B);
    const created = await request(app)
      .post('/products')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Safe', cost: 1, price: 2 });

    const res = await request(app)
      .delete(`/products/${created.body.id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);

    // Still there for owner A.
    const stillThere = await request(app)
      .get(`/products/${created.body.id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(stillThere.status).toBe(200);
  });

  it('returns 404 deleting an absent id', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);
    const res = await request(app)
      .delete('/products/44444444-4444-4444-4444-444444444444')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('error handler does not leak internals (Requirement 8.4)', () => {
  it('404 body carries only a safe error/code, no stack or internals', async () => {
    const { app } = buildApp();
    const token = await mintToken(OWNER_A);
    const res = await request(app)
      .get('/products/55555555-5555-5555-5555-555555555555')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('stack');
    expect(typeof res.body.error).toBe('string');
  });
});
