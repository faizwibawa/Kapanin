-- Forward-only capture schema for the product-day training panel.
-- No historical stock is invented: product_day contains only dates with an
-- explicitly recorded daily observation. Apply after 0007.

create unique index if not exists discounts_id_owner_unique on public.discounts (id, owner_id);
create index if not exists sales_owner_sold_on_idx on public.sales (owner_id, sold_on);

alter table public.sales
  add column if not exists regular_price_at_sale numeric(12, 2) check (regular_price_at_sale >= 0),
  add column if not exists unit_cost_at_sale numeric(12, 2) check (unit_cost_at_sale >= 0),
  add column if not exists discount_id uuid;

-- Legacy sales remain null; new sales can identify the promotion actually used.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sales_discount_owner_fk' and conrelid = 'public.sales'::regclass) then
    alter table public.sales add constraint sales_discount_owner_fk
      foreign key (discount_id, owner_id) references public.discounts (id, owner_id);
  end if;
end $$;

create table if not exists public.stock_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null,
  received_on date not null,
  expiry_date date,
  quantity_received integer not null check (quantity_received > 0),
  unit_cost_at_receipt numeric(12, 2) not null check (unit_cost_at_receipt >= 0),
  recorded_at timestamptz not null default now(),
  unique (id, owner_id, product_id),
  foreign key (product_id, owner_id) references public.products (id, owner_id) on delete cascade,
  check (expiry_date is null or expiry_date >= received_on)
);

-- One complete observation per product per local store date. A missing date is
-- unknown availability, not a zero-stock or zero-sales observation.
create table if not exists public.product_daily_observations (
  owner_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null,
  observed_on date not null,
  stock_open integer not null check (stock_open >= 0),
  stock_received integer not null default 0 check (stock_received >= 0),
  units_discarded integer not null default 0 check (units_discarded >= 0),
  stock_close integer not null check (stock_close >= 0),
  stock_available_hours numeric(4, 2) not null check (stock_available_hours between 0 and 24),
  regular_price numeric(12, 2) not null check (regular_price >= 0),
  unit_cost numeric(12, 2) not null check (unit_cost >= 0),
  promotion_id uuid,
  discount_rate_applied numeric(5, 2) not null default 0 check (discount_rate_applied between 0 and 100),
  recorded_at timestamptz not null default now(),
  primary key (owner_id, product_id, observed_on),
  foreign key (product_id, owner_id) references public.products (id, owner_id) on delete cascade,
  foreign key (promotion_id, owner_id) references public.discounts (id, owner_id),
  check (promotion_id is not null or discount_rate_applied = 0)
);

-- Batch-level closing balances make expiry and disposal labels measurable.
create table if not exists public.stock_batch_daily_observations (
  owner_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null,
  batch_id uuid not null,
  observed_on date not null,
  quantity_close integer not null check (quantity_close >= 0),
  units_discarded integer not null default 0 check (units_discarded >= 0),
  recorded_at timestamptz not null default now(),
  primary key (owner_id, batch_id, observed_on),
  foreign key (batch_id, owner_id, product_id) references public.stock_batches (id, owner_id, product_id) on delete cascade,
  foreign key (owner_id, product_id, observed_on)
    references public.product_daily_observations (owner_id, product_id, observed_on) on delete cascade
);

create index if not exists product_daily_observations_owner_date_idx
  on public.product_daily_observations (owner_id, observed_on);
create index if not exists stock_batches_owner_product_idx
  on public.stock_batches (owner_id, product_id);

alter table public.stock_batches enable row level security;
alter table public.product_daily_observations enable row level security;
alter table public.stock_batch_daily_observations enable row level security;

create policy stock_batches_owner on public.stock_batches for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy product_daily_observations_owner on public.product_daily_observations for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy stock_batch_daily_observations_owner on public.stock_batch_daily_observations for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.stock_batches,
  public.product_daily_observations, public.stock_batch_daily_observations to authenticated;

-- Security invoker preserves the caller's RLS. A zero-sales row is emitted only
-- when that product/date has an actual daily observation. Sales totals are
-- recorded sales, and should not be interpreted as unconstrained demand.
create or replace view public.product_day with (security_invoker = true) as
with sales_daily as (
  select owner_id, product_id, sold_on,
    sum(quantity)::integer as units_sold,
    sum(quantity * price_sold)::numeric(14, 2) as revenue,
    max(created_at) as sales_last_recorded_at
  from public.sales
  group by owner_id, product_id, sold_on
)
select d.owner_id, d.product_id, d.observed_on as date,
  coalesce(s.units_sold, 0) as units_sold,
  coalesce(s.revenue, 0)::numeric(14, 2) as revenue,
  d.stock_open, d.stock_received, d.stock_close,
  d.stock_available_hours, d.units_discarded,
  d.regular_price, d.unit_cost, d.promotion_id, d.discount_rate_applied,
  d.recorded_at as observation_recorded_at,
  s.sales_last_recorded_at
from public.product_daily_observations d
left join sales_daily s on s.owner_id = d.owner_id
  and s.product_id = d.product_id and s.sold_on = d.observed_on;

grant select on public.product_day to authenticated;
