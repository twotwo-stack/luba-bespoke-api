-- Migration: 008_admin_infrastructure.sql
-- Run against: uxhqlwxcnxawctwzzlza (Luba Bespoke DB)
--
-- Adds admin roles, audit log, price change workflow, and engineer profiles
-- to mirror Cleaning platform infrastructure. Uses Supabase Auth for admin identity.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Admin role enum
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bespoke_admin_role') THEN
    CREATE TYPE bespoke_admin_role AS ENUM ('master', 'super_admin', 'admin', 'engineer');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Admin roles (Supabase Auth-based)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_roles (
  id          uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid                NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        bespoke_admin_role  NOT NULL DEFAULT 'admin',
  notes       text,
  created_at  timestamptz         NOT NULL DEFAULT now(),
  created_by  uuid                REFERENCES auth.users(id),
  CONSTRAINT admin_roles_user_id_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS admin_roles_user_id ON admin_roles(user_id);

ALTER TABLE admin_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access" ON admin_roles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Admin audit log
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  actor_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email  text,
  action       text        NOT NULL,
  entity_type  text,
  entity_id    uuid,
  details      jsonb
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_at ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_actor_id    ON admin_audit_log(actor_id);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access" ON admin_audit_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Engineer profiles (mirrors Cleaning pattern)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS engineer_profiles (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  user_id        uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text        NOT NULL,
  email          text        NOT NULL UNIQUE,
  phone          text,
  active         boolean     NOT NULL DEFAULT true,
  role           bespoke_admin_role NOT NULL DEFAULT 'engineer',
  notes          text
);

ALTER TABLE engineer_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access" ON engineer_profiles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Pending price changes (services + partner pricing approval queue)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pending_price_changes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  entity_type      text        NOT NULL DEFAULT 'service',  -- 'service', 'partner_rate'
  entity_id        uuid        NOT NULL,
  partner_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  partner_email    text,
  current_price    integer     NOT NULL,  -- cents
  requested_price  integer     NOT NULL,  -- cents
  reason           text,
  status           text        NOT NULL DEFAULT 'pending',  -- 'pending', 'approved', 'rejected'
  reviewed_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at      timestamptz,
  review_notes     text
);

CREATE INDEX IF NOT EXISTS pending_price_changes_status  ON pending_price_changes(status, created_at DESC);
CREATE INDEX IF NOT EXISTS pending_price_changes_entity  ON pending_price_changes(entity_id);

ALTER TABLE pending_price_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access" ON pending_price_changes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Feature flag additions
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO feature_flags (key, enabled, description) VALUES
  ('use_supabase_jwt_auth',    false, 'Use Supabase Auth JWT for all admin routes (replaces secret-based auth)'),
  ('dual_auth_mode',           true,  'Accept both legacy admin secret and new Supabase JWT during migration'),
  ('enable_price_approvals',   true,  'Require admin approval for all partner price change requests'),
  ('enable_audit_log',         true,  'Log all admin actions to admin_audit_log')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE: After running this migration, seed admin_roles manually:
--   1. Create users in Supabase Auth dashboard for buk@chaosclubdigital.com + Jermaine
--   2. INSERT INTO admin_roles (user_id, role) VALUES ('<uuid>', 'master')
-- ─────────────────────────────────────────────────────────────────────────────
