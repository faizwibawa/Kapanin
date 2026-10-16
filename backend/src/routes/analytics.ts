import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { AuthError, ValidationError, zodFieldDetails } from '../middleware/error.js';
import type { AnalyticsService } from '../services/analytics.js';

const Query = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

export function createAnalyticsRouter(requireAuth: RequestHandler, service: AnalyticsService): Router {
  const router = Router();
  router.get('/analytics/stock-priorities', requireAuth, async (req, res, next) => {
    try {
      if (req.user === undefined) throw new AuthError('Missing bearer token');
      const query = Query.safeParse(req.query);
      if (!query.success) throw new ValidationError('Invalid query', zodFieldDetails(query.error));
      res.status(200).json(await service.stockPriorities(req.user.id, query.data.limit, query.data.offset));
    } catch (error) { next(error); }
  });
  return router;
}
