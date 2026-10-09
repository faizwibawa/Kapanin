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
 * Sub-task 8.1 — integration anchor test.
 *
 * Validates: Requirements 10.2, 10.3, 8.3
 *
 * ── What this proves ────────────────────────────────────────────────────────
 * The full Supabase-centric flow end to end, exactly as the design's
 * integration anchor describes it:
 *
 *   signup via Supabase Auth -> obtain a REAL JWT -> POST /products with the
 *   Bearer token -> GET /products returns exactly that product.
 *
 * The app under test is the REAL `createApp(config)` built from the live config,
 * so:
 *   - the auth middleware verifies the presented token against the project's
 *     LIVE JWKS (asymmetric keys) — a genuine Supabase user JWT, not a locally
 *     minted one (Requirement 10.2's "obtains a JWT");
 *   - the data routes use the real service_role Supabase client built from
 *     config, so the product round-trips through the live Postgres (Req 10.3);
 *   - a round-tripped product and a clean 404-free list confirm the error
 *     handler and status wiring are correct end to end (Requirement 8.3).
 *
 * ── Obtaining a REAL user JWT ────────────────────────────────────────────────
 * The backend's own client uses the service_role secret key, which cannot be
 * presented as a user token. To get a genuine user JWT we:
 *   1. create a confirmed user via `admin.createUser` (service_role), then
 *   2. sign that user in with an ANON/publishable-key client
 *      (`signInWithPassword`) to receive `session.access_token`.
 * That access token is the Bearer the backend verifies against JWKS.
 *
 * ── Skip-or-run (never fail on infra) ───────────────────────────────────────
 * The suite SKIPS gracefully when:
 *   - no live project is configured (`.env` missing / placeholders), OR
 *   - no anon key is configured (`SUPABASE_ANON_KEY`) — without it we cannot
 *     mint a real user JWT, so the end-to-end flow cannot be exercised, OR
 *   - the live project is unreachable.
 * Every created user/product is removed in a `finally` block.
 */

const liveEnv: LiveEnv | null = getLiveEnv();

/** Admin (service_role) client — creates/deletes users, bypasses RLS. */
let admin: SupabaseClient | null = null;
/** Anon client — signs a user in to obtain a real user JWT. */
let anon: SupabaseClient | null = null;
/** The real app, built from live config so it verifies against live JWKS. */
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

function uniqueEmail(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `kapanin-anchor-${Date.now()}-${rand}@example.com`;
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
      'no SUPABASE_ANON_KEY configured — cannot obtain a real user JWT, so the ' +
      'end-to-end auth flow cannot run. Set SUPABASE_ANON_KEY in backend/.env to enable it. Skipping';
    return;
  }
  admin = createLiveClient(liveEnv);
  anon = createAnonClient(liveEnv);
  app = createApp(liveConfig(liveEnv));
});

/**
 * Create a confirmed user and sign them in; returns the user id and a real JWT.
 * Returns `null` when the project is unreachable (caller then skips).
 */
async function makeUser(
  adminClient: SupabaseClient,
  anonClient: SupabaseClient,
): Promise<{ id: string; token: string } | null> {
  const email = uniqueEmail();
  const password = randomPassword();

  let created;
  try {
    created = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
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

describe('integration anchor: signup -> JWT -> POST /products -> GET /products (sub-task 8.1)', () => {
  it('round-trips a product through the live backend using a real user JWT', async () => {
    if (app === null || admin === null || anon === null) {
      console.warn(`[products.integration.test] ${skipReason}`);
      expect(app).toBeNull(); // explicit skip-pass marker
      return;
    }

    const user = await makeUser(admin, anon);
    if (user === null) {
      console.warn('[products.integration.test] live project unreachable — skipping');
      return;
    }

    let createdProductId: string | null = null;
    try {
      // 1. POST /products with the real Bearer token.
      const payload = { name: 'Anchor Widget', category: 'test', cost: 10, price: 25 };
      const createRes = await request(app)
        .post('/products')
        .set('Authorization', `Bearer ${user.token}`)
        .send(payload);

      expect(createRes.status).toBe(201);
      expect(createRes.body).toMatchObject(payload);
      expect(createRes.body.owner_id).toBe(user.id);
      expect(typeof createRes.body.id).toBe('string');
      createdProductId = createRes.body.id as string;

      // 2. GET /products returns exactly that one product.
      const listRes = await request(app)
        .get('/products')
        .set('Authorization', `Bearer ${user.token}`);

      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body)).toBe(true);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].id).toBe(createdProductId);
      expect(listRes.body[0].owner_id).toBe(user.id);

      // 3. GET /products/:id returns the same product (read-back).
      const getRes = await request(app)
        .get(`/products/${createdProductId}`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(createdProductId);
    } finally {
      // Delete the created product (if any) then the user (cascades anyway).
      if (admin !== null && createdProductId !== null) {
        await admin.from('products').delete().eq('id', createdProductId).catch(() => {});
      }
      if (admin !== null) {
        await admin.auth.admin.deleteUser(user.id).catch(() => {});
      }
    }
  }, 45_000);
});
