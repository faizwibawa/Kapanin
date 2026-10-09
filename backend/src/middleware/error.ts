/**
 * Centralized error-handling middleware (design: "Error Handling Middleware"
 * component; Requirement 8.3, 8.4).
 *
 * The whole backend reports failures by throwing (or `next(err)`-ing) an
 * {@link AppError} carrying an HTTP status. This handler maps those to a
 * consistent, internal-free JSON response and is the ONLY place that decides a
 * status for an error. It MUST be registered LAST in `app.ts`, after all
 * routers, so Express routes thrown/forwarded errors to it.
 *
 * Mapping (Requirement 8.3): 401 auth, 400 validation, 404 not-found,
 * 403 forbidden, 500 everything unexpected. The response body never leaks
 * internals or secrets; the full error is logged server-side only
 * (Requirement 8.4).
 */
import type { ErrorRequestHandler, Request, Response, NextFunction } from 'express';
import { ZodError, type ZodIssue } from 'zod';

/**
 * A known, HTTP-shaped application error. `status` is the HTTP status the
 * handler will emit; `code` is an optional stable machine-readable tag; the
 * optional `details` carry safe, client-facing field information (e.g. zod
 * validation issues) — never internals or secrets.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** 400 — request body/params failed validation (Requirement 8.2). */
export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(400, message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

/** 404 — the requested resource is absent or not owned by the caller. */
export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, message, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

/** 403 — the caller is authenticated but not permitted. */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

/** 401 — authentication failed or was absent. */
export class AuthError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, message, 'UNAUTHORIZED');
    this.name = 'AuthError';
  }
}

/** Reduce a {@link ZodError} to compact, client-safe field-level detail. */
export function zodFieldDetails(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue: ZodIssue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Build the Express error handler. Returned as a factory for symmetry with the
 * other component factories and so future dependencies (e.g. a logger) can be
 * injected without changing the call sites.
 */
export function errorHandler(): ErrorRequestHandler {
  // Express identifies an error handler by its four-arg arity; `next` must stay
  // in the signature even though a terminal handler rarely forwards.
  return (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    // A zod error that reaches here (e.g. a `.parse()` thrown in a service) is
    // treated as a 400 with field detail, mirroring route-level validation.
    if (err instanceof ZodError) {
      res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: zodFieldDetails(err),
      });
      return;
    }

    if (err instanceof AppError) {
      // Log full detail server-side only for 5xx; 4xx are expected client
      // errors and need no server-side noise. The secret key is never part of
      // an AppError, so nothing sensitive is logged here (Requirement 8.4).
      if (err.status >= 500) {
        console.error('[error]', err);
      }
      const body: Record<string, unknown> = { error: err.message };
      if (err.code !== undefined) body.code = err.code;
      if (err.details !== undefined) body.details = err.details;
      res.status(err.status).json(body);
      return;
    }

    // Anything else is unexpected: log the full detail server-side, return a
    // generic 500 with no internals (Requirement 8.4).
    console.error('[error] unexpected', err);
    res.status(500).json({ error: 'Internal server error' });
  };
}
