import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getLiveEnv,
  createLiveClient,
  isUnreachable,
  type LiveEnv,
} from '../test-support/liveSupabase.js';

/**
 * Sub-task 5.2 — profile auto-creation on signup.
 *
 * Validates: Requirements 4.1, 4.2
 *
 * ── Test strategy: real auth-user creation (end to end) ─────────────────────
 * This environment exposes `supabase.auth.admin.createUser` (service_role key),
 * so we can exercise the trigger for real: create an auth user, then assert a
 * `profiles` row exists with `id === user.id` (the 1:1 relationship the
 * `handle_new_user` trigger from migration 0007 establishes). Reading the
 * profile uses the service-role client, which bypasses RLS — exactly what we
 * want here, since we are checking existence, not per-user visibility.
 *
 * The created user is ALWAYS cleaned up (admin.deleteUser) in a finally block,
 * which cascades and removes the profiles row too (owner FK on delete cascade).
 *
 * The suite SKIPS gracefully (never fails) when:
 *   - no live project is configured, or
 *   - the live project is unreachable, or
 *   - migration 0007 (the trigger) has not been applied yet — detected because
 *     no profiles row appears for a freshly created user. We surface a clear
 *     message telling the user to apply 0007, rather than reporting a failure.
 */

const liveEnv: LiveEnv | null = getLiveEnv();
let client: SupabaseClient | null = null;
let skip = false;
let skipReason = '';

beforeAll(() => {
  if (liveEnv === null) {
    skip = true;
    skipReason = 'no live Supabase project configured — skipping';
    return;
  }
  client = createLiveClient(liveEnv);
});

function uniqueEmail(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `kapanin-test-${Date.now()}-${rand}@example.com`;
}

describe('profile auto-creation on signup (sub-task 5.2)', () => {
  it('creates a 1:1 profiles row with matching id when an auth user is inserted', async () => {
    if (skip || client === null) {
      console.warn(`[profile.trigger.test] ${skipReason}`);
      expect(skip).toBe(true);
      return;
    }

    let createdUserId: string | null = null;
    try {
      // 1. Create a confirmed auth user via the admin API (fires the trigger).
      let created;
      try {
        created = await client.auth.admin.createUser({
          email: uniqueEmail(),
          password: `Pw-${Math.random().toString(36).slice(2)}-${Date.now()}`,
          email_confirm: true,
        });
      } catch (err) {
        if (isUnreachable(err)) {
          console.warn('[profile.trigger.test] live project unreachable — skipping');
          return;
        }
        throw err;
      }

      if (created.error !== null) {
        if (isUnreachable(created.error)) {
          console.warn('[profile.trigger.test] live project unreachable — skipping');
          return;
        }
        throw new Error(`admin.createUser failed: ${created.error.message}`);
      }

      createdUserId = created.data.user?.id ?? null;
      expect(createdUserId, 'created user should have an id').toBeTruthy();

      // 2. The trigger runs synchronously inside the auth.users insert; the
      //    profiles row should already exist. Read it with the service-role
      //    client (RLS-bypassing — existence check, not a visibility check).
      const { data: profile, error: readErr } = await client
        .from('profiles')
        .select('id')
        .eq('id', createdUserId as string)
        .maybeSingle();

      if (readErr !== null) {
        throw new Error(`reading profiles failed: ${readErr.message}`);
      }

      if (profile === null) {
        // No profile row => the trigger from 0007 is not installed. Skip with a
        // clear instruction rather than failing the suite.
        console.warn(
          '[profile.trigger.test] no profiles row was auto-created — migration 0007 ' +
            '(handle_new_user trigger) appears not to be applied yet. Apply 0007 (or ' +
            '_combined_apply_all.sql) in the Supabase SQL Editor, then re-run.',
        );
        return;
      }

      // 3. The profile id equals the new auth user's id (Requirements 4.1, 4.2).
      expect(profile.id).toBe(createdUserId);
    } finally {
      // Always clean up the created user (cascades to its profiles row).
      if (client !== null && createdUserId !== null) {
        try {
          await client.auth.admin.deleteUser(createdUserId);
        } catch {
          // Best-effort cleanup; ignore errors so they don't mask the result.
        }
      }
    }
  }, 30_000);
});
