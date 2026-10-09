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

Order matters: `0002` must run before `0003`–`0005` because those tables carry a
composite foreign key against `products(id, owner_id)`, and `0006` must run last
because its triggers attach to tables created earlier.

The migrations are written to be re-runnable where reasonable: tables use
`create table if not exists`, the trigger function uses `create or replace`, and
triggers are dropped (`drop trigger if exists`) before being recreated.

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

## Not here yet (added in a later migration — Task 5)

These migrations create **tables only**. The following are intentionally
deferred and arrive in a later RLS migration:

- **Row Level Security** — `enable row level security` and the per-table
  owner-scoped policies (`owner_id = auth.uid()`).
- **Profile auto-creation trigger** — the `handle_new_user()` function and the
  `on_auth_user_created` trigger on `auth.users` that inserts a `profiles` row
  on signup.

Until that migration lands, the check constraints and foreign keys defined here
are the data-layer guarantees; RLS is the authoritative owner-scoping backstop
added on top.
