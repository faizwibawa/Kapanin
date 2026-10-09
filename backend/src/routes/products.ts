import { Router, type RequestHandler } from 'express';
import type { ProductService } from '../services/products.js';
import {
  NewProductSchema,
  ProductPatchSchema,
  ProductIdParamSchema,
} from '../validation/product.js';
import {
  AuthError,
  NotFoundError,
  ValidationError,
  zodFieldDetails,
} from '../middleware/error.js';

/**
 * Products router (design: "Routers" component; Requirement 7, 8).
 *
 * Thin by design: each handler validates input with `zod` BEFORE touching the
 * service (Requirement 8.1), derives the owner from `req.user.id` (populated by
 * the auth middleware this router is mounted behind), calls the service, and
 * shapes the response. All error branches `next(err)` so the single centralized
 * error handler maps them to a status (Requirement 8.3). Validation failures
 * become a 400 with field-level detail (Requirement 8.2); an absent/not-owned
 * id on get/update/delete becomes a 404 (Requirement 7.5).
 *
 * The service is injected so routes can be exercised with a fake Supabase client
 * (Requirement 10.2). `requireAuth` is injected for the same reason the `/me`
 * router does it: tests mount behind a locally-signed key set.
 */
export function createProductsRouter(
  requireAuth: RequestHandler,
  service: ProductService,
): Router {
  const router = Router();

  /** Read the authenticated owner id or signal a 401 (defensive: should be
   *  unreachable behind requireAuth). */
  function ownerIdOf(reqUser: Express.Request['user']): string {
    if (reqUser === undefined) throw new AuthError('Missing bearer token');
    return reqUser.id;
  }

  // GET /products — list only the owner's products (Requirement 7.3).
  router.get('/products', requireAuth, async (req, res, next) => {
    try {
      const ownerId = ownerIdOf(req.user);
      const products = await service.list(ownerId);
      res.status(200).json(products);
    } catch (err) {
      next(err);
    }
  });

  // GET /products/:id — a product the owner owns, else 404 (Requirement 7.5).
  router.get('/products/:id', requireAuth, async (req, res, next) => {
    try {
      const ownerId = ownerIdOf(req.user);
      const params = ProductIdParamSchema.safeParse(req.params);
      if (!params.success) {
        throw new ValidationError('Invalid product id', zodFieldDetails(params.error));
      }
      const product = await service.getById(ownerId, params.data.id);
      if (product === null) throw new NotFoundError('Product not found');
      res.status(200).json(product);
    } catch (err) {
      next(err);
    }
  });

  // POST /products — create, stamping owner_id from the token; 201 + the row
  // (Requirement 7.1).
  router.post('/products', requireAuth, async (req, res, next) => {
    try {
      const ownerId = ownerIdOf(req.user);
      const parsed = NewProductSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid product', zodFieldDetails(parsed.error));
      }
      const created = await service.create(ownerId, parsed.data);
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  // PATCH /products/:id — partial update of an owned product (Requirement 7.4).
  router.patch('/products/:id', requireAuth, async (req, res, next) => {
    try {
      const ownerId = ownerIdOf(req.user);
      const params = ProductIdParamSchema.safeParse(req.params);
      if (!params.success) {
        throw new ValidationError('Invalid product id', zodFieldDetails(params.error));
      }
      const parsed = ProductPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid product patch', zodFieldDetails(parsed.error));
      }
      const updated = await service.update(ownerId, params.data.id, parsed.data);
      res.status(200).json(updated);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /products/:id — delete an owned product; 404 if absent/not-owned
  // (Requirement 7.5).
  router.delete('/products/:id', requireAuth, async (req, res, next) => {
    try {
      const ownerId = ownerIdOf(req.user);
      const params = ProductIdParamSchema.safeParse(req.params);
      if (!params.success) {
        throw new ValidationError('Invalid product id', zodFieldDetails(params.error));
      }
      await service.remove(ownerId, params.data.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
