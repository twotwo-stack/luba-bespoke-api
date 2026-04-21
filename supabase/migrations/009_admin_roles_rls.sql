-- migration 009: add RLS policies to Bespoke admin_roles table
-- Mirrors the pattern from Cleaning migration 019 for consistency.
-- Idempotent: uses DROP POLICY IF EXISTS before CREATE POLICY.
--
-- Run in: https://supabase.com/dashboard/project/uxhqlwxcnxawctwzzlza/sql/new
-- (Run AFTER migration 008 which creates the admin_roles table)

-- Ensure RLS is enabled (idempotent -- safe to run if already enabled)
alter table admin_roles enable row level security;

-- ── Drop existing policies (safe to run repeatedly) ──────────────────────────

drop policy if exists "service_role full access on admin_roles" on admin_roles;
drop policy if exists "users read own role"                     on admin_roles;
drop policy if exists "master and super_admin read all roles"   on admin_roles;

-- ── Recreate policies ─────────────────────────────────────────────────────────

-- 1. Service role has unrestricted access (used by API server only)
create policy "service_role full access on admin_roles"
  on admin_roles for all to service_role
  using (true) with check (true);

-- 2. Authenticated users can read their own role record
create policy "users read own role"
  on admin_roles for select to authenticated
  using (user_id = auth.uid());

-- 3. Master and super_admin can read all role records
--    Note: uses bespoke_admin_role values ('master', 'super_admin')
create policy "master and super_admin read all roles"
  on admin_roles for select to authenticated
  using (
    exists (
      select 1 from admin_roles ar
      where ar.user_id = auth.uid()
        and ar.role in ('master', 'super_admin')
    )
  );
