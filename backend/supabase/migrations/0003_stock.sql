-- 0003_stock.sql
-- Kapanin schema: stock table (current on-hand quantity per product).
--
-- Tables only in this phase. RLS enablement comes in a later migration (Task 5).
--
-- Same-owner integrity is enforced by the composite FK (product_id, owner_id)
-- -> products(id, owner_id): a stock row can only reference a product owned by
-- the same owner. `stock_since` records when the current stock began, for the
-- stock-age signal the AI phase will later consume.

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
