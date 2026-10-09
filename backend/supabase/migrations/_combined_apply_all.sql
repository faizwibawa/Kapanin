-- ============================================================
-- Kapanin — COMBINED schema migration (apply once)
-- Paste this whole file into the Supabase SQL Editor and Run.
-- It concatenates 0001..0006 in dependency order:
--   0001 profiles -> 0002 products -> 0003 stock
--   -> 0004 sales -> 0005 discounts -> 0006 updated_at triggers
-- Tables only (no RLS yet; RLS + profile trigger come in Task 5).
-- Idempotent: safe to re-run (create table if not exists / create or replace).
-- NOTE: this is a convenience bundle; the numbered files remain the source of truth.
-- ============================================================


-- ------------------------------------------------------------
-- 0001_profiles.sql
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  shop_name text,
  owner_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- ------------------------------------------------------------
-- 0002_products.sql
-- ------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  category text,
  cost numeric(12, 2) not null check (cost >= 0),
  price numeric(12, 2) not null check (price >= 0),
  margin numeric(12, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Enables composite FK so child rows can enforce same-owner reference.
  unique (id, owner_id)
);

create index if not exists products_owner_id_idx on public.products (owner_id);


-- ------------------------------------------------------------
-- 0003_stock.sql
-- ------------------------------------------------------------
create table if not exists public.stock (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null,
  quantity integer not null check (quantity >= 0),
  stock_since date not null default current_date,
  updated_at timestamptz not null default now(),
  foreign key (product_id, owner_id)
    references public.products (id, owner_id) on delete cascade
);

create index if not exists stock_owner_id_idx on public.stock (owner_id);
create index if not exists stock_product_owner_idx on public.stock (product_id, owner_id);


-- ------------------------------------------------------------
-- 0004_sales.sql
-- ------------------------------------------------------------
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null,
  quantity integer not null check (quantity >= 0),
  price_sold numeric(12, 2) not null check (price_sold >= 0),
  sold_on date not null default current_date,
  created_at timestamptz not null default now(),
  foreign key (product_id, owner_id)
    references public.products (id, owner_id) on delete cascade
);

create index if not exists sales_owner_id_idx on public.sales (owner_id);
create index if not exists sales_product_owner_idx on public.sales (product_id, owner_id);


-- ------------------------------------------------------------
-- 0005_discounts.sql
-- ------------------------------------------------------------
create table if not exists public.discounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null,
  percentage numeric check (percentage > 0 and percentage <= 100),
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  foreign key (product_id, owner_id)
    references public.products (id, owner_id) on delete cascade
);

create index if not exists discounts_owner_id_idx on public.discounts (owner_id);
create index if not exists discounts_product_owner_idx on public.discounts (product_id, owner_id);


-- ------------------------------------------------------------
-- 0006_updated_at_triggers.sql
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.products;
create trigger set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.stock;
create trigger set_updated_at
  before update on public.stock
  for each row execute function public.set_updated_at();
