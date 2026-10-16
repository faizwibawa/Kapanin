-- Remove the unused product-day training panel. Discounts and sale price/cost
-- attribution remain in use. Fail safely if any history has been recorded.
begin;

do $$
declare
  table_name text;
  has_data boolean;
begin
  foreach table_name in array array[
    'stock_batch_daily_observations',
    'product_daily_observations',
    'stock_batches'
  ] loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('select exists (select 1 from public.%I)', table_name) into has_data;
      if has_data then
        raise exception 'Cannot drop nonempty table public.%', table_name;
      end if;
    end if;
  end loop;
end $$;

drop view if exists public.product_day;
drop table if exists public.stock_batch_daily_observations;
drop table if exists public.product_daily_observations;
drop table if exists public.stock_batches;

commit;
