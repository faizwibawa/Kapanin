-- 0001_profiles.sql
-- Kapanin schema: profiles table (1:1 with auth.users).
--
-- Tables only in this phase. RLS enablement and the profile auto-creation
-- trigger (handle_new_user / on_auth_user_created) are added in a later
-- migration (Task 5), NOT here.
--
-- profiles.id equals auth.users(id) (no gen_random_uuid default): the profile
-- row is keyed by the owning user and cascades away if that user is deleted.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  shop_name text,
  owner_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
