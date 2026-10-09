/**
 * In-memory fake of the subset of the Supabase/PostgREST client the product
 * service uses. It lets services and routes be tested deterministically with
 * NO live database (Requirement 10.2; design "Testing Strategy").
 *
 * It models exactly the builder chains `src/services/products.ts` relies on:
 *
 *   from(t).select(cols).eq(a,x).order(..)                 -> list
 *   from(t).select(cols).eq(a,x).eq(b,y).maybeSingle()     -> getById
 *   from(t).insert(row).select(cols).single()              -> create
 *   from(t).update(patch).eq(a,x).eq(b,y).select(cols).maybeSingle() -> update
 *   from(t).delete().eq(a,x).eq(b,y).select('id')          -> remove
 *
 * The builder is a thenable (`PromiseLike`) that resolves to `{ data, error }`,
 * matching how PostgREST query builders are awaited directly. Rows are stored
 * per-table in a `Map`; the fake stamps `id`/`created_at`/`updated_at` on
 * insert so round-trip tests see realistic server-set fields — but it does NOT
 * stamp `owner_id` (the service must do that, which is what Property 3 checks).
 *
 * Composite-FK simulation (Task 7, Property 5): the `stock`, `sales`, and
 * `discounts` tables reference `products(id, owner_id)` via a composite FK, so
 * a child insert whose `(product_id, owner_id)` has no matching products row
 * must fail exactly as Postgres would — with a 23503 foreign_key_violation and
 * NO row written. {@link createFakeDb} enables this for those three tables by
 * default; it is table-agnostic (any table listed in `fkChildTables` is
 * checked against `products`). Deterministic: the check reads only in-memory
 * state.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface FakeRow {
  [key: string]: unknown;
  id: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

interface PgResult<T> {
  data: T;
  error: { code?: string; message: string } | null;
}

type Op = 'select' | 'insert' | 'update' | 'delete';

export interface FakeDb {
  /** table -> rows */
  tables: Map<string, FakeRow[]>;
  /** monotonic id counter so generated ids are unique and deterministic. */
  seq: number;
  /** fixed clock for created_at/updated_at. */
  now: () => string;
  /**
   * Tables whose inserts must satisfy a composite FK `(product_id, owner_id) ->
   * products(id, owner_id)`. An insert into one of these tables fails with a
   * 23503 foreign_key_violation (and writes nothing) when no products row
   * matches both the inserted `product_id` AND `owner_id`. This reproduces the
   * cross-owner reference rejection Property 5 relies on.
   */
  fkChildTables: Set<string>;
}

/** Default composite-FK child tables (match migrations 0003/0004/0005). */
const DEFAULT_FK_CHILD_TABLES = ['stock', 'sales', 'discounts'];

export interface FakeDbOptions {
  /** Override which tables enforce the composite FK against `products`. */
  fkChildTables?: string[];
}

export function createFakeDb(
  seed?: Record<string, FakeRow[]>,
  options?: FakeDbOptions,
): FakeDb {
  const tables = new Map<string, FakeRow[]>();
  if (seed) {
    for (const [name, rows] of Object.entries(seed)) {
      tables.set(name, rows.map((r) => ({ ...r })));
    }
  }
  return {
    tables,
    seq: 0,
    now: () => '2024-01-01T00:00:00.000Z',
    fkChildTables: new Set(options?.fkChildTables ?? DEFAULT_FK_CHILD_TABLES),
  };
}

function pickColumns(row: FakeRow, columns: string): FakeRow {
  // The service always selects the full product column list; return the row as
  // is. (A column projection is unnecessary for these tests and would only risk
  // dropping fields the assertions expect.)
  void columns;
  return { ...row };
}

type RangeFilter = ['gte' | 'lte', string, string];

class FakeQueryBuilder implements PromiseLike<PgResult<FakeRow[] | FakeRow | null>> {
  private op: Op = 'select';
  private columns = '*';
  private readonly filters: Array<[string, unknown]> = [];
  private readonly rangeFilters: RangeFilter[] = [];
  private insertRow: Record<string, unknown> | null = null;
  private patch: Record<string, unknown> | null = null;
  private singleFlag = false;
  private maybeSingleFlag = false;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select(columns = '*'): this {
    this.columns = columns;
    return this;
  }

  insert(row: Record<string, unknown>): this {
    this.op = 'insert';
    this.insertRow = row;
    return this;
  }

  update(patch: Record<string, unknown>): this {
    this.op = 'update';
    this.patch = patch;
    return this;
  }

  delete(): this {
    this.op = 'delete';
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  gte(column: string, value: string): this {
    this.rangeFilters.push(['gte', column, value]);
    return this;
  }

  lte(column: string, value: string): this {
    this.rangeFilters.push(['lte', column, value]);
    return this;
  }

  order(_column: string, _opts?: unknown): this {
    // Rows are returned in insertion order already; ordering is a no-op here.
    return this;
  }

  single(): this {
    this.singleFlag = true;
    return this;
  }

  maybeSingle(): this {
    this.maybeSingleFlag = true;
    return this;
  }

  private rows(): FakeRow[] {
    let rows = this.db.tables.get(this.table) ?? [];
    for (const [col, val] of this.filters) {
      rows = rows.filter((r) => r[col] === val);
    }
    for (const [kind, col, val] of this.rangeFilters) {
      rows = rows.filter((r) => {
        const cell = r[col];
        if (typeof cell !== 'string') return false;
        return kind === 'gte' ? cell >= val : cell <= val;
      });
    }
    return rows;
  }

  /**
   * Composite-FK check for a child-table insert: does a `products` row exist
   * with BOTH the inserted `product_id` AND `owner_id`? Mirrors
   * `(product_id, owner_id) -> products(id, owner_id)`. A missing match means a
   * cross-owner/absent reference (Property 5).
   */
  private violatesCompositeFk(row: Record<string, unknown>): boolean {
    if (!this.db.fkChildTables.has(this.table)) return false;
    const products = this.db.tables.get('products') ?? [];
    const productId = row.product_id;
    const ownerId = row.owner_id;
    return !products.some((p) => p.id === productId && p.owner_id === ownerId);
  }

  private run(): PgResult<FakeRow[] | FakeRow | null> {
    const all = this.db.tables.get(this.table) ?? [];

    if (this.op === 'insert') {
      const insertRow = (this.insertRow ?? {}) as Record<string, unknown>;

      // Enforce the composite FK before writing (Property 5): a cross-owner or
      // absent product_id reference fails with 23503 and persists NOTHING.
      if (this.violatesCompositeFk(insertRow)) {
        return {
          data: null,
          error: {
            code: '23503',
            message:
              'insert or update on table violates foreign key constraint (product_id, owner_id)',
          },
        };
      }

      // Deterministic UUID-shaped id so route-level `:id` uuid validation
      // accepts a created id end to end (matches the DB uuid PK).
      const n = (++this.db.seq).toString(16).padStart(12, '0');
      const id = `00000000-0000-4000-8000-${n}`;
      const ts = this.db.now();
      const row: FakeRow = {
        category: null,
        margin: null,
        ...insertRow,
        id: (insertRow.id as string) ?? id,
        owner_id: insertRow.owner_id as string,
        created_at: ts,
        updated_at: ts,
      };
      all.push(row);
      this.db.tables.set(this.table, all);
      return { data: pickColumns(row, this.columns), error: null };
    }

    if (this.op === 'update') {
      const matches = this.rows();
      if (matches.length === 0) {
        // maybeSingle on no match -> data null, no error.
        return { data: null, error: null };
      }
      const target = matches[0];
      Object.assign(target, this.patch, { updated_at: this.db.now() });
      return { data: pickColumns(target, this.columns), error: null };
    }

    if (this.op === 'delete') {
      const matches = this.rows();
      const matchSet = new Set(matches);
      const remaining = all.filter((r) => !matchSet.has(r));
      this.db.tables.set(this.table, remaining);
      // Mirrors `.delete().select('id')`: array of deleted rows.
      return { data: matches.map((r) => ({ ...r })), error: null };
    }

    // select
    const matched = this.rows();
    if (this.singleFlag || this.maybeSingleFlag) {
      if (matched.length === 0) {
        return { data: null, error: null };
      }
      return { data: pickColumns(matched[0], this.columns), error: null };
    }
    return { data: matched.map((r) => pickColumns(r, this.columns)), error: null };
  }

  then<TResult1 = PgResult<FakeRow[] | FakeRow | null>, TResult2 = never>(
    onfulfilled?:
      | ((value: PgResult<FakeRow[] | FakeRow | null>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    try {
      const result = this.run();
      return Promise.resolve(result).then(onfulfilled, onrejected);
    } catch (err) {
      return Promise.reject(err).then(onfulfilled, onrejected);
    }
  }
}

/**
 * Build a fake Supabase client backed by {@link FakeDb}. The returned value is
 * typed as `SupabaseClient` for injection ergonomics but only implements the
 * `.from(table)` builder subset the product service exercises.
 */
export function createFakeSupabase(db: FakeDb): SupabaseClient {
  const client = {
    from(table: string) {
      return new FakeQueryBuilder(db, table);
    },
  };
  return client as unknown as SupabaseClient;
}
