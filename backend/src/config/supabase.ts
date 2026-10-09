import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from './env.js';

/**
 * Construct the Supabase client used by the service layer (Requirement 1.5).
 *
 * The client is built with the **server-only secret key** so it can perform
 * privileged, owner-scoped queries. That key is a sensitive credential: it is
 * read from `config` here and never logged or returned anywhere (Requirement
 * 1.6). Keeping construction behind this factory also keeps the client
 * dependency-injectable for tests (Requirement 10.2).
 *
 * The server never persists auth sessions — JWT verification happens in the
 * auth middleware against the JWKS endpoint — so session persistence and token
 * auto-refresh are disabled to keep the backend stateless.
 */
export function createSupabaseClient(config: AppConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
