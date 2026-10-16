import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { loadConfig } from '../config/env.js';
import { createFakeDb, createFakeSupabase } from '../test-support/fakeSupabase.js';

const ownerId = '12345678-1234-4234-8234-123456789abc';
const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'test-secret',
};

describe('shared demo API', () => {
  it('requires explicit configuration', async () => {
    const db = createFakeDb();
    const app = createApp(loadConfig(baseEnv), { supabaseClient: createFakeSupabase(db) });
    expect((await request(app).get('/demo/products')).status).toBe(404);
  });

  it('allows public writes only under the fixed demo owner', async () => {
    const db = createFakeDb();
    const app = createApp(loadConfig({ ...baseEnv, DEMO_OWNER_ID: ownerId,
      DEMO_AS_OF_DATE: '2026-10-01' }), { supabaseClient: createFakeSupabase(db) });
    const rejected = await request(app).post('/demo/products')
      .send({ name: 'Kopi Demo', category: 'Minuman', cost: 1000, price: 1500,
        owner_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    expect(rejected.status).toBe(400);
    const created = await request(app).post('/demo/products')
      .send({ name: 'Kopi Demo', category: 'Minuman', cost: 1000, price: 1500 });
    expect(created.status).toBe(201);
    expect(created.body.owner_id).toBe(ownerId);
    const listed = await request(app).get('/demo/products');
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
    expect((await request(app).get('/products')).status).toBe(401);
    expect(db.tables.get('products')?.[0].owner_id).toBe(ownerId);
  });

  it('pages the shared catalogue so all imported products remain reachable', async () => {
    const db = createFakeDb();
    const app = createApp(loadConfig({ ...baseEnv, DEMO_OWNER_ID: ownerId }),
      { supabaseClient: createFakeSupabase(db) });
    for (const name of ['A', 'B', 'C']) {
      expect((await request(app).post('/demo/products')
        .send({ name, cost: 1, price: 2 })).status).toBe(201);
    }
    const page = await request(app).get('/demo/products?limit=1&offset=1');
    expect(page.status).toBe(200);
    expect(page.body).toHaveLength(1);
    expect(page.body[0].name).toBe('B');
    expect((await request(app).get('/demo/products?limit=1001')).status).toBe(400);
  });

  it('validates demo configuration without echoing values', () => {
    expect(() => loadConfig({ ...baseEnv, DEMO_OWNER_ID: 'bad-id' })).toThrow(/DEMO_OWNER_ID/);
    expect(() => loadConfig({ ...baseEnv, DEMO_AS_OF_DATE: '2026-10-01' })).toThrow(/DEMO_OWNER_ID/);
  });
});
