import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from '../app.js';
import type { AppConfig } from '../config/env.js';
import {
  getLiveEnv,
  createLiveClient,
  createAnonClient,
  isUnreachable,
  type LiveEnv,
} from '../test-support/liveSupabase.js';

/**
 * Sub-task 8.2 — cross-owner isolation integration test.
 *
 * Validates: Requirement 10.4
 *
 * ── What this proves ────────────────────────────────────────────────────────
 * Two real owners, A and B (each with a genuine Supabase user JWT). A creates a
 * product. Then, through the REAL backend:
 *   - B's `GET /products` does NOT include A's product (and, with a fresh B,
 *     returns an empty list), and
 *   - B's `GET /products/:id` for A's product returns `404`.
 *
 * Because the backend's service layer scopes every query by the authenticated
 * owner id (derived from each user's own verified JWT), one owner can never see
 * another's rows. This is the end-to-end counterpart to the Task 5 test, which
 * asserted the RLS *configuration*; here we exercise the enforcement with two
 * distinct real identities.
 *
 * ── Skip-or-run (never fail on infra) ───────────────────────────────────────
 * Skips gracefully when no live project is configured, no `SUPABASE_ANON_KEY`
 * is set (needed to mint real user JWTs), or the project is unreachable. Both
 * users and A's product are removed in a `finally` block.
 */

const liveEnv: LiveEnv | null = getLiveEnv();

let admin: SupabaseClient | null = null;
let anon: SupabaseClient | null = null;
let app: ReturnType<typeof createApp> | null = null;
let skipReason = '';

function liveConfig(env: LiveEnv): AppConfig {
  const base = env.supabaseUrl.replace(/\/+$/, '');
  return Object.freeze({
    port: 3000,
    supabaseUrl: base,
    supabaseSecretKey: env.supabaseSecretKey,
    supabaseJwksUrl: `${base}/.well-known/jwks.json`,
    supabaseAnonKey: env.supabaseAnonKey,
    nodeEnv: 'test',
    corsOrigins: Object.freeze([]),
  }) as AppConfig;
}

function uniqueEmail(tag: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `kapanin-xowner-${tag}-${Date.now()}-${rand}@example.com`;
}

function randomPassword(): string {
  return `Pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

beforeAll(() => {
  if (liveEnv === null) {
    skipReason =
      'no live Supabase project configured (.env missing or placeholder values) — skipping';
    return;
  }
  if (liveEnv.supabaseAnonKey === undefined) {
    skipReason =
      'no SUPABASE_ANON_KEY configured — cannot obtain real user JWTs for two owners. ' +
      'Set SUPABASE_ANON_KEY in backend/.env to enable it. Skipping';
    return;
  }
  admin = createLiveClient(liveEnv);
  anon = createAnonClient(liveEnv);
  app = createApp(liveConfig(liveEnv));
});

/** Create a confirmed user and sign them in; returns id + real JWT, or null if unreachable. */
async function makeUser(
  adminClient: SupabaseClient,
  anonClient: SupabaseClient,
  tag: string,
): Promise<{ id: string; token: string } | null> {
  const email = uniqueEmail(tag);
  const password = randomPassword();

  let created;
  try {
    created = await adminClient.auth.admin.createUser({ email, password, email_confirm: true });
  } catch (err) {
    if (isUnreachable(err)) return null;
    throw err;
  }
  if (created.error !== null) {
    if (isUnreachable(created.error)) return null;
    throw new Error(`admin.createUser failed: ${created.error.message}`);
  }
  const id = created.data.user?.id;
  if (id === undefined) throw new Error('created user missing id');

  let signIn;
  try {
    signIn = await anonClient.auth.signInWithPassword({ email, password });
  } catch (err) {
    if (isUnreachable(err)) {
      await adminClient.auth.admin.deleteUser(id).catch(() => {});
      return null;
    }
    throw err;
  }
  const token = signIn.data.session?.access_token;
  if (signIn.error !== null || token === undefined || token === '') {
    await adminClient.auth.admin.deleteUser(id).catch(() => {});
    throw new Error(
      `signInWithPassword failed: ${signIn.error?.message ?? 'no access_token returned'}`,
    );
  }
  return { id, token };
}

describe('cross-owner isolation: B cannot see A\'s product (sub-task 8.2)', () => {
  it('B\'s list excludes A\'s product and B\'s get-by-id for it is 404', async () => {
    if (app === null || admin === null || anon === null) {
      console.warn(`[products.crossowner.integration.test] ${skipReason}`);
      expect(app).toBeNull(); // explicit skip-pass marker
      return;
    }

    const userA = await makeUser(admin, anon, 'a');
    if (userA === null) {
      console.warn('[products.crossowner.integration.test] live project unreachable — skipping');
      return;
    }
    const userB = await makeUser(admin, anon, 'b');
    if (userB === null) {
      await admin.auth.admin.deleteUser(userA.id).catch(() => {});
      console.warn('[products.crossowner.integration.test] live project unreachable — skipping');
      return;
    }

    let productId: string | null = null;
    try {
      // A creates a product.
      const createRes = await request(app)
        .post('/products')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ name: 'A-only Widget', category: 'test', cost: 5, price: 15 });

      expect(createRes.status).toBe(201);
      expect(createRes.body.owner_id).toBe(userA.id);
      productId = createRes.body.id as string;

      // B lists products: must NOT contain A's product (fresh B => empty).
      const listB = await request(app)
        .get('/products')
        .set('Authorization', `Bearer ${userB.token}`);

      expect(listB.status).toBe(200);
      expect(Array.isArray(listB.body)).toBe(true);
      const idsVisibleToB = (listB.body as Array<{ id: string }>).map((p) => p.id);
      expect(idsVisibleToB).not.toContain(productId);
      expect(listB.body).toHaveLength(0);

      // B asks for A's product by id: 404 (absent/not-owned).
      const getB = await request(app)
        .get(`/products/${productId}`)
        .set('Authorization', `Bearer ${userB.token}`);
      expect(getB.status).toBe(404);

      // Sanity: A still sees its own product.
      const listA = await request(app)
        .get('/products')
        .set('Authorization', `Bearer ${userA.token}`);
      expect(listA.status).toBe(200);
      expect((listA.body as Array<{ id: string }>).map((p) => p.id)).toContain(productId);
    } finally {
      if (admin !== null && productId !== null) {
        await admin.from('products').delete().eq('id', productId).catch(() => {});
      }
      if (admin !== null) {
        await admin.auth.admin.deleteUser(userA.id).catch(() => {});
        await admin.auth.admin.deleteUser(userB.id).catch(() => {});
      }
    }
  }, 60_000);
});
