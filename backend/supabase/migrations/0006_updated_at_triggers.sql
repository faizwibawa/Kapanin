-- 0006_updated_at_triggers.sql
-- Kapanin schema: updated_at maintenance.
--
-- Defines a single idempotent trigger function (create or replace) that stamps
-- `updated_at = now()` on every UPDATE, and attaches it to each table that has
-- an `updated_at` column: profiles, products, stock.
--
-- (sales and discounts intentionally have no `updated_at` column — they are
-- append-only history, so they get no trigger here.)
--
-- Re-runnable: `drop trigger if exists` precedes each `create trigger`.

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
