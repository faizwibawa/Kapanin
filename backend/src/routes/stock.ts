import { Router, type RequestHandler } from 'express';
import type { StockService } from '../services/stock.js';
import {
  NewStockSchema,
  StockPatchSchema,
  StockIdParamSchema,
  StockListQuerySchema,
} from '../validation/stock.js';
import {
  AuthError,
  NotFoundError,
  ValidationError,
  zodFieldDetails,
} from '../middleware/error.js';

/**
 * Stock router (design: "Routers" component; Requirements 6, 7.6, 8).
 *
 * Thin, following the Products router template: validate with `zod` BEFORE the
 * service (Requirement 8.1), derive the owner from `req.user.id` (set by the
 * auth middleware this router mounts behind), call the service, shape the
 * response. All error branches `next(err)` to the central handler. Validation
 * failures become a 400 with field detail; an absent/not-owned id becomes a
 * 404; a cross-owner `product_id` surfaces as a 404 from the service
 * (Requirement 6.1).
 *
 * `GET /stock?productId=<uuid>` filters to one product, owner-scoped, for later
 * AI consumption (Requirement 7.6).
 */
export function createStockRouter(
  requireAuth: RequestHandler,
  service: StockService,
): Router {
  const router = Router();

  function ownerIdOf(reqUser: Express.Request['user']): string {
    if (reqUser === undefined) throw new AuthError('Missing bearer token');
    return reqUser.id;
  }

  router.get('/stock', requireAuth, async (req, res, next) => {
    try {
      const ownerId = ownerIdOf(req.user);
      const query = StockListQuerySchema.safeParse(req.query);
      if (!query.success) {
        throw new ValidationError('Invalid query', zodFieldDetails(query.error));
      }
      const rows = await service.list(ownerId, { productId: query.data.productId });
      res.status(200).json(rows);
    } catch (err) {
      next(err);
    }
  });

  router.get('/stock/:id', requireAuth, async (req, res, next) => {
    try {
      const ownerId = ownerIdOf(req.user);
      const params = StockIdParamSchema.safeParse(req.params);
      if (!params.success) {
        throw new ValidationError('Invalid stock id', zodFieldDetails(params.error));
      }
      const row = await service.getById(ownerId, params.data.id);
      if (row === null) throw new NotFoundError('Stock not found');
      res.status(200).json(row);
    } catch (err) {
      next(err);
    }
  });

  router.post('/stock', requireAuth, async (req, res, next) => {
    try {
      const ownerId = ownerIdOf(req.user);
      const parsed = NewStockSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid stock', zodFieldDetails(parsed.error));
      }
      const created = await service.create(ownerId, parsed.data);
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/stock/:id', requireAuth, async (req, res, next) => {
    try {
      const ownerId = ownerIdOf(req.user);
      const params = StockIdParamSchema.safeParse(req.params);
      if (!params.success) {
        throw new ValidationError('Invalid stock id', zodFieldDetails(params.error));
      }
      const parsed = StockPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid stock patch', zodFieldDetails(parsed.error));
      }
      const updated = await service.update(ownerId, params.data.id, parsed.data);
      res.status(200).json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/stock/:id', requireAuth, async (req, res, next) => {
    try {
      const ownerId = ownerIdOf(req.user);
      const params = StockIdParamSchema.safeParse(req.params);
      if (!params.success) {
        throw new ValidationError('Invalid stock id', zodFieldDetails(params.error));
      }
      await service.remove(ownerId, params.data.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
