import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Schema-level static validation of the portable SQL migrations (sub-task 3.1).
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.8, 6.2
 * Properties: 7 (Constraint honouring) — at the SCHEMA-DEFINITION level only.
 *
 * This phase has no live Supabase project, so these tests do NOT connect to a
 * database. They parse the migration SQL files and assert the required
 * structures (check constraints, composite FKs, the unique target, owner_id
 * FKs with cascade, and the updated_at trigger wiring) are present in the SQL
 * text.
 *
 * NOTE: live-DB *enforcement* of these constraints (that the database actually
 * rejects negative quantity, percentage > 100, end_date < start_date, and
 * cross-owner product references) is verified LATER — the Task 7 constraint
 * tests (Property 7) run against a real/CLI Supabase instance. Here we only
 * confirm the schema is DEFINED correctly.
 */

const here = dirname(fileURLToPath(import.meta.url));
// src/db -> backend/supabase/migrations
const migrationsDir = join(here, '..', '..', 'supabase', 'migrations');

/** Collapse all whitespace runs to single spaces and lowercase, for robust
 *  substring assertions that ignore formatting/indentation differences. */
function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').toLowerCase().trim();
}

function readMigration(file: string): string {
  const path = join(migrationsDir, file);
  expect(existsSync(path), `migration ${file} should exist`).toBe(true);
  return readFileSync(path, 'utf8');
}

const ORDERED_FILES = [
  '0001_profiles.sql',
  '0002_products.sql',
  '0003_stock.sql',
  '0004_sales.sql',
  '0005_discounts.sql',
] as const;

/** Data tables that must each have an owner_id FK -> auth.users on cascade. */
const DATA_TABLE_FILES = [
  '0002_products.sql',
  '0003_stock.sql',
  '0004_sales.sql',
  '0005_discounts.sql',
] as const;

/** Child tables that reference products via a composite FK. */
const COMPOSITE_FK_CHILD_FILES = [
  '0003_stock.sql',
  '0004_sales.sql',
  '0005_discounts.sql',
] as const;

describe('migrations — presence and ordering (Requirement 3.1)', () => {
  it('all five schema migration files exist, in order', () => {
    for (const file of ORDERED_FILES) {
      const path = join(migrationsDir, file);
      expect(existsSync(path), `expected ${file} to exist`).toBe(true);
    }
  });

  it('every migration file is non-empty SQL', () => {
    for (const file of ORDERED_FILES) {
      expect(readMigration(file).trim().length).toBeGreaterThan(0);
    }
  });
});

describe('profiles — id equals auth.users(id) (Requirements 3.2, 3.3)', () => {
  const sql = normalize(readMigration('0001_profiles.sql'));

  it('creates the profiles table', () => {
    expect(sql).toContain('create table if not exists public.profiles');
  });

  it('keys profiles.id to auth.users(id) on delete cascade (no uuid default)', () => {
    expect(sql).toContain(
      'id uuid primary key references auth.users (id) on delete cascade',
    );
    // profiles.id must NOT auto-generate; it mirrors the auth user id.
    expect(sql).not.toContain('id uuid primary key default gen_random_uuid');
  });
});

describe('products — uuid pk, unique(id, owner_id), cost/price checks (Reqs 3.2, 3.6, 6.2)', () => {
  const sql = normalize(readMigration('0002_products.sql'));

  it('uses a gen_random_uuid() primary key', () => {
    expect(sql).toContain('id uuid primary key default gen_random_uuid()');
  });

  it('declares unique (id, owner_id) as the composite-FK target (Requirement 6.2)', () => {
    expect(sql).toContain('unique (id, owner_id)');
  });

  it('enforces cost >= 0 and price >= 0 check constraints (Requirement 3.6)', () => {
    expect(sql).toContain('check (cost >= 0)');
    expect(sql).toContain('check (price >= 0)');
  });

  it('sets created_at and updated_at defaults (Requirement 3.8)', () => {
    expect(sql).toContain('created_at timestamptz not null default now()');
    expect(sql).toContain('updated_at timestamptz not null default now()');
  });
});

describe('owner_id FK -> auth.users(id) on delete cascade on every data table (Requirement 3.3)', () => {
  for (const file of DATA_TABLE_FILES) {
    it(`${file} references auth.users(id) on delete cascade for owner_id`, () => {
      const sql = normalize(readMigration(file));
      expect(sql).toContain(
        'owner_id uuid not null references auth.users (id) on delete cascade',
      );
    });
  }
});

describe('composite FK (product_id, owner_id) -> products(id, owner_id) (Requirement 6.2)', () => {
  for (const file of COMPOSITE_FK_CHILD_FILES) {
    it(`${file} declares the composite FK against products(id, owner_id) on cascade`, () => {
      const sql = normalize(readMigration(file));
      expect(sql).toContain('foreign key (product_id, owner_id)');
      expect(sql).toContain(
        'references public.products (id, owner_id) on delete cascade',
      );
    });
  }
});

describe('check constraints present in SQL text (Property 7 — schema level)', () => {
  it('quantity >= 0 on stock and sales (Requirement 3.4)', () => {
    expect(normalize(readMigration('0003_stock.sql'))).toContain(
      'quantity integer not null check (quantity >= 0)',
    );
    expect(normalize(readMigration('0004_sales.sql'))).toContain(
      'quantity integer not null check (quantity >= 0)',
    );
  });

  it('price_sold >= 0 on sales (Requirement 3.6)', () => {
    expect(normalize(readMigration('0004_sales.sql'))).toContain(
      'price_sold numeric(12, 2) not null check (price_sold >= 0)',
    );
  });

  it('percentage > 0 and percentage <= 100 on discounts (Requirement 3.5)', () => {
    expect(normalize(readMigration('0005_discounts.sql'))).toContain(
      'check (percentage > 0 and percentage <= 100)',
    );
  });

  it('end_date >= start_date on discounts (Requirement 3.7)', () => {
    expect(normalize(readMigration('0005_discounts.sql'))).toContain(
      'check (end_date >= start_date)',
    );
  });
});

describe('updated_at maintenance trigger (Requirement 3.8)', () => {
  const sql = normalize(readMigration('0006_updated_at_triggers.sql'));

  it('defines an idempotent set_updated_at() function', () => {
    expect(sql).toContain('create or replace function public.set_updated_at()');
    expect(sql).toContain('new.updated_at := now()');
  });

  it('attaches a before-update trigger to each table that has updated_at', () => {
    for (const table of ['public.profiles', 'public.products', 'public.stock']) {
      expect(sql).toContain(`before update on ${table}`);
    }
  });

  it('does not attach an updated_at trigger to append-only tables (sales, discounts)', () => {
    expect(sql).not.toContain('before update on public.sales');
    expect(sql).not.toContain('before update on public.discounts');
  });
});
