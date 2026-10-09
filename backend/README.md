# Kapanin backend

A stateless **Node.js + Express + TypeScript** API over **Supabase** (managed
Postgres + Supabase Auth). This is the *foundation phase* of Kapanin, an
AI-based decision-support system that will recommend when and how much small
retail store owners (UMKM) should discount products. This phase delivers only
authenticated, owner-scoped CRUD over the core retail data — products, stock,
sales, and discounts — that later phases build on.

> **Deferred to later phases.** The **frontend application** and the **AI /
> recommendation engine** are explicitly out of scope here. The frontend is
> referenced only where its request contract (a Supabase Bearer JWT) shapes this
> backend; the AI engine will later *read* sales/stock/discount history, which is
> why the schema already records it. No UI and no model/inference code is built
> in this phase.

## Architecture

The service is **stateless**: it holds no session state. A client authenticates
directly against Supabase Auth and receives a short-lived JWT; the backend never
issues or stores sessions. On every protected request it verifies the incoming
JWT against the project's JWKS endpoint, then runs owner-scoped queries. Row
Level Security (RLS) in Postgres is the authoritative, defense-in-depth backstop
that an owner can only ever touch their own rows — even if the application layer
has a bug.

```
Client ──signin──▶ Supabase Auth ──JWT──▶ Client
Client ──request + Authorization: Bearer <jwt>──▶ Express backend
   backend ──verify signature via JWKS──▶ Supabase JWKS endpoint
   backend ──owner-scoped query (service_role key)──▶ Supabase Postgres (RLS)
```

Three design pillars run throughout:

- **Security** — JWTs verified with asymmetric keys via JWKS (no hand-rolled
  verification), the privileged secret key stays server-only and git-ignored,
  RLS on every data table, composite foreign keys that respect owner scoping,
  and CORS restricted to a configured allow-list.
- **Testability** — `app.ts` (build the app) is split from `server.ts` (bind a
  port) so the app imports without opening a socket; the config and the Supabase
  client are injectable; a deterministic in-memory fake stands in for Supabase
  in unit tests.
- **Portability** — the whole schema lives as ordered SQL migration files, so
  the project moves from hosted Supabase to a local/CLI stack with no rewrite.

### Source layout

```
backend/
  src/
    app.ts                 createApp(config?, overrides?) — assembles the app, no port bind
    server.ts              loads+validates config, then binds the port
    config/                env.ts (loadConfig/AppConfig) + supabase.ts (service_role client)
    middleware/            auth.ts (JWKS JWT verify), error.ts (AppError + errorHandler)
    routes/                health, me, products, stock, sales, discounts
    services/              owner-scoped DB access (the only layer that queries Supabase)
    validation/            zod schemas for request bodies/params/queries
    types/                 shared domain + Express request augmentation types
    test-support/          fakeSupabase (deterministic) + liveSupabase (guarded live tests)
  supabase/migrations/     ordered portable SQL (schema, constraints, triggers, RLS)
```

## Prerequisites

- **Node.js LTS** (18+; the project is built and tested on current LTS).
- **npm** (ships with Node).
- A **Supabase project** (hosted free tier is enough for this phase; the
  Supabase CLI / local stack works later with the same migrations).

## Environment setup

Configuration is validated once at startup — a missing or malformed variable
makes the server fail fast (it never starts a misconfigured app) with an error
that names the offending variable but never prints its value.

1. Copy the template and fill in real values:

   ```bash
   cp .env.example .env
   ```

   The real `.env` is git-ignored; `.env.example` ships placeholders only — never
   commit real secrets.

2. In the **Supabase dashboard** (only you can do this):
   - Create a project at <https://supabase.com/dashboard>.
   - **Project Settings → API → Project URL** → `SUPABASE_URL`.
   - **Project Settings → API → secret / `service_role` key** →
     `SUPABASE_SECRET_KEY`. This is a privileged server-only credential — keep it
     out of version control, logs, and any client bundle.
   - *(Optional)* **Project Settings → API → anon / publishable key** →
     `SUPABASE_ANON_KEY`. Only the live integration tests use it (see
     [Testing](#testing)); the service itself never needs it.

### Variable reference

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `SUPABASE_URL` | yes | — | Project URL; must be a valid `https` URL. |
| `SUPABASE_SECRET_KEY` | yes | — | Server-only `service_role` key. Never logged or returned. |
| `SUPABASE_JWKS_URL` | no | derived | Defaults to `<SUPABASE_URL>/.well-known/jwks.json`; override for a local/CLI stack. Must be `https`. |
| `SUPABASE_ANON_KEY` | no | — | Anon/publishable key; used only by live integration tests. `SUPABASE_PUBLISHABLE_KEY` is accepted as an alias. |
| `PORT` | no | `3000` | Integer 1–65535. |
| `NODE_ENV` | no | `development` | One of `development` \| `test` \| `production`. |
| `CORS_ORIGINS` | no | *(none)* | Comma-separated allow-list of browser origins. Empty = no cross-origin access. |

## Running the database migrations

The schema is a set of ordered SQL files in `supabase/migrations/`. They apply
in ascending numeric order (`0001` first); order matters because later tables
carry composite foreign keys against `products`, and the RLS/trigger migration
must run last. See `supabase/migrations/README.md` for the per-file breakdown.

**Now (no CLI required):** open the Supabase project's **SQL Editor** and run
each file's contents in order (`0001` → `0007`). For convenience,
`supabase/migrations/_combined_apply_all.sql` concatenates every migration in
the correct order — paste that single file into the SQL Editor to apply the
whole schema in one go.

**Later (Supabase CLI):** once the CLI is adopted, the same files apply with
`supabase db push` (linked project) or `supabase start` + `supabase db reset`
(local stack). No file changes are needed to switch — that is the point of
keeping the schema as plain, ordered SQL.

The migrations create `profiles`, `products`, `stock`, `sales`, and `discounts`;
add the check constraints (`quantity >= 0`, `percentage` in `(0, 100]`,
`price >= 0`, `cost >= 0`, `end_date >= start_date`) and composite
same-owner foreign keys; maintain `created_at`/`updated_at`; enable RLS with
owner-scoped policies on every table; and install the `handle_new_user` trigger
that auto-creates a `profiles` row on signup.

## Authentication flow (Supabase-centric)

Authentication is deliberately **Supabase-centric** — the backend verifies
tokens but never mints them:

1. The client signs in with **Supabase Auth** (e.g. `signInWithPassword`) and
   receives a short-lived JWT.
2. The client calls this backend with `Authorization: Bearer <jwt>`.
3. The **auth middleware** verifies the JWT's signature against the project's
   **JWKS** (asymmetric keys, cached ~10 min) and checks expiry. Any missing,
   malformed, expired, or badly-signed token → `401`, and no handler runs.
4. On success, `req.user` is populated from the token's `sub` claim (the owner's
   `auth.users` id).
5. The service layer queries Supabase scoped to that owner, and **RLS** enforces
   `owner_id = auth.uid()` at the data layer as the final guarantee.

## Available endpoints

`/health` is public; everything else requires a valid Bearer JWT and is scoped
to the authenticated owner. A request for an id that is absent or owned by
someone else returns `404`. Request bodies/params/queries are validated with
`zod` before any service runs; a validation failure returns `400` with
field-level detail.

| Method & path | Auth | Description |
| --- | --- | --- |
| `GET /health` | public | Liveness check → `{ "status": "ok" }`. |
| `GET /me` | owner | The authenticated owner's profile. |
| `GET /products` | owner | List the owner's products. |
| `GET /products/:id` | owner | One owned product, else `404`. |
| `POST /products` | owner | Create a product (`owner_id` stamped from the token) → `201`. |
| `PATCH /products/:id` | owner | Update an owned product. |
| `DELETE /products/:id` | owner | Delete an owned product → `204`. |
| `GET /stock` | owner | List stock; `?productId=<uuid>` filters to one product. |
| `GET /stock/:id` · `POST /stock` · `PATCH /stock/:id` · `DELETE /stock/:id` | owner | Owner-scoped CRUD. |
| `GET /sales` | owner | List sales; `?productId=<uuid>&from=<date>&to=<date>` filters by product and date range. |
| `GET /sales/:id` · `POST /sales` · `DELETE /sales/:id` | owner | Sales are append-only (no `PATCH`). |
| `GET /discounts` | owner | List discounts; `?productId=<uuid>` filters to one product. |
| `GET /discounts/:id` · `POST /discounts` · `DELETE /discounts/:id` | owner | Discounts are append-only (no `PATCH`). |

Creating a `stock`/`sales`/`discounts` row that references a `product_id` not
owned by the caller is rejected (composite FK + RLS), writing nothing.

CORS is restricted to the origins in `CORS_ORIGINS`. With no origins configured,
no cross-origin browser access is granted; same-origin and server-to-server
callers (no `Origin` header) are unaffected.

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Run the server with `tsx watch` (reloads on change). |
| `npm run build` | Type-check and compile to `dist/` with `tsc`. |
| `npm start` | Run the compiled server (`node dist/server.js`); build first. |
| `npm test` | Run the full test suite once with `vitest`. |
| `npm run test:watch` | Run `vitest` in watch mode. |
| `npm run lint` | Lint with ESLint. |

## Testing

The suite combines three layers:

- **Unit tests** cover specific examples and edge cases — config fail-fast,
  auth middleware across token states (valid / missing / malformed / expired /
  no-`sub`), service error mapping, and each route's validation and
  owner-scoping behaviour.
- **Property-based tests** (`fast-check`) encode the design's correctness
  properties (owner isolation, create/read round-trip, owner stamping, the auth
  gate, FK owner integrity, config fail-fast, constraint honouring) over many
  generated inputs.
- **Integration tests** exercise the full Supabase-centric flow end to end:
  sign a real user in, obtain a genuine JWT, and drive the real app against the
  live project.

Two client strategies keep this fast and reliable:

- **Deterministic fake Supabase client** (`src/test-support/fakeSupabase.ts`) —
  an in-memory stand-in used by unit and property tests, so they run with no
  network and no live database.
- **Guarded live tests** (`src/test-support/liveSupabase.ts`) — tests that need
  a real project read connection details from `.env` and **skip gracefully**
  (never fail) when no project is configured, the project is unreachable, or the
  required migration/anon key is missing. The integration anchor and cross-owner
  isolation tests additionally need `SUPABASE_ANON_KEY` to sign a real user in;
  without it they skip. Any users/rows they create are deleted in a `finally`
  block so the live project is left clean.

Run everything with `npm test`. CI runs `npm run build` plus the full suite.
