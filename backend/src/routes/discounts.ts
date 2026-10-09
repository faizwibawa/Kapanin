import { Router, type RequestHandler } from 'express';
import type { DiscountService } from '../services/discounts.js';
import {
  NewDiscountSchema,
  DiscountIdParamSchema,
  DiscountListQuerySchema,
} from '../validation/discount.js';
import {
  AuthError,
  NotFoundError,
  ValidationError,
  zodFieldDetails,
} from '../middleware/error.js';

/**
 * Discounts router (design: "Routers" component; Requirements 6, 7.6, 8).
 *
 * Thin, following the Products router template. Discounts are append-only, so
 * there is NO PATCH route — only list/get/create/delete. The zod create schema
 * enforces percentage in (0, 100] and end_date >= start_date BEFORE the service
 * (Requirement 3.5, 3.7 / Property 7); errors `next(err)` to the central
 * handler.
 *
 * `GET /discounts?productId=<uuid>` filters to one product, owner-scoped, for
 * later AI consumption (Requirement 7.6).
 */
export function createDiscountsRouter(
  requireAuth: RequestHandler,
  service: DiscountService,
): Router {
  const router = Router();

  function ownerIdOf(reqUser: Express.Request['user']): string {
    if (reqUser === undefined) throw new AuthError('Missing bearer token');
    return reqUser.id;
  }

  router.get('/discounts', requireAuth, async (req, res, next) => {
    try {
      const ownerId = ownerIdOf(req.user);
      const query = DiscountListQuerySchema.safeParse(req.query);
      if (!query.success) {
        throw new ValidationError('Invalid query', zodFieldDetails(query.error));
      }
      const rows = await service.list(ownerId, { productId: query.data.productId });
      res.status(200).json(rows);
    } catch (err) {
      next(err);
    }
  });

  router.get('/discounts/:id', requireAuth, async (req, res, next) => {
    try {
      const ownerId = ownerIdOf(req.user);
      const params = DiscountIdParamSchema.safeParse(req.params);
      if (!params.success) {
        throw new ValidationError('Invalid discount id', zodFieldDetails(params.error));
      }
      const row = await service.getById(ownerId, params.data.id);
      if (row === null) throw new NotFoundError('Discount not found');
      res.status(200).json(row);
    } catch (err) {
      next(err);
    }
  });

  router.post('/discounts', requireAuth, async (req, res, next) => {
    try {
      const ownerId = ownerIdOf(req.user);
      const parsed = NewDiscountSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid discount', zodFieldDetails(parsed.error));
      }
      const created = await service.create(ownerId, parsed.data);
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/discounts/:id', requireAuth, async (req, res, next) => {
    try {
      const ownerId = ownerIdOf(req.user);
      const params = DiscountIdParamSchema.safeParse(req.params);
      if (!params.success) {
        throw new ValidationError('Invalid discount id', zodFieldDetails(params.error));
      }
      await service.remove(ownerId, params.data.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
