import { createApp } from './app.js';
import { loadConfig } from './config/env.js';

/**
 * Server entrypoint. Owns everything the importable app must not: reading and
 * validating the environment and binding a network port (Requirement 10.1).
 *
 * Configuration is loaded and validated BEFORE the app is constructed, so a
 * misconfigured environment fails fast and the HTTP application never starts
 * (Requirement 1.4). `loadConfig` throws a descriptive error naming the
 * offending variable; we let that propagate and exit non-zero.
 */
function start(): void {
  const config = loadConfig(process.env);
  const app = createApp(config);

  app.listen(config.port, () => {
    // The secret key is never logged (Requirement 1.6).
    console.log(`Kapanin API listening on :${config.port} (${config.nodeEnv})`);
  });
}

start();
