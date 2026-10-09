# Implementation Plan: Supabase Backend Integration

## Overview

This plan builds the Kapanin backend foundation as a stateless Node.js + Express + TypeScript API over Supabase (Postgres + Supabase Auth). Work proceeds in demoable increments: each top-level task leaves a running, testable system that the next task extends. We start with a scaffolded service and a health endpoint, wire typed config and the Supabase client, lay down portable SQL migrations, add JWKS-based JWT auth, enable RLS and the profile-creation trigger, build the Products vertical slice as a reusable template, extend that template to stock/sales/discounts, and finish by wiring everything together with the integration anchor and cross-owner isolation tests.

Implementation language: **TypeScript** (as specified in the design). The design includes a Correctness Properties section (P1–P7), so property-based test sub-tasks are included and annotated with their property and requirement numbers.

## Tasks

- [x] 1. Scaffold the backend service with a health endpoint
  - Create `backend/` with a Node + TypeScript project (`package.json`, `tsconfig.json`), Express installed, and source layout under `backend/src/`
  - Split `src/app.ts` (exports `createApp()`, importable, no port bind) from `src/server.ts` (loads config, binds the port)
  - Add npm scripts: `dev`, `build`, `test`, `lint`; configure a linter (ESLint) and a test runner (vitest or jest) with `supertest`
  - Implement an unauthenticated `GET /health` router that returns `{ status: "ok" }`
  - [ ]* 1.1 Write a test that `GET /health` returns `200` and the expected JSON via `supertest` against the imported app
    - Test edge cases: correct content type and body shape
    - _Requirements: 9.1, 10.1_

- [x] 2. Create the Supabase project and wire typed configuration
  - **Manual (Supabase dashboard) — note for the user, not a coding step:** create a Supabase project, retrieve the project URL and the server-only secret key, and note the JWKS URL (`<supabaseUrl>/.well-known/jwks.json`). These values populate the real `.env`.
  - Implement `src/config/env.ts` with `loadConfig(env)`: pure (no I/O, no mutation of `env`), returns a frozen typed `AppConfig`, and throws a descriptive error naming any missing/invalid variable without including its value
  - Implement `createSupabaseClient(config)` using the server-only secret key
  - Add `.env.example` with placeholder values only; add real `.env` to `.gitignore`; ensure the secret key is never logged or returned
  - Wire `server.ts` to call `loadConfig(process.env)` before `createApp`, so the app does not start on misconfiguration
  - [ ]* 2.1 Write the config-loader fail-fast test matrix
    - **Property 6: Config fail-fast** — missing required key causes `loadConfig` to throw and `createApp` is never reached
    - Cover each required var missing/invalid; assert the error names the var but not its value; assert `env` is not mutated
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_
    - _Properties: 6_

- [x] 3. Define the database schema as portable SQL migrations (tables only, no RLS yet)
  - Create `backend/supabase/migrations/` with ordered SQL files for `profiles`, `products`, `stock`, `sales`, `discounts`
  - `profiles.id` equals `auth.users(id)`; all other tables use UUID PKs (`gen_random_uuid()`)
  - `owner_id` on every data table references `auth.users(id)` `on delete cascade`
  - Add `unique (id, owner_id)` on `products`; use composite FKs `(product_id, owner_id)` -> `products(id, owner_id)` on `stock`, `sales`, `discounts`
  - Add check constraints: `quantity >= 0`; `percentage > 0 and percentage <= 100`; `price >= 0`, `cost >= 0`; `end_date >= start_date`
  - Add `created_at`/`updated_at` defaults and an `updated_at` maintenance trigger
  - [ ]* 3.1 Write a smoke-select test that each table exists and is queryable after migrations apply
    - **Property 7: Constraint honouring** (schema-level anchor) — verify check constraints exist/reject bad values at the DB layer
    - _Requirements: 3.1, 3.2, 3.3, 3.8, 6.2_
    - _Properties: 7_

- [x] 4. Add JWKS-based JWT verification middleware and a protected `/me`
  - Implement `src/middleware/auth.ts` `createAuthMiddleware({ jwksUrl })` using `jose` `createRemoteJWKSet` (cached ~10 min) + `jwtVerify`
  - Extract the Bearer token from `Authorization`; attach `req.user = { id: payload.sub, email }`
  - Respond `401` on missing/malformed header, invalid signature, expired token, or missing `sub`; do not call `next()` and perform no DB write on the failure path
  - Add a protected `GET /me` route that echoes the authenticated user (profile wiring refined in Task 5/8)
  - [ ]* 4.1 Write the auth-gate property test
    - **Property 4: Auth gate** — any protected request without a valid unexpired Bearer JWT yields `401` and no DB write
    - _Requirements: 2.2, 2.3, 2.4, 2.7, 9.3_
    - _Properties: 4_
  - [ ]* 4.2 Write unit tests for the middleware across token states
    - Valid / missing / malformed / expired / no-`sub`, using locally-signed test keys and a stubbed JWKS; valid token populates `req.user` from `sub`
    - _Requirements: 2.1, 2.5, 2.6, 9.2_

- [x] 5. Enable RLS, owner-scoped policies, and the profile auto-creation trigger
  - Add an RLS migration enabling RLS on every data table (`products`, `stock`, `sales`, `discounts`)
  - Add the four-policy pattern (select/insert/update/delete) per table with `owner_id = auth.uid()` (`with check` on insert/update)
  - Add the `handle_new_user` function (security definer, empty `search_path`) and the `on_auth_user_created` trigger that inserts a `profiles` row on `auth.users` insert
  - [ ]* 5.1 Write the owner-isolation property test
    - **Property 1: Owner isolation** — owner B's `list`/`getById` never returns a row created by owner A; each owner reads only their own rows
    - _Requirements: 4.1, 4.2, 5.1, 5.3, 5.4, 5.5, 6.3_
    - _Properties: 1_
  - [ ]* 5.2 Write a test that a profile row is auto-created on signup
    - Insert into `auth.users` (via test harness) and assert a 1:1 `profiles` row with matching `id`
    - _Requirements: 4.1, 4.2_

- [x] 6. Implement the Products CRUD vertical slice end to end (reusable template)
  - Implement `src/types` product DTOs, `zod` schemas, `src/services/products.ts` (`list`/`getById`/`create`/`update`/`remove`, all owner-scoped), and `src/routes/products.ts`
  - Wire route -> service -> Supabase with the auth middleware; stamp `owner_id` from `req.user.id` on create
  - Implement `src/middleware/error.ts` (`AppError`, `errorHandler`): `201` on create, `404` on absent/not-owned, `400` on validation, map auth/forbidden/not-found/unknown consistently without leaking internals
  - [ ]* 6.1 Write the create/read round-trip property test
    - **Property 2: Create/read round-trip** — `getById(owner, create(owner, p).id)` deep-equals the created row modulo server-set fields
    - _Requirements: 7.1, 7.2_
    - _Properties: 2_
  - [ ]* 6.2 Write the owner-stamping property test
    - **Property 3: Owner stamping** — any successful create returns a row whose `owner_id` equals the authenticated owner's id
    - _Requirements: 5.2_
    - _Properties: 3_
  - [ ]* 6.3 Write endpoint unit/integration tests for Products
    - Each endpoint incl. `zod` validation failures (`400` with field detail), not-found (`404`), and list returning only owned products
    - _Requirements: 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4_

- [x] 7. Implement the Stock, Sales, and Discounts slices following the Products template
  - Add types, `zod` schemas, services, and routers for `stock`, `sales`, `discounts`, reusing the owner-scoped CRUD template from Task 6
  - Enforce composite-FK same-owner integrity: a cross-owner `product_id` is rejected with `4xx` and writes nothing
  - Provide listing/filtering useful to later AI consumption (e.g., by product/date)
  - [ ]* 7.1 Write the FK-owner-integrity property test
    - **Property 5: FK owner integrity** — creating a stock/sale/discount referencing a `product_id` not owned by the caller fails (`4xx`) and persists nothing
    - _Requirements: 6.1_
    - _Properties: 5_
  - [ ]* 7.2 Write the constraint-honouring property test across resources
    - **Property 7: Constraint honouring** — negative quantity, percentage > 100, and `end_date < start_date` each fail with `4xx` and write no row
    - _Requirements: 3.4, 3.5, 3.6, 3.7_
    - _Properties: 7_
  - [ ]* 7.3 Write per-resource route/service unit tests
    - Owner scoping, validation failures, and the shared CRUD pattern applied to each resource
    - _Requirements: 6.2, 7.6_

- [x] 8. Wire everything together and document setup
  - Mount all routers (`health`, `me`, `products`, `stock`, `sales`, `discounts`) in `app.ts`; finalize CORS (configured origins) and the centralized error handler ordering
  - Write `backend/README.md`: env setup, running migrations, and the Supabase-centric auth flow (signup -> JWT -> Bearer request)
  - Confirm a clean `build` and that the full test suite passes
  - [ ]* 8.1 Write the integration anchor test
    - Signup via Supabase Auth -> obtain JWT -> `POST /products` with Bearer -> `GET /products` returns exactly that product
    - _Requirements: 10.2, 10.3, 8.3_
  - [ ]* 8.2 Write the cross-owner isolation integration test
    - A second owner's `GET /products` does not return the first owner's product
    - _Requirements: 10.4_

- [~] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirement clauses for traceability; property tests also cite their design property number.
- Task 2 includes manual Supabase dashboard steps that only the user can perform; these are clearly marked and are not coding tasks.
- Property-based tests (fast-check) encode P1–P7; unit tests cover examples/edge cases; integration tests cover the anchor and cross-owner flows.
- Checkpoints ensure incremental validation; each top-level task is a demoable increment that builds on the previous one.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["4.1", "4.2"] },
    { "id": 4, "tasks": ["5.1", "5.2"] },
    { "id": 5, "tasks": ["6.1", "6.2", "6.3"] },
    { "id": 6, "tasks": ["7.1", "7.2", "7.3"] },
    { "id": 7, "tasks": ["8.1", "8.2"] }
  ]
}
```
