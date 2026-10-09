-- 0007_rls_and_profile_trigger.sql
-- Kapanin: Row Level Security, owner-scoped policies, and profile auto-creation.
--
-- This is the migration deferred in Tasks 1-3 (see migrations/README.md). The
-- tables created by 0001-0005 carry no RLS yet; this file turns on the
-- authoritative data-layer owner-scoping backstop and wires the signup trigger
-- that gives every new auth user a 1:1 profiles row.
--
-- Design references:
--   - "RLS Policy Examples" (four-policy per-table pattern, owner_id = auth.uid())
--   - "Profiles auto-creation trigger (on signup)" (handle_new_user + trigger)
--   - Requirements 4.1, 4.2, 5.1, 5.3, 5.4, 5.5, 6.3
--
-- Idempotency: this file is written to be safely re-runnable. Every policy is
-- dropped with `drop policy if exists` before `create policy`; functions use
-- `create or replace`; the trigger is dropped before being recreated. Enabling
-- RLS is itself idempotent in Postgres.

-- ============================================================
-- 1. Enable Row Level Security on profiles and every data table.
--    (Requirements 5.4; profiles included so a user sees only their own row.)
-- ============================================================
alter table public.profiles  enable row level security;
alter table public.products  enable row level security;
alter table public.stock     enable row level security;
alter table public.sales     enable row level security;
alter table public.discounts enable row level security;

-- ============================================================
-- 2. Owner-scoped policies.
--
--    Data tables (products, stock, sales, discounts) use the four-policy
--    pattern: select/insert/update/delete, all keyed on `owner_id = auth.uid()`
--    with `with check` on insert and update so a row can only ever be written
--    for the authenticated owner (Requirements 5.1, 5.3, 5.5, 6.3).
--
--    profiles is keyed on `id = auth.uid()` (its PK equals auth.users.id) and
--    exposes select + update only: rows are created by the signup trigger
--    (section 4), and a user must not be able to delete or forge a profile.
-- ============================================================

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

-- ============================================================
-- 3. Profile auto-creation on signup (Requirements 4.1, 4.2).
--
--    `handle_new_user` runs as SECURITY DEFINER with an empty search_path so it
--    executes with the owner's privileges and resolves only fully-qualified
--    names (hardening against search_path hijacking). It inserts a profiles row
--    whose id equals the new auth user's id, giving the 1:1 relationship.
--    `on conflict do nothing` keeps re-fired inserts harmless.
-- ============================================================
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

-- ============================================================
-- 4. RLS introspection helper (test support).
--
--    PostgREST only exposes the `public` schema, so a client using the Supabase
--    secret key cannot read pg_catalog views (pg_policies, pg_class) directly.
--    This SECURITY DEFINER function surfaces the exact RLS configuration this
--    migration installs so the owner-isolation test (sub-task 5.1) can assert
--    that RLS is enabled and the owner-scoped policies exist. It returns only
--    non-sensitive catalog metadata (table/policy names, command, and the
--    policy expressions), never any row data.
--
--    Rationale (why introspection, not a per-user isolation test): the backend
--    client authenticates with the service_role secret key, which BYPASSES RLS.
--    This environment exposes no anon key or direct Postgres connection, so a
--    service-role client cannot faithfully prove per-user isolation. Asserting
--    the policies/flags exist proves the configuration is in place; full
--    per-user enforcement is exercised by the Task 8 integration tests.
-- ============================================================
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

-- Allow the API roles to call the report (service_role already can; grant the
-- anon/authenticated roles too so the helper is usable from any client).
grant execute on function public.kapanin_rls_report() to anon, authenticated, service_role;
