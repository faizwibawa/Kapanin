import { Router } from 'express';

/**
 * Unauthenticated liveness/readiness router.
 *
 * Requirement 9.1: a client may call the health endpoint without
 * authentication and receives a success status indicating liveness.
 */
export function createHealthRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  return router;
}
