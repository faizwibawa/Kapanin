import type { SupabaseClient } from '@supabase/supabase-js';
import { mapDbError } from './dbError.js';

const LOOKBACK_DAYS = 28;
const DB_PAGE_SIZE = 500;
const GROUPS = ['no_sales_28d', 'cover_gt_90d', 'cover_30_90d', 'cover_le_30d'] as const;
type PriorityGroup = typeof GROUPS[number];

interface Product { id: string; name: string; category: string | null; cost: number | string }
interface Stock { product_id: string; quantity: number }
interface Sale { product_id: string; quantity: number; sold_on: string }
export interface PriorityItem {
  product_id: string;
  name: string;
  category: string | null;
  stock_quantity: number;
  units_sold_28d: number;
  days_of_cover: number | null;
  remaining_28d_proxy: number;
  tied_cost_28d_proxy: number;
  priority_group: PriorityGroup;
}

function dateOffset(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Mirrors the informational, non-ML priority calculation in main.ipynb. */
export function calculateStockPriorities(products: Product[], stock: Stock[], sales: Sale[]): PriorityItem[] {
  const stockByProduct = new Map<string, number>();
  const salesByProduct = new Map<string, number>();
  for (const row of stock) stockByProduct.set(row.product_id, (stockByProduct.get(row.product_id) ?? 0) + row.quantity);
  for (const row of sales) salesByProduct.set(row.product_id, (salesByProduct.get(row.product_id) ?? 0) + row.quantity);

  return products.flatMap((product): PriorityItem[] => {
    const stockQuantity = stockByProduct.get(product.id) ?? 0;
    if (stockQuantity <= 0) return [];
    const unitsSold = salesByProduct.get(product.id) ?? 0;
    const daysOfCover = unitsSold > 0 ? stockQuantity * LOOKBACK_DAYS / unitsSold : null;
    const remaining = Math.max(stockQuantity - unitsSold, 0);
    const group: PriorityGroup = daysOfCover === null ? 'no_sales_28d'
      : daysOfCover > 90 ? 'cover_gt_90d'
      : daysOfCover > 30 ? 'cover_30_90d' : 'cover_le_30d';
    return [{
      product_id: product.id, name: product.name, category: product.category,
      stock_quantity: stockQuantity, units_sold_28d: unitsSold,
      days_of_cover: daysOfCover, remaining_28d_proxy: remaining,
      tied_cost_28d_proxy: Math.round(remaining * Number(product.cost) * 100) / 100,
      priority_group: group,
    }];
  }).sort((a, b) => GROUPS.indexOf(a.priority_group) - GROUPS.indexOf(b.priority_group)
    || b.tied_cost_28d_proxy - a.tied_cost_28d_proxy
    || a.product_id.localeCompare(b.product_id));
}

export function createAnalyticsService(client: SupabaseClient, today = () => new Date().toISOString().slice(0, 10)) {
  async function allRows<T>(table: string, columns: string, ownerId: string, start?: string, end?: string): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += DB_PAGE_SIZE) {
      let query = client.from(table).select(columns).eq('owner_id', ownerId);
      if (start !== undefined && end !== undefined) query = query.gte('sold_on', start).lte('sold_on', end);
      const { data, error } = await query.order('id', { ascending: true }).range(from, from + DB_PAGE_SIZE - 1);
      if (error) throw mapDbError(error, `List ${table}`);
      const page = (data ?? []) as T[];
      rows.push(...page);
      if (page.length < DB_PAGE_SIZE) break;
    }
    return rows;
  }

  return {
    async stockPriorities(ownerId: string, limit: number, offset: number) {
      const asOfDate = today();
      const windowStart = dateOffset(asOfDate, -LOOKBACK_DAYS);
      const windowEnd = dateOffset(asOfDate, -1);
      const [products, stock, sales] = await Promise.all([
        allRows<Product>('products', 'id,name,category,cost', ownerId),
        allRows<Stock>('stock', 'id,product_id,quantity', ownerId),
        allRows<Sale>('sales', 'id,product_id,quantity,sold_on', ownerId, windowStart, windowEnd),
      ]);
      const sorted = calculateStockPriorities(products, stock, sales);
      const summary = Object.fromEntries(GROUPS.map(group => [group, {
        products: sorted.filter(item => item.priority_group === group).length,
        tied_cost_28d_proxy: Math.round(sorted.filter(item => item.priority_group === group)
          .reduce((sum, item) => sum + item.tied_cost_28d_proxy, 0) * 100) / 100,
      }]));
      return {
        as_of_date: asOfDate, window_start: windowStart, lookback_days: LOOKBACK_DAYS,
        basis: 'current_stock_and_recorded_sales', total: sorted.length,
        limit, offset, summary, items: sorted.slice(offset, offset + limit),
      };
    },
  };
}

export type AnalyticsService = ReturnType<typeof createAnalyticsService>;
