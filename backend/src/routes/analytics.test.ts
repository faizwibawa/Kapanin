import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type CryptoKey } from 'jose';
import { createApp } from '../app.js';
import { createFakeDb, createFakeSupabase, type FakeRow } from '../test-support/fakeSupabase.js';
import { calculateStockPriorities, createAnalyticsService } from '../services/analytics.js';

const OWNER_A = '11111111-1111-1111-1111-111111111111';
const OWNER_B = '22222222-2222-2222-2222-222222222222';
const P_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TS = '2024-02-01T00:00:00.000Z';
let privateKey: CryptoKey;
let keySet: ReturnType<typeof createLocalJWKSet>;

function row(id: string, owner_id: string, extra: Record<string, unknown>): FakeRow {
  return { id, owner_id, created_at: TS, updated_at: TS, ...extra };
}

beforeAll(async () => {
  const keys = await generateKeyPair('RS256');
  privateKey = keys.privateKey as CryptoKey;
  const jwk = await exportJWK(keys.publicKey);
  Object.assign(jwk, { kid: 'analytics-test', alg: 'RS256', use: 'sig' });
  keySet = createLocalJWKSet({ keys: [jwk] });
});

async function token(owner: string) {
  return new SignJWT({ sub: owner })
    .setProtectedHeader({ alg: 'RS256', kid: 'analytics-test' })
    .setIssuedAt().setExpirationTime('1h').sign(privateKey);
}

describe('stock priorities', () => {
  it('matches notebook grouping and cost ordering', () => {
    const result = calculateStockPriorities(
      [{ id: P_A, name: 'A', category: null, cost: '12.50' }, { id: P_B, name: 'B', category: null, cost: 5 }],
      [{ product_id: P_A, quantity: 4 }, { product_id: P_A, quantity: 3 }, { product_id: P_B, quantity: 10 }],
      [{ product_id: P_A, quantity: 2, sold_on: '2024-01-31' }],
    );
    expect(result.map(item => item.priority_group)).toEqual(['no_sales_28d', 'cover_gt_90d']);
    expect(result[1]).toMatchObject({ stock_quantity: 7, units_sold_28d: 2, days_of_cover: 98, remaining_28d_proxy: 5, tied_cost_28d_proxy: 62.5 });
  });

  it('limits to the owner and 28 completed days, including all database pages', async () => {
    const sales = Array.from({ length: 501 }, (_, i) => row(`sale-${String(i).padStart(4, '0')}`, OWNER_A,
      { product_id: P_A, quantity: 1, sold_on: '2024-01-31' }));
    sales.push(row('before', OWNER_A, { product_id: P_A, quantity: 100, sold_on: '2024-01-03' }));
    sales.push(row('today', OWNER_A, { product_id: P_A, quantity: 100, sold_on: '2024-02-01' }));
    sales.push(row('other', OWNER_B, { product_id: P_C, quantity: 100, sold_on: '2024-01-31' }));
    const db = createFakeDb({
      products: [
        row(P_A, OWNER_A, { name: 'A', category: 'food', cost: 10 }),
        row(P_B, OWNER_A, { name: 'B', category: 'food', cost: 5 }),
        row(P_C, OWNER_B, { name: 'C', category: 'food', cost: 100 }),
      ],
      stock: [
        row('stock-a1', OWNER_A, { product_id: P_A, quantity: 300 }),
        row('stock-a2', OWNER_A, { product_id: P_A, quantity: 300 }),
        row('stock-b', OWNER_A, { product_id: P_B, quantity: 4 }),
        row('stock-c', OWNER_B, { product_id: P_C, quantity: 100 }),
      ], sales,
    });
    const service = createAnalyticsService(createFakeSupabase(db), () => '2024-02-01');
    const result = await service.stockPriorities(OWNER_A, 1, 0);
    expect(result).toMatchObject({ as_of_date: '2024-02-01', window_start: '2024-01-04', total: 2 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ product_id: P_B, priority_group: 'no_sales_28d' });
    const second = await service.stockPriorities(OWNER_A, 1, 1);
    expect(second.items[0]).toMatchObject({ product_id: P_A, stock_quantity: 600, units_sold_28d: 501 });

    const app = createApp(undefined, { authKeySet: keySet, supabaseClient: createFakeSupabase(db) });
    expect((await request(app).get('/analytics/stock-priorities')).status).toBe(401);
    const owned = await request(app).get('/analytics/stock-priorities?limit=1&offset=0')
      .set('Authorization', `Bearer ${await token(OWNER_A)}`);
    expect(owned.status).toBe(200);
    expect(owned.body.total).toBe(2);
    expect(owned.body.items).toHaveLength(1);
    expect(owned.body.items[0].product_id).not.toBe(P_C);
    const authed = await request(app).get('/analytics/stock-priorities?limit=0').set('Authorization', `Bearer ${await token(OWNER_A)}`);
    expect(authed.status).toBe(400);
  });
});
