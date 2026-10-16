import { z } from 'zod';

export const PageQueryFields = {
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
};

export interface PageFilter {
  limit?: number;
  offset?: number;
}
