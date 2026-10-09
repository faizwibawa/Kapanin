# Database migrations

Portable SQL migrations for the Kapanin backend schema. They live in the repo so
the project stays portable between hosted Supabase and a local/CLI stack with no
rework (design pillar: **portability**).

## Ordering

Files are applied in ascending numeric order. The prefix encodes the order:

| File | What it creates |
| --- | --- |
| `0001_profiles.sql` | `profiles` (1:1 with `auth.users`; `id = auth.users.id`) |
| `0002_products.sql` | `products` + `unique (id, owner_id)` (the composite-FK target) |
| `0003_stock.sql` | `stock` (composite FK `(product_id, owner_id)` -> products) |
| `0004_sales.sql` | `sales` (composite FK `(product_id, owner_id)` -> products) |
| `0005_discounts.sql` | `discounts` (composite FK + `percentage`/date checks) |
| `0006_updated_at_triggers.sql` | `set_updated_at()` function + triggers on `profiles`, `products`, `stock` |
| `0007_rls_and_profile_trigger.sql` | enables RLS on `profiles`/`products`/`stock`/`sales`/`discounts`; owner-scoped policies (`owner_id = auth.uid()`, profiles on `id = auth.uid()`); `handle_new_user()` + `on_auth_user_created` trigger; `kapanin_rls_report()` test helper |

Order matters: `0002` must run before `0003`–`0005` because those tables carry a
composite foreign key against `products(id, owner_id)`, `0006` must run after the
tables it attaches triggers to, and `0007` must run last because it enables RLS
and attaches policies/triggers to tables created by `0001`–`0005`.

The migrations are written to be re-runnable where reasonable: tables use
`create table if not exists`, functions use `create or replace`, triggers are
dropped (`drop trigger if exists`) before being recreated, and policies are
dropped (`drop policy if exists`) before being recreated. Enabling RLS is itself
idempotent in Postgres.

## How to apply

**Now (no CLI required):** open the Supabase project's **SQL Editor** in the
dashboard and run each file's contents in order (`0001` first). This is the path
for the current phase, before the CLI is set up.

**Later (Supabase CLI):** once the CLI is adopted, these same files are applied
with:

```bash
supabase db push        # apply migrations to the linked project
# or, for a local stack:
supabase start
supabase db reset       # re-applies every migration from scratch
```

No file changes are needed to move from the SQL Editor to the CLI — that is the
point of keeping the schema as plain, ordered SQL.

## Security layer (added in `0007` — Task 5)

`0007_rls_and_profile_trigger.sql` adds the data-layer security that `0001`–`0006`
deliberately deferred:

- **Row Level Security** — `enable row level security` on `profiles`,
  `products`, `stock`, `sales`, and `discounts`, with per-table owner-scoped
  policies. Data tables use the four-policy pattern (select / insert / update /
  delete) keyed on `owner_id = auth.uid()` (`with check` on insert and update);
  `profiles` is keyed on `id = auth.uid()` and exposes select + update only.
- **Profile auto-creation trigger** — the `handle_new_user()` function
  (`security definer`, empty `search_path`) and the `on_auth_user_created`
  trigger on `auth.users` that inserts a `profiles` row on signup, giving the
  1:1 relationship.
- **`kapanin_rls_report()`** — a `security definer` helper that surfaces the RLS
  configuration (per-table RLS flag + policy names/commands/expressions) so the
  owner-isolation test can assert the policies exist. PostgREST exposes only the
  `public` schema, so a secret-key client cannot read `pg_catalog` directly;
  this helper bridges that gap and returns only non-sensitive catalog metadata.

> **Note on owner-isolation testing.** The backend client uses the Supabase
> **secret (service_role) key, which BYPASSES RLS**. Per-user enforcement is
> therefore proven end-to-end by the Task 8 integration tests (two signed-in
> owners); the Task 5 test asserts the RLS **configuration** is in place.
