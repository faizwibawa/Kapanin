/**
 * Typed environment configuration (Requirement 1).
 *
 * `loadConfig` parses and validates the process environment once at startup so
 * the service can fail fast on misconfiguration (Requirement 1.4) rather than
 * crashing later with an opaque error. It is deliberately pure: it performs no
 * I/O and never mutates the environment object it is handed (Requirement 1.3),
 * which also makes it trivially unit-testable against synthetic env maps.
 */

/** Allowed values for `NODE_ENV`. */
export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

/**
 * Validated, immutable application configuration.
 *
 * `supabaseSecretKey` is a server-only privileged credential: it must never be
 * logged or returned in an HTTP response (Requirement 1.6).
 */
export interface AppConfig {
  readonly port: number;
  readonly supabaseUrl: string;
  readonly supabaseSecretKey: string;
  readonly supabaseJwksUrl: string;
  readonly nodeEnv: NodeEnv;
  readonly corsOrigins: readonly string[];
}

/**
 * Raised when the environment is missing a required variable or carries an
 * invalid value. The message names the offending variable but never includes
 * its value, so secrets can never leak through an error path (Requirement 1.2).
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function requireString(env: NodeJS.ProcessEnv, key: string): string {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    throw new ConfigError(`Missing required environment variable: ${key}`);
  }
  return raw.trim();
}

function parseHttpsUrl(value: string, key: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`Environment variable ${key} must be a valid URL`);
  }
  if (url.protocol !== 'https:') {
    throw new ConfigError(`Environment variable ${key} must be an https URL`);
  }
  return url;
}

function parsePort(env: NodeJS.ProcessEnv): number {
  const raw = env.PORT;
  // PORT is optional; default to 3000 when absent/blank.
  if (raw === undefined || raw.trim() === '') {
    return 3000;
  }
  const port = Number(raw.trim());
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ConfigError(
      'Environment variable PORT must be an integer between 1 and 65535',
    );
  }
  return port;
}

function parseNodeEnv(env: NodeJS.ProcessEnv): NodeEnv {
  const raw = env.NODE_ENV;
  // NODE_ENV is optional; default to 'development' when absent/blank.
  if (raw === undefined || raw.trim() === '') {
    return 'development';
  }
  const candidate = raw.trim();
  if (!(NODE_ENVS as readonly string[]).includes(candidate)) {
    throw new ConfigError(
      `Environment variable NODE_ENV must be one of: ${NODE_ENVS.join(', ')}`,
    );
  }
  return candidate as NodeEnv;
}

function parseCorsOrigins(env: NodeJS.ProcessEnv): readonly string[] {
  const raw = env.CORS_ORIGINS;
  if (raw === undefined || raw.trim() === '') {
    return [];
  }
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Build a frozen {@link AppConfig} from an environment map.
 *
 * Pure: no I/O, no mutation of `env` (Requirement 1.3). Returns a frozen config
 * only when every required variable is present and well-formed (Requirement
 * 1.1); otherwise throws a {@link ConfigError} naming the offending variable
 * without its value (Requirement 1.2).
 *
 * The JWKS URL is derived from `SUPABASE_URL` as
 * `<supabaseUrl>/.well-known/jwks.json`. An explicit `SUPABASE_JWKS_URL` may be
 * supplied to override the derivation (useful for local/CLI stacks); when set
 * it must also be a valid https URL.
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const supabaseUrlRaw = requireString(env, 'SUPABASE_URL');
  const supabaseUrl = parseHttpsUrl(supabaseUrlRaw, 'SUPABASE_URL');

  const supabaseSecretKey = requireString(env, 'SUPABASE_SECRET_KEY');

  // Derive JWKS from the project URL unless an explicit override is provided.
  const jwksOverride = env.SUPABASE_JWKS_URL;
  let supabaseJwksUrl: string;
  if (jwksOverride !== undefined && jwksOverride.trim() !== '') {
    supabaseJwksUrl = parseHttpsUrl(jwksOverride.trim(), 'SUPABASE_JWKS_URL').toString();
  } else {
    // new URL() normalises `supabaseUrl`; strip any trailing slash from the
    // origin+path before appending the well-known suffix.
    const base = supabaseUrl.toString().replace(/\/+$/, '');
    supabaseJwksUrl = `${base}/.well-known/jwks.json`;
  }

  const config: AppConfig = {
    port: parsePort(env),
    supabaseUrl: supabaseUrl.toString().replace(/\/+$/, ''),
    supabaseSecretKey,
    supabaseJwksUrl,
    nodeEnv: parseNodeEnv(env),
    corsOrigins: Object.freeze([...parseCorsOrigins(env)]),
  };

  return Object.freeze(config);
}
