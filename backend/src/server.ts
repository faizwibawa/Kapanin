import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function localEnv(): NodeJS.ProcessEnv {
  const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const values: NodeJS.ProcessEnv = {};
  for (const path of [resolve(backendDir, '../.env'), resolve(backendDir, '.env')]) {
    let source: string;
    try { source = readFileSync(path, 'utf8'); } catch { continue; }
    for (const line of source.split(/\r?\n/)) {
      const match = /^\s*([A-Z_]+)=(.*)$/.exec(line);
      if (match) values[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return values;
}

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
  const config = loadConfig({ ...localEnv(), ...process.env });
  const app = createApp(config);

  app.listen(config.port, () => {
    // The secret key is never logged (Requirement 1.6).
    console.log(`Kapanin API listening on :${config.port} (${config.nodeEnv})`);
  });
}

start();
