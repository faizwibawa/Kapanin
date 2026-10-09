-- 0005_discounts.sql
-- Kapanin schema: discounts table (per-product discount windows).
--
-- Tables only in this phase. RLS enablement comes in a later migration (Task 5).
--
-- Same-owner integrity via the composite FK (product_id, owner_id) ->
-- products(id, owner_id). Check constraints keep `percentage` in (0, 100] and
-- the discount window well-formed (end_date >= start_date).

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
