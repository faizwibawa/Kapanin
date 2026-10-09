/**
 * Shared helpers for tests that talk to the LIVE Supabase project (Task 5+).
 *
 * These helpers read connection details from `backend/.env` directly (the repo
 * does not depend on `dotenv`, and vitest does not auto-load `.env`). The secret
 * key is read into the Supabase client only; it is never logged or returned.
 *
 * Live tests must *skip gracefully* rather than fail when the project is not
 * configured or not reachable, so the suite stays green in environments without
 * a live backend (e.g. a fresh clone or CI without secrets). Call `getLiveEnv()`
 * and skip the suite when it returns `null`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface LiveEnv {
  readonly supabaseUrl: string;
  readonly supabaseSecretKey: string;
  /**
   * Optional anon/publishable key. Present only when the user configured one in
   * `.env`. The integration anchor and cross-owner tests (8.1/8.2) need it to
   * build a user-facing client and sign a real user in; when it is absent those
   * tests skip gracefully.
   */
  readonly supabaseAnonKey?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
// src/test-support -> backend/.env
const envPath = join(here, '..', '..', '.env');

/**
 * Parse `backend/.env` into a key/value map. Returns an empty object if the
 * file does not exist. Intentionally minimal (no interpolation / quoting) —
 * enough for the simple KEY=value lines this project uses.
 */
function parseEnvFile(): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(envPath, 'utf8');
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key !== '') out[key] = value;
  }
  return out;
}

/**
 * Return the live connection details if a real Supabase project is configured
 * (via `backend/.env` or `process.env`), otherwise `null`. A `null` result
 * means "skip the live test" — never a failure.
 */
export function getLiveEnv(): LiveEnv | null {
  const fromFile = parseEnvFile();
  const supabaseUrl = process.env.SUPABASE_URL ?? fromFile.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? fromFile.SUPABASE_SECRET_KEY;

  if (
    supabaseUrl === undefined ||
    supabaseUrl.trim() === '' ||
    supabaseSecretKey === undefined ||
    supabaseSecretKey.trim() === ''
  ) {
    return null;
  }
  // Guard against the shipped placeholder values in `.env.example`.
  if (supabaseUrl.includes('your-project-ref') || supabaseSecretKey.includes('your-supabase')) {
    return null;
  }

  // Optional anon/publishable key — enables obtaining a real user JWT in the
  // integration tests. Treated as absent when blank or a shipped placeholder.
  const anonRaw =
    process.env.SUPABASE_ANON_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    fromFile.SUPABASE_ANON_KEY ??
    fromFile.SUPABASE_PUBLISHABLE_KEY;
  const supabaseAnonKey =
    anonRaw !== undefined && anonRaw.trim() !== '' && !anonRaw.includes('your-')
      ? anonRaw.trim()
      : undefined;

  return {
    supabaseUrl: supabaseUrl.trim(),
    supabaseSecretKey: supabaseSecretKey.trim(),
    supabaseAnonKey,
  };
}

/**
 * Build a user-facing Supabase client with the anon/publishable key. Unlike the
 * service-role client, this client is subject to RLS and can call
 * `auth.signInWithPassword` to obtain a real user JWT. Returns `null` when no
 * anon key is configured, signalling the caller to skip the live auth-flow test.
 */
export function createAnonClient(env: LiveEnv): SupabaseClient | null {
  if (env.supabaseAnonKey === undefined) return null;
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Build a service-role Supabase client for the live project. */
export function createLiveClient(env: LiveEnv): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Returns true if the error looks like a transport/reachability failure (the
 * live project is down or we are offline) rather than a legitimate query error.
 * Live tests treat these as "skip", not "fail".
 */
export function isUnreachable(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('fetch failed') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('etimedout') ||
    message.includes('network') ||
    message.includes('getaddrinfo') ||
    message.includes('timeout')
  );
}
