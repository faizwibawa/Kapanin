import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import type { Express } from 'express';

/**
 * Vercel serverless entry point for the Kapanin backend.
 *
 * Vercel runs serverless functions, not a long-lived process, so this file
 * deliberately does NOT call `app.listen` (that lives in `src/server.ts`, used
 * for local/VM hosting). Instead it builds the Express app once per warm
 * instance and hands each incoming request straight to it — Express is itself
 * a `(req, res)` handler, which is exactly what Vercel invokes.
 *
 * Configuration is read from the Vercel-provided environment variables
 * (set in Project Settings -> Environment Variables), validated by `loadConfig`
 * on first use. If the environment is misconfigured the first request fails
 * loudly with the offending variable named, rather than silently misbehaving.
 */

let cachedApp: Express | undefined;

function getApp(): Express {
  if (cachedApp === undefined) {
    const config = loadConfig(process.env);
    cachedApp = createApp(config);
  }
  return cachedApp;
}

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  // Express's app instance is a standard Node request listener, so it can be
  // invoked directly with Vercel's (req, res) pair.
  getApp()(req, res);
}
