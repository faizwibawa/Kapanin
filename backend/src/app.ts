import express, { type Express } from 'express';
import { createHealthRouter } from './routes/health.js';
import { createMeRouter } from './routes/me.js';
import { createAuthMiddleware, type KeySet } from './middleware/auth.js';
import type { AppConfig } from './config/env.js';

/**
 * Test/injection overrides for {@link createApp}.
 *
 * `authKeySet` lets a test supply a *local* JWK resolver (built from a
 * locally-generated key pair) so the auth middleware verifies tokens with no
 * network I/O (Requirement 10.2; design "Testing Strategy"). Production passes
 * nothing and the middleware builds a cached remote JWKS from config.
 */
export interface AppOverrides {
  readonly authKeySet?: KeySet;
}

/**
 * Build the Express application.
 *
 * Pure assembly: wires middleware and routers and returns the app. It does
 * NOT bind a network port — `server.ts` owns that — so the app can be
 * imported directly in tests (Requirement 10.1).
 *
 * Configuration is injected rather than loaded here (Requirement 10.2). It is
 * optional so the health-only scaffold and tests can construct the app without
 * a fully-populated environment. Protected routes (`/me`) are only mounted when
 * a JWKS source is available: either `config.supabaseJwksUrl` or an injected
 * `overrides.authKeySet`. `server.ts` always passes a validated
 * {@link AppConfig} produced by `loadConfig`, so `/me` is live in production.
 */
export function createApp(config?: AppConfig, overrides?: AppOverrides): Express {
  const app = express();

  app.use(express.json());

  // Unauthenticated routes (Requirement 9.1) — always available.
  app.use(createHealthRouter());

  // Protected routes require a JWKS source. Prefer an injected local key set
  // (tests); otherwise derive the remote JWKS from config.
  const keySet = overrides?.authKeySet;
  const jwksUrl = config?.supabaseJwksUrl;

  if (keySet !== undefined || jwksUrl !== undefined) {
    const requireAuth = createAuthMiddleware({
      // When a key set is injected, jwksUrl is unused by the middleware; fall
      // back to a syntactically-valid placeholder so construction never fails.
      jwksUrl: jwksUrl ?? 'https://invalid.local/.well-known/jwks.json',
      keySet,
    });
    app.use(createMeRouter(requireAuth));
  }

  return app;
}
