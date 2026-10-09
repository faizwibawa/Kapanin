import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import fc from 'fast-check';
import { generateKeyPair, exportJWK, createLocalJWKSet, type JSONWebKeySet } from 'jose';
import { createApp } from '../app.js';
import { createAuthMiddleware, type KeySet } from './auth.js';
import express from 'express';

/**
 * Sub-task 4.1 — auth-gate property test (Property 4).
 *
 * Validates: Requirements 2.2, 2.3, 2.4, 2.7, 9.3
 * Properties: 4 (Auth gate) — for any protected request WITHOUT a valid
 *   unexpired Bearer JWT, the response is 401 and no DB write occurs.
 *
 * We mount the real `/me` route (via `createApp`) behind the auth middleware
 * built with a LOCAL key set — no live Supabase, no network. A fake Supabase
 * client whose write methods are spies is wired to a probe route; the property
 * generates assorted invalid/missing/garbage Authorization headers and asserts
 * every response is 401 and that no write method is ever called.
 */

let keySet: KeySet;

/** A fake Supabase-like client exposing spied write methods. If the auth gate
 *  ever lets an unauthenticated request through to a handler, these spies would
 *  record a call — the property asserts they never do. */
function makeSpyClient() {
  const insert = vi.fn().mockResolvedValue({ data: null, error: null });
  const update = vi.fn().mockResolvedValue({ data: null, error: null });
  const del = vi.fn().mockResolvedValue({ data: null, error: null });
  const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const from = vi.fn(() => ({ insert, update, delete: del, upsert }));
  return { from, writes: { insert, update, del, upsert } };
}

beforeAll(async () => {
  const kp = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(kp.publicKey);
  publicJwk.kid = 'gate-key';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  const jwks: JSONWebKeySet = { keys: [publicJwk] };
  keySet = createLocalJWKSet(jwks);
});

/**
 * Build an app whose protected route would perform a DB write if ever reached.
 * The route is mounted behind the same injected-key-set middleware used by the
 * real app, so it is a faithful stand-in for "any protected route".
 */
function buildGuardedWriteApp(spyClient: ReturnType<typeof makeSpyClient>) {
  const app = express();
  app.use(express.json());
  const requireAuth = createAuthMiddleware({
    jwksUrl: 'https://unused.local/.well-known/jwks.json',
    keySet,
  });
  // A protected write endpoint: should NEVER run without a valid token.
  app.post('/guarded', requireAuth, async (req, res) => {
    await spyClient.from('products').insert({ owner_id: req.user?.id });
    res.status(201).json({ ok: true });
  });
  return app;
}

/** Generator for request shapes that all LACK a valid unexpired Bearer JWT. */
const invalidAuthArbitrary = fc.oneof(
  // No header at all.
  fc.constant<{ header?: string }>({}),
  // Empty header.
  fc.constant<{ header?: string }>({ header: '' }),
  // Wrong scheme.
  fc.string().map((s) => ({ header: `Basic ${s}` })),
  // "Bearer" with garbage that is not a valid JWT.
  fc.string().map((s) => ({ header: `Bearer ${s}` })),
  // "Bearer" with a three-segment JWT-shaped string that still fails to verify.
  fc
    .tuple(fc.string(), fc.string(), fc.string())
    .map(([a, b, c]) => ({ header: `Bearer ${a}.${b}.${c}` })),
  // Case/format variations of the scheme that must not pass startsWith("Bearer ").
  fc.constant<{ header?: string }>({ header: 'bearer sometoken' }),
  fc.constant<{ header?: string }>({ header: 'BearerNoSpace' }),
);

describe('Property 4 — auth gate: no valid JWT => 401, no DB write', () => {
  it('rejects every invalid/missing header with 401 and performs no write', async () => {
    await fc.assert(
      fc.asyncProperty(invalidAuthArbitrary, async ({ header }) => {
        const spyClient = makeSpyClient();
        const app = buildGuardedWriteApp(spyClient);

        const req = request(app).post('/guarded').send({ name: 'x' });
        if (header !== undefined) {
          req.set('Authorization', header);
        }
        const res = await req;

        expect(res.status).toBe(401);
        // No write method may ever be invoked on the failure path (Req 2.7).
        expect(spyClient.writes.insert).not.toHaveBeenCalled();
        expect(spyClient.writes.update).not.toHaveBeenCalled();
        expect(spyClient.writes.del).not.toHaveBeenCalled();
        expect(spyClient.writes.upsert).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it('the real /me route is also gated: invalid header => 401 (Requirement 9.3)', async () => {
    const app = createApp(undefined, { authKeySet: keySet });
    await fc.assert(
      fc.asyncProperty(invalidAuthArbitrary, async ({ header }) => {
        const req = request(app).get('/me');
        if (header !== undefined) {
          req.set('Authorization', header);
        }
        const res = await req;
        expect(res.status).toBe(401);
      }),
      { numRuns: 50 },
    );
  });
});
