import express, { type Express, type RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHealthRouter } from './routes/health.js';
import { createMeRouter } from './routes/me.js';
import { createProductsRouter } from './routes/products.js';
import { createStockRouter } from './routes/stock.js';
import { createSalesRouter } from './routes/sales.js';
import { createDiscountsRouter } from './routes/discounts.js';
import { createAuthMiddleware, type KeySet } from './middleware/auth.js';
import { errorHandler } from './middleware/error.js';
import { createProductService } from './services/products.js';
import { createStockService } from './services/stock.js';
import { createSaleService } from './services/sales.js';
import { createDiscountService } from './services/discounts.js';
import { createSupabaseClient } from './config/supabase.js';
import type { AppConfig } from './config/env.js';

/**
 * Test/injection overrides for {@link createApp}.
 *
 * `authKeySet` lets a test supply a *local* JWK resolver (built from a
 * locally-generated key pair) so the auth middleware verifies tokens with no
 * network I/O (Requirement 10.2; design "Testing Strategy"). Production passes
 * nothing and the middleware builds a cached remote JWKS from config.
 *
 * `supabaseClient` lets a test inject a *fake* Supabase client so the data
 * routes (products) run deterministically with no live database (Requirement
 * 10.2). Production passes nothing and the client is built from config via
 * `createSupabaseClient`.
 */
export interface AppOverrides {
  readonly authKeySet?: KeySet;
  readonly supabaseClient?: SupabaseClient;
}

/**
 * Minimal, allow-list CORS middleware (design "Security — CORS restricted to
 * configured origins").
 *
 * Behaviour:
 * - A request whose `Origin` is in `allowedOrigins` is answered with the
 *   matching `Access-Control-Allow-*` headers (origin echoed back, so
 *   credentials are supportable and the header is never the wildcard `*`).
 * - A request with no `Origin` header (same-origin, curl, server-to-server,
 *   health checks) is passed through untouched — CORS only governs browsers.
 * - A cross-origin request whose `Origin` is NOT allow-listed receives no
 *   `Access-Control-Allow-Origin` header, so the browser blocks the response.
 *   A non-preflight request still reaches the handler (the browser is the
 *   enforcement point); a preflight `OPTIONS` is short-circuited with `204`.
 * - When `allowedOrigins` is empty, no origin is ever allowed — the safe
 *   default for a service with no configured frontend yet.
 *
 * `Vary: Origin` is always set so caches never serve one origin's CORS decision
 * to another.
 */
export function createCorsMiddleware(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);

  return (req, res, next): void => {
    res.setHeader('Vary', 'Origin');
    const origin = req.headers.origin;

    if (typeof origin === 'string' && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET,POST,PATCH,PUT,DELETE,OPTIONS',
      );
      const requested = req.headers['access-control-request-headers'];
      res.setHeader(
        'Access-Control-Allow-Headers',
        typeof requested === 'string' && requested.length > 0
          ? requested
          : 'Authorization,Content-Type',
      );
      res.setHeader('Access-Control-Max-Age', '600');
    }

    // A preflight request carries no body and expects an immediate response.
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  };
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
 * a fully-populated environment. Protected routes (`/me`, `/products`) are only
 * mounted when a JWKS source is available: either `config.supabaseJwksUrl` or
 * an injected `overrides.authKeySet`. `server.ts` always passes a validated
 * {@link AppConfig} produced by `loadConfig`, so protected routes are live in
 * production.
 *
 * The centralized error handler is registered LAST (after all routers) so that
 * errors thrown or forwarded by any route are mapped consistently without
 * leaking internals (Requirement 8.3, 8.4).
 */
export function createApp(config?: AppConfig, overrides?: AppOverrides): Express {
  const app = express();

  // CORS first, so a cross-origin preflight is answered before any body
  // parsing or routing runs. Restricted to the configured allow-list; an empty
  // list means NO cross-origin access is granted (design "Security — CORS
  // restricted to configured origins"). Implemented inline (rather than pulling
  // in the `cors` package) because the policy is a simple origin allow-list and
  // keeping the dependency surface minimal serves the Security pillar.
  app.use(createCorsMiddleware(config?.corsOrigins ?? []));

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

    // The data routes also need a Supabase client. Prefer an injected fake
    // (tests); otherwise build the real client from config. The products
    // router is only mounted when a client is available, so a config-less
    // scaffold still boots with just /health and /me.
    const supabase =
      overrides?.supabaseClient ??
      (config !== undefined ? createSupabaseClient(config) : undefined);

    if (supabase !== undefined) {
      // Products is the template slice; stock/sales/discounts follow it (Task 7),
      // all mounted behind the same auth middleware and the same Supabase client.
      app.use(createProductsRouter(requireAuth, createProductService(supabase)));
      app.use(createStockRouter(requireAuth, createStockService(supabase)));
      app.use(createSalesRouter(requireAuth, createSaleService(supabase)));
      app.use(createDiscountsRouter(requireAuth, createDiscountService(supabase)));
    }
  }

  // Centralized error handler — MUST be last (Requirement 8.3, 8.4).
  app.use(errorHandler());

  return app;
}
