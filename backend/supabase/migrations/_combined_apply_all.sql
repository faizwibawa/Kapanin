-- ============================================================
-- Kapanin — COMBINED schema migration (apply once)
-- Paste this whole file into the Supabase SQL Editor and Run.
-- It concatenates 0001..0007 in dependency order:
--   0001 profiles -> 0002 products -> 0003 stock
--   -> 0004 sales -> 0005 discounts -> 0006 updated_at triggers
--   -> 0007 RLS policies + profile auto-creation trigger
-- Idempotent: safe to re-run (create table if not exists / create or replace /
-- drop policy if exists / drop trigger if exists).
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


-- ------------------------------------------------------------
-- 0007_rls_and_profile_trigger.sql
-- RLS + owner-scoped policies + profile auto-creation trigger.
-- Idempotent: drop policy/trigger if exists before (re)creating.
-- ------------------------------------------------------------

-- Enable Row Level Security on profiles and every data table.
alter table public.profiles  enable row level security;
alter table public.products  enable row level security;
alter table public.stock     enable row level security;
alter table public.sales     enable row level security;
alter table public.discounts enable row level security;

-- ---- profiles (id = auth.uid(); select + update only) ----
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---- products ----
drop policy if exists "products_select_own" on public.products;
create policy "products_select_own"
  on public.products for select
  using (owner_id = auth.uid());

drop policy if exists "products_insert_own" on public.products;
create policy "products_insert_own"
  on public.products for insert
  with check (owner_id = auth.uid());

drop policy if exists "products_update_own" on public.products;
create policy "products_update_own"
  on public.products for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "products_delete_own" on public.products;
create policy "products_delete_own"
  on public.products for delete
  using (owner_id = auth.uid());

-- ---- stock ----
drop policy if exists "stock_select_own" on public.stock;
create policy "stock_select_own"
  on public.stock for select
  using (owner_id = auth.uid());

drop policy if exists "stock_insert_own" on public.stock;
create policy "stock_insert_own"
  on public.stock for insert
  with check (owner_id = auth.uid());

drop policy if exists "stock_update_own" on public.stock;
create policy "stock_update_own"
  on public.stock for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "stock_delete_own" on public.stock;
create policy "stock_delete_own"
  on public.stock for delete
  using (owner_id = auth.uid());

-- ---- sales ----
drop policy if exists "sales_select_own" on public.sales;
create policy "sales_select_own"
  on public.sales for select
  using (owner_id = auth.uid());

drop policy if exists "sales_insert_own" on public.sales;
create policy "sales_insert_own"
  on public.sales for insert
  with check (owner_id = auth.uid());

drop policy if exists "sales_update_own" on public.sales;
create policy "sales_update_own"
  on public.sales for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "sales_delete_own" on public.sales;
create policy "sales_delete_own"
  on public.sales for delete
  using (owner_id = auth.uid());

-- ---- discounts ----
drop policy if exists "discounts_select_own" on public.discounts;
create policy "discounts_select_own"
  on public.discounts for select
  using (owner_id = auth.uid());

drop policy if exists "discounts_insert_own" on public.discounts;
create policy "discounts_insert_own"
  on public.discounts for insert
  with check (owner_id = auth.uid());

drop policy if exists "discounts_update_own" on public.discounts;
create policy "discounts_update_own"
  on public.discounts for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "discounts_delete_own" on public.discounts;
create policy "discounts_delete_own"
  on public.discounts for delete
  using (owner_id = auth.uid());

-- Profile auto-creation on signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS introspection helper (test support; non-sensitive catalog metadata only).
create or replace function public.kapanin_rls_report()
returns table (
  table_name   text,
  rls_enabled  boolean,
  policy_name  text,
  cmd          text,
  qual         text,
  with_check   text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.relname::text as table_name,
    c.relrowsecurity as rls_enabled,
    p.polname::text as policy_name,
    case p.polcmd
      when 'r' then 'SELECT'
      when 'a' then 'INSERT'
      when 'w' then 'UPDATE'
      when 'd' then 'DELETE'
      when '*' then 'ALL'
      else p.polcmd::text
    end as cmd,
    pg_catalog.pg_get_expr(p.polqual, p.polrelid) as qual,
    pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as with_check
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  left join pg_catalog.pg_policy p on p.polrelid = c.oid
  where n.nspname = 'public'
    and c.relname in ('profiles', 'products', 'stock', 'sales', 'discounts')
  order by c.relname, p.polname;
$$;

grant execute on function public.kapanin_rls_report() to anon, authenticated, service_role;
