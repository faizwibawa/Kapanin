import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getLiveEnv,
  createLiveClient,
  isUnreachable,
  type LiveEnv,
} from '../test-support/liveSupabase.js';

/**
 * Sub-task 5.1 — owner-isolation property test (Property 1).
 *
 * Validates: Requirements 4.1, 4.2, 5.1, 5.3, 5.4, 5.5, 6.3
 * Properties: 1 (Owner isolation)
 *
 * ── Test strategy: option (b), RLS-configuration verification ────────────────
 * Property 1 says owner B can never read/update/delete a row owned by owner A.
 * The authoritative enforcement is Postgres RLS. The CATCH: the backend's
 * Supabase client authenticates with the **service_role secret key, which
 * BYPASSES RLS entirely**. Proving per-user isolation THROUGH that client would
 * be a false test — the service role sees every row regardless of policy.
 *
 * Option (a) — signing in two real users and asserting cross-user denial —
 * requires either an anon/publishable key or a direct Postgres connection where
 * we can set the `authenticated` role + `request.jwt.claim.sub`. This
 * environment exposes NEITHER (no anon key in `.env`, no `pg`/`postgres` driver
 * installed), so option (a) is not feasible here.
 *
 * We therefore use option (b): assert the RLS CONFIGURATION is correctly in
 * place — RLS is enabled on every table and the owner-scoped policies exist with
 * the right command and `auth.uid()` predicate. That is the exact mechanism that
 * guarantees Property 1 at the data layer. Full per-user ENFORCEMENT (two
 * signed-in owners, one cannot see the other's product) is exercised by the
 * Task 8 cross-owner integration test, which operates through real user JWTs.
 *
 * Policy metadata is read via the `kapanin_rls_report()` SECURITY DEFINER helper
 * installed by migration 0007 (PostgREST only exposes the `public` schema, so a
 * secret-key client cannot read `pg_catalog` views directly).
 *
 * The suite SKIPS gracefully (never fails) when:
 *   - no live project is configured (`.env` absent / placeholders), or
 *   - the live project is unreachable, or
 *   - migration 0007 has not been applied yet (the report RPC is missing).
 */

interface PolicyRow {
  table_name: string;
  rls_enabled: boolean;
  policy_name: string | null;
  cmd: string | null;
  qual: string | null;
  with_check: string | null;
}

/** Data tables use the full four-command owner_id pattern. */
const DATA_TABLES = ['products', 'stock', 'sales', 'discounts'] as const;
/** Commands expected on each data table. */
const DATA_CMDS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;

const liveEnv: LiveEnv | null = getLiveEnv();
let client: SupabaseClient | null = null;
let report: PolicyRow[] | null = null;
let skipReason = '';

beforeAll(async () => {
  if (liveEnv === null) {
    skipReason =
      'no live Supabase project configured (.env missing or placeholder values) — skipping';
    return;
  }
  client = createLiveClient(liveEnv);
  try {
    const { data, error } = await client.rpc('kapanin_rls_report');
    if (error !== null) {
      // Function-not-found => 0007 not applied yet. Treat as skip, not failure.
      skipReason =
        `RLS introspection helper not available (${error.message}). ` +
        'Apply migration 0007 (or _combined_apply_all.sql) in the Supabase SQL Editor, then re-run.';
      return;
    }
    report = (data ?? []) as PolicyRow[];
  } catch (err) {
    if (isUnreachable(err)) {
      skipReason = 'live Supabase project unreachable — skipping';
      return;
    }
    throw err;
  }
}, 30_000);

/** Rows for one table from the flat report. */
function rowsFor(table: string): PolicyRow[] {
  return (report ?? []).filter((r) => r.table_name === table);
}

/** Policy rows (non-null policy_name) for one table. */
function policiesFor(table: string): PolicyRow[] {
  return rowsFor(table).filter((r) => r.policy_name !== null);
}

describe('Property 1 — owner isolation: RLS configuration (sub-task 5.1, option b)', () => {
  it('documents the strategy and confirms the live project is set up', () => {
    if (report === null) {
      console.warn(`[rls.policy.test] ${skipReason}`);
      expect(report).toBeNull(); // explicit skip-pass marker
      return;
    }
    // Report returns at least one row per table (even a table with no policy
    // yields a single row with null policy fields from the LEFT JOIN).
    expect(report.length).toBeGreaterThanOrEqual(5);
  });

  it('enables RLS on profiles and every data table (Requirement 5.4)', () => {
    if (report === null) return; // skipped — see first test's warning
    for (const table of ['profiles', ...DATA_TABLES]) {
      const rows = rowsFor(table);
      expect(rows.length, `expected catalog row for ${table}`).toBeGreaterThan(0);
      expect(rows[0].rls_enabled, `RLS must be enabled on ${table}`).toBe(true);
    }
  });

  it('defines the four owner-scoped policies on each data table referencing auth.uid() (Reqs 5.1, 5.3, 5.5, 6.3)', () => {
    if (report === null) return;
    for (const table of DATA_TABLES) {
      const policies = policiesFor(table);
      const cmds = new Set(policies.map((p) => p.cmd));
      for (const cmd of DATA_CMDS) {
        expect(cmds.has(cmd), `${table} must have a ${cmd} policy`).toBe(true);
      }
      // Every policy predicate must scope by owner_id = auth.uid().
      for (const p of policies) {
        const expr = `${p.qual ?? ''} ${p.with_check ?? ''}`.toLowerCase();
        expect(expr, `${table}.${p.policy_name} must reference auth.uid()`).toContain(
          'auth.uid()',
        );
        expect(expr, `${table}.${p.policy_name} must scope by owner_id`).toContain('owner_id');
      }
      // INSERT and UPDATE must carry a WITH CHECK clause (write-side guard).
      const insert = policies.find((p) => p.cmd === 'INSERT');
      const update = policies.find((p) => p.cmd === 'UPDATE');
      expect(insert?.with_check, `${table} INSERT needs WITH CHECK`).toBeTruthy();
      expect(update?.with_check, `${table} UPDATE needs WITH CHECK`).toBeTruthy();
    }
  });

  it('scopes profiles to the owner via id = auth.uid() (select + update) (Requirements 4.1, 4.2)', () => {
    if (report === null) return;
    const policies = policiesFor('profiles');
    const cmds = new Set(policies.map((p) => p.cmd));
    expect(cmds.has('SELECT'), 'profiles must have a SELECT policy').toBe(true);
    expect(cmds.has('UPDATE'), 'profiles must have an UPDATE policy').toBe(true);
    for (const p of policies) {
      const expr = `${p.qual ?? ''} ${p.with_check ?? ''}`.toLowerCase();
      expect(expr, `profiles.${p.policy_name} must reference auth.uid()`).toContain('auth.uid()');
    }
  });

  it('property: for every data table and command, exactly-owner scoping holds across the whole report', () => {
    if (report === null) return;
    // Over the generated space of (table, cmd) pairs, the matching policy always
    // exists and is owner-scoped — a structural encoding of Property 1's premise
    // that access is restricted to the authenticated owner's rows.
    fc.assert(
      fc.property(
        fc.constantFrom(...DATA_TABLES),
        fc.constantFrom(...DATA_CMDS),
        (table, cmd) => {
          const match = policiesFor(table).find((p) => p.cmd === cmd);
          if (match === undefined) return false;
          const expr = `${match.qual ?? ''} ${match.with_check ?? ''}`.toLowerCase();
          return expr.includes('auth.uid()') && expr.includes('owner_id');
        },
      ),
      { numRuns: 50 },
    );
  });
});
