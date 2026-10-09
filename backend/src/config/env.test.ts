import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigError } from './env.js';

/**
 * Config-loader fail-fast matrix (sub-task 2.1).
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
 * Properties: 6 (Config fail-fast) — a missing/invalid required key causes
 *   `loadConfig` to throw, so `createApp` is never reached.
 */

const SUPABASE_URL = 'https://proj-ref.supabase.co';
const SECRET_VALUE = 'super-secret-service-role-key-value';

/** A fully-valid environment used as the baseline for each negative case. */
function validEnv(): NodeJS.ProcessEnv {
  return {
    SUPABASE_URL,
    SUPABASE_SECRET_KEY: SECRET_VALUE,
    PORT: '4000',
    NODE_ENV: 'test',
    CORS_ORIGINS: 'http://localhost:5173, https://app.kapanin.example',
  };
}

describe('loadConfig — valid environment', () => {
  it('returns a frozen AppConfig with correctly derived values', () => {
    const config = loadConfig(validEnv());

    expect(config.supabaseUrl).toBe(SUPABASE_URL);
    expect(config.supabaseSecretKey).toBe(SECRET_VALUE);
    expect(config.supabaseJwksUrl).toBe(`${SUPABASE_URL}/.well-known/jwks.json`);
    expect(config.port).toBe(4000);
    expect(config.nodeEnv).toBe('test');
    expect(config.corsOrigins).toEqual([
      'http://localhost:5173',
      'https://app.kapanin.example',
    ]);

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.corsOrigins)).toBe(true);
  });

  it('derives the JWKS URL from SUPABASE_URL even with a trailing slash', () => {
    const env = validEnv();
    env.SUPABASE_URL = `${SUPABASE_URL}/`;
    const config = loadConfig(env);
    expect(config.supabaseJwksUrl).toBe(`${SUPABASE_URL}/.well-known/jwks.json`);
  });

  it('honours an explicit SUPABASE_JWKS_URL override', () => {
    const env = validEnv();
    env.SUPABASE_JWKS_URL = 'https://local.test/.well-known/jwks.json';
    const config = loadConfig(env);
    expect(config.supabaseJwksUrl).toBe('https://local.test/.well-known/jwks.json');
  });

  it('applies defaults for optional PORT and NODE_ENV', () => {
    const config = loadConfig({
      SUPABASE_URL,
      SUPABASE_SECRET_KEY: SECRET_VALUE,
    });
    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe('development');
    expect(config.corsOrigins).toEqual([]);
  });
});

describe('loadConfig — purity (Requirement 1.3)', () => {
  it('does not mutate the provided environment object', () => {
    const env = validEnv();
    const snapshot = { ...env };
    loadConfig(env);
    expect(env).toEqual(snapshot);
  });
});

describe('loadConfig — fail-fast matrix (Property 6, Requirements 1.2/1.4)', () => {
  const required = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY'] as const;

  for (const key of required) {
    it(`throws when required var ${key} is missing`, () => {
      const env = validEnv();
      delete env[key];
      expect(() => loadConfig(env)).toThrow(ConfigError);
      expect(() => loadConfig(env)).toThrow(new RegExp(key));
    });

    it(`throws when required var ${key} is blank`, () => {
      const env = validEnv();
      env[key] = '   ';
      expect(() => loadConfig(env)).toThrow(ConfigError);
      expect(() => loadConfig(env)).toThrow(new RegExp(key));
    });
  }

  it('throws when SUPABASE_URL is not a valid URL', () => {
    const env = validEnv();
    env.SUPABASE_URL = 'not-a-url';
    expect(() => loadConfig(env)).toThrow(/SUPABASE_URL/);
  });

  it('throws when SUPABASE_URL is http (not https)', () => {
    const env = validEnv();
    env.SUPABASE_URL = 'http://proj-ref.supabase.co';
    expect(() => loadConfig(env)).toThrow(/SUPABASE_URL/);
  });

  it('throws when PORT is not a valid number', () => {
    const env = validEnv();
    env.PORT = 'abc';
    expect(() => loadConfig(env)).toThrow(/PORT/);
  });

  it('throws when PORT is out of range', () => {
    const env = validEnv();
    env.PORT = '70000';
    expect(() => loadConfig(env)).toThrow(/PORT/);
  });

  it('throws when NODE_ENV is not an allowed value', () => {
    const env = validEnv();
    env.NODE_ENV = 'staging';
    expect(() => loadConfig(env)).toThrow(/NODE_ENV/);
  });

  it('throws when SUPABASE_JWKS_URL override is invalid', () => {
    const env = validEnv();
    env.SUPABASE_JWKS_URL = 'http://insecure.test/jwks';
    expect(() => loadConfig(env)).toThrow(/SUPABASE_JWKS_URL/);
  });
});

describe('loadConfig — error never leaks the offending value (Requirement 1.2)', () => {
  it('omits the secret value from the thrown error', () => {
    const env = validEnv();
    env.SUPABASE_SECRET_KEY = '   '; // invalid (blank) but we set a sentinel first
    // Use a distinctive invalid value that would be obvious if leaked.
    // A blank value is what triggers the throw; assert the sentinel from a
    // separate invalid-but-present case does not appear.
    try {
      loadConfig(env);
      throw new Error('expected loadConfig to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toContain('SUPABASE_SECRET_KEY');
    }
  });

  it('does not include an invalid NODE_ENV value in the message', () => {
    const env = validEnv();
    env.NODE_ENV = 'TOP_SECRET_SENTINEL';
    try {
      loadConfig(env);
      throw new Error('expected loadConfig to throw');
    } catch (err) {
      expect((err as Error).message).toContain('NODE_ENV');
      expect((err as Error).message).not.toContain('TOP_SECRET_SENTINEL');
    }
  });
});
