import type { RequestHandler } from 'express';
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import type { AuthenticatedUser } from '../types/express.js';

/**
 * Auth Middleware (design: "Auth Middleware" component; Requirement 2).
 *
 * Verifies the Supabase JWT presented as `Authorization: Bearer <jwt>` against
 * the project's JWKS using asymmetric keys (Requirement 2.6) and attaches the
 * authenticated owner to `req.user` (Requirement 2.1). Every failure path
 * responds `401` without calling `next()`, so no route handler runs and no
 * database write occurs for an unauthenticated request (Requirement 2.7).
 */

/** The key resolver `jose.jwtVerify` consumes. */
export type KeySet = JWTVerifyGetKey;

/**
 * Dependencies for {@link createAuthMiddleware}.
 *
 * `jwksUrl` is the remote JWKS endpoint used to build the default resolver. The
 * optional `keySet` makes the key source injectable: production passes nothing
 * and gets a cached remote JWKS, while tests inject a *local* key set built
 * from a locally-generated key pair so verification runs with zero network I/O
 * (Testability pillar; design "Testing Strategy").
 */
export interface AuthMiddlewareDeps {
  readonly jwksUrl: string;
  readonly keySet?: KeySet;
}

/** Consistent, internal-free 401 body (design "Error responses never leak internals"). */
function unauthorized(message: string): { error: string } {
  return { error: message };
}

/**
 * Build the JWT-verification middleware.
 *
 * The default key resolver is `jose`'s `createRemoteJWKSet`, which fetches the
 * JWKS lazily and caches it (~10 minutes), so a valid token costs no network
 * round-trip within the cache window and a rotated key triggers at most one
 * refetch (design "Cache invariant"). Tests override `deps.keySet`.
 */
export function createAuthMiddleware(deps: AuthMiddlewareDeps): RequestHandler {
  // Resolve the key set once at construction. The remote set self-caches, so a
  // single instance is correct and avoids a new fetcher per request.
  const keySet: KeySet = deps.keySet ?? createRemoteJWKSet(new URL(deps.jwksUrl));

  return async (req, res, next): Promise<void> => {
    const header = req.headers.authorization;

    // Missing header or wrong scheme -> 401, no next() (Requirement 2.2).
    if (header === undefined || !header.startsWith('Bearer ')) {
      res.status(401).json(unauthorized('Missing bearer token'));
      return;
    }

    const token = header.slice('Bearer '.length).trim();

    let payload: JWTPayload;
    try {
      // jwtVerify checks the signature against the JWKS and enforces `exp`,
      // so malformed tokens, bad signatures, and expired tokens all throw
      // (Requirements 2.3, 2.4, 2.6).
      ({ payload } = await jwtVerify(token, keySet));
    } catch {
      // Never surface the underlying verification error to the client.
      res.status(401).json(unauthorized('Invalid or expired token'));
      return;
    }

    // A verified token still must carry a subject (Requirement 2.5).
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      res.status(401).json(unauthorized('Token missing subject'));
      return;
    }

    const email = typeof payload.email === 'string' ? payload.email : undefined;
    const user: AuthenticatedUser = { id: payload.sub, email };
    req.user = user;

    next();
  };
}
