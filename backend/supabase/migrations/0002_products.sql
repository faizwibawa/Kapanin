-- 0002_products.sql
-- Kapanin schema: products table (owner-scoped catalogue).
--
-- Tables only in this phase. RLS enablement comes in a later migration (Task 5).
--
-- The `unique (id, owner_id)` constraint is deliberate: it is the target of the
-- composite foreign keys on stock/sales/discounts, which is how same-owner
-- references are enforced at the data layer (a child row cannot point at a
-- product owned by a different owner).

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

-- Index to support owner-scoped listing queries (owner_id = auth.uid()).
create index if not exists products_owner_id_idx on public.products (owner_id);
