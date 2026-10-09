-- 0004_sales.sql
-- Kapanin schema: sales table (per-sale history).
--
-- Tables only in this phase. RLS enablement comes in a later migration (Task 5).
--
-- Same-owner integrity via the composite FK (product_id, owner_id) ->
-- products(id, owner_id). `sold_on` + `price_sold` give the AI phase the sale
-- history it needs to reason about demand and discounting.

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
