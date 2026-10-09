import { Router, type RequestHandler } from 'express';

/**
 * Protected `/me` router (Requirement 9.2, 9.3).
 *
 * Mounted behind the auth middleware, so `GET /me` only runs for a request
 * that carried a valid Bearer JWT; an unauthenticated request is rejected with
 * `401` by the middleware before reaching the handler (Requirement 9.3).
 *
 * For now the handler echoes the authenticated owner (`id`, `email`) taken from
 * `req.user`. The full profile lookup against the `profiles` table is wired in
 * a later task (Task 5/8); the route contract stays the same.
 *
 * The auth middleware is injected so tests can mount this router behind a
 * middleware built with a locally-injected key set (Requirement 10.2).
 */
export function createMeRouter(requireAuth: RequestHandler): Router {
  const router = Router();

  router.get('/me', requireAuth, (req, res) => {
    // `req.user` is guaranteed present here: the middleware only calls next()
    // after populating it, otherwise it responds 401 (Requirement 2.1).
    const user = req.user;
    if (user === undefined) {
      // Defensive: should be unreachable behind requireAuth.
      res.status(401).json({ error: 'Missing bearer token' });
      return;
    }

    res.status(200).json({ id: user.id, email: user.email });
  });

  return router;
}
