import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  createLocalJWKSet,
  type CryptoKey,
  type JSONWebKeySet,
} from 'jose';
import { createAuthMiddleware, type KeySet } from './auth.js';

/**
 * Sub-task 4.2 — auth middleware unit tests across token states.
 *
 * Validates: Requirements 2.1, 2.5, 2.6, 9.2
 *
 * Everything runs with LOCALLY-signed test keys and a stubbed (local) JWKS
 * built via `createLocalJWKSet` — no live Supabase and no network I/O. We
 * generate an RS256 key pair once, mint tokens with `SignJWT`, and inject the
 * local key set into the middleware via `deps.keySet`.
 */

const ALG = 'RS256';
const KID = 'test-key-1';
const ISSUER = 'https://proj-ref.supabase.co/auth/v1';

let privateKey: CryptoKey;
let keySet: KeySet;
/** A second, unrelated key pair used to forge a bad-signature token. */
let foreignPrivateKey: CryptoKey;

/** Mint a signed JWT with the local private key; override claims as needed. */
async function mintToken(
  payload: Record<string, unknown>,
  opts: { signer?: CryptoKey; expiresIn?: string; setExp?: number } = {},
): Promise<string> {
  const jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: ALG, kid: KID })
    .setIssuedAt()
    .setIssuer(ISSUER);

  if (opts.setExp !== undefined) {
    jwt.setExpirationTime(opts.setExp);
  } else {
    jwt.setExpirationTime(opts.expiresIn ?? '1h');
  }

  return jwt.sign(opts.signer ?? privateKey);
}

/** Build a tiny app that mounts only the middleware and a probe route that
 *  echoes `req.user`, so we can assert both the status and the attached user. */
function buildProbeApp(ks: KeySet): Express {
  const app = express();
  const requireAuth = createAuthMiddleware({
    jwksUrl: 'https://unused.local/.well-known/jwks.json',
    keySet: ks,
  });
  app.get('/probe', requireAuth, (req, res) => {
    res.status(200).json({ user: req.user });
  });
  return app;
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

  const foreign = await generateKeyPair(ALG);
  foreignPrivateKey = foreign.privateKey as CryptoKey;
});

describe('auth middleware — valid token (Requirements 2.1, 2.6, 9.2)', () => {
  it('passes and populates req.user.id from the sub claim', async () => {
    const token = await mintToken({ sub: 'owner-123', email: 'owner@example.com' });
    const res = await request(buildProbeApp(keySet))
      .get('/probe')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: 'owner-123', email: 'owner@example.com' });
  });

  it('propagates no email when the token omits it', async () => {
    const token = await mintToken({ sub: 'owner-456' });
    const res = await request(buildProbeApp(keySet))
      .get('/probe')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('owner-456');
    expect(res.body.user.email).toBeUndefined();
  });
});

describe('auth middleware — rejection states (Requirements 2.2-2.5)', () => {
  it('rejects a missing Authorization header with 401', async () => {
    const res = await request(buildProbeApp(keySet)).get('/probe');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('rejects a non-Bearer scheme with 401', async () => {
    const res = await request(buildProbeApp(keySet))
      .get('/probe')
      .set('Authorization', 'Basic dXNlcjpwYXNz');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed token with 401', async () => {
    const res = await request(buildProbeApp(keySet))
      .get('/probe')
      .set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
  });

  it('rejects a token signed by an unknown key (bad signature) with 401', async () => {
    const token = await mintToken(
      { sub: 'owner-789' },
      { signer: foreignPrivateKey },
    );
    const res = await request(buildProbeApp(keySet))
      .get('/probe')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects an expired token with 401', async () => {
    // exp set to a fixed point in the past.
    const token = await mintToken({ sub: 'owner-exp' }, { setExp: 1_000_000 });
    const res = await request(buildProbeApp(keySet))
      .get('/probe')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects a verified token with no sub claim with 401', async () => {
    const token = await mintToken({ email: 'nosub@example.com' });
    const res = await request(buildProbeApp(keySet))
      .get('/probe')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('does not leak internals in the 401 body', async () => {
    const res = await request(buildProbeApp(keySet))
      .get('/probe')
      .set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
    // Only a short, generic error string — no stack, no token, no key detail.
    expect(Object.keys(res.body)).toEqual(['error']);
    expect(typeof res.body.error).toBe('string');
  });
});
