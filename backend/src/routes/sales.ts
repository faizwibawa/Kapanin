import { Router, type RequestHandler } from 'express';
import type { SaleService } from '../services/sales.js';
import {
  NewSaleSchema,
  SaleIdParamSchema,
  SaleListQuerySchema,
} from '../validation/sale.js';
import {
  AuthError,
  NotFoundError,
  ValidationError,
  zodFieldDetails,
} from '../middleware/error.js';

/**
 * Sales router (design: "Routers" component; Requirements 6, 7.6, 8).
 *
 * Thin, following the Products router template. Sales are append-only, so there
 * is NO PATCH route — only list/get/create/delete. Validation runs before the
 * service (Requirement 8.1); errors `next(err)` to the central handler.
 *
 * `GET /sales?productId=<uuid>&from=<date>&to=<date>` supports owner-scoped
 * product + date-range filtering for later AI consumption (Requirement 7.6).
 */
export function createSalesRouter(
  requireAuth: RequestHandler,
  service: SaleService,
): Router {
  const router = Router();

  function ownerIdOf(reqUser: Express.Request['user']): string {
    if (reqUser === undefined) throw new AuthError('Missing bearer token');
    return reqUser.id;
  }

  router.get('/sales', requireAuth, async (req, res, next) => {
    try {
      const ownerId = ownerIdOf(req.user);
      const query = SaleListQuerySchema.safeParse(req.query);
      if (!query.success) {
        throw new ValidationError('Invalid query', zodFieldDetails(query.error));
      }
      const rows = await service.list(ownerId, {
        productId: query.data.productId,
        from: query.data.from,
        to: query.data.to,
      });
      res.status(200).json(rows);
    } catch (err) {
      next(err);
    }
  });

  router.get('/sales/:id', requireAuth, async (req, res, next) => {
    try {
      const ownerId = ownerIdOf(req.user);
      const params = SaleIdParamSchema.safeParse(req.params);
      if (!params.success) {
        throw new ValidationError('Invalid sale id', zodFieldDetails(params.error));
      }
      const row = await service.getById(ownerId, params.data.id);
      if (row === null) throw new NotFoundError('Sale not found');
      res.status(200).json(row);
    } catch (err) {
      next(err);
    }
  });

  router.post('/sales', requireAuth, async (req, res, next) => {
    try {
      const ownerId = ownerIdOf(req.user);
      const parsed = NewSaleSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid sale', zodFieldDetails(parsed.error));
      }
      const created = await service.create(ownerId, parsed.data);
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/sales/:id', requireAuth, async (req, res, next) => {
    try {
      const ownerId = ownerIdOf(req.user);
      const params = SaleIdParamSchema.safeParse(req.params);
      if (!params.success) {
        throw new ValidationError('Invalid sale id', zodFieldDetails(params.error));
      }
      await service.remove(ownerId, params.data.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
