-- HU-ASMS: Post-Deployment Security & Storage Hardening (Forward Migration Only)
-- Strictly additive/forward remediation following read-only audit of tkdrxfvxryemfdrwcmay:
--   1. Revoke TRUNCATE, TRIGGER, REFERENCES from authenticated on public.student_verification_tokens
--      (because Migration 05's REVOKE ran prior to Migration 09's CREATE TABLE).
--   2. Configure ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public to revoke
--      TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated on future tables while
--      preserving SELECT, INSERT, UPDATE, DELETE required for RLS-governed SSR Server Actions
--      (anon remains revoked per Migration 05; service_role retains full access).
--   3. Recreate "System Owners manage student verification tokens" explicitly TO authenticated
--      while preserving the exact public.auth_is_system_owner() authorization condition.
--   4. Align private bucket 'submission-files-vault'.file_size_limit from 52428800 (50 MB)
--      to 20971520 bytes (20 MB), matching Telegram Cloud Bot API getFile and chk_project_file_rules_max_size.

-- ============================================================================
-- 1. REVOKE EXCESS TABLE PRIVILEGES ON public.student_verification_tokens
-- ============================================================================

REVOKE TRUNCATE, TRIGGER, REFERENCES
  ON TABLE public.student_verification_tokens
  FROM authenticated;

-- ============================================================================
-- 2. DEFAULT TABLE PRIVILEGES FOR FUTURE TABLES IN public (postgres OWNER)
-- ============================================================================
-- Verified live pg_default_acl: postgres in schema public previously defaulted
-- to granting authenticated arwdDxtm (including TRUNCATE/TRIGGER/REFERENCES).
-- Revoking only TRUNCATE, TRIGGER, REFERENCES preserves SELECT/INSERT/UPDATE/DELETE
-- under RLS for future application tables while preventing RLS bypass via TRUNCATE.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated;

DO $$
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin') THEN
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated',
      current_user
    );
  END IF;
END
$$;

-- ============================================================================
-- 3. SCOPE VERIFICATION TOKEN RLS POLICY EXPLICITLY TO authenticated
-- ============================================================================

DROP POLICY IF EXISTS "System Owners manage student verification tokens"
  ON public.student_verification_tokens;

CREATE POLICY "System Owners manage student verification tokens"
ON public.student_verification_tokens
FOR ALL
TO authenticated
USING (public.auth_is_system_owner())
WITH CHECK (public.auth_is_system_owner());

-- ============================================================================
-- 4. ALIGN STORAGE BUCKET FILE SIZE LIMIT TO 20 MB (20,971,520 BYTES)
-- ============================================================================

UPDATE storage.buckets
SET file_size_limit = 20971520,
    updated_at = clock_timestamp()
WHERE id = 'submission-files-vault';

-- ============================================================================
-- 5. POST-APPLY ASSERTIONS
-- ============================================================================

DO $$
DECLARE
  v_bucket_public BOOLEAN;
  v_bucket_limit BIGINT;
  v_policy_roles NAME[];
BEGIN
  IF has_table_privilege('authenticated', 'public.student_verification_tokens', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.student_verification_tokens', 'TRIGGER')
     OR has_table_privilege('authenticated', 'public.student_verification_tokens', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.student_verification_tokens', 'UPDATE') THEN
    RAISE EXCEPTION 'Privilege hardening check failed on public.student_verification_tokens for authenticated.';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.student_verification_tokens', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.student_verification_tokens', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.student_verification_tokens', 'DELETE') THEN
    RAISE EXCEPTION 'Required SELECT/INSERT/DELETE privileges missing on public.student_verification_tokens for authenticated.';
  END IF;

  SELECT p.roles
  INTO v_policy_roles
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.tablename = 'student_verification_tokens'
    AND p.policyname = 'System Owners manage student verification tokens';

  IF v_policy_roles IS DISTINCT FROM ARRAY['authenticated']::NAME[] THEN
    RAISE EXCEPTION 'Expected token policy role {authenticated}, found %.', v_policy_roles;
  END IF;

  SELECT b.public, b.file_size_limit
  INTO v_bucket_public, v_bucket_limit
  FROM storage.buckets b
  WHERE b.id = 'submission-files-vault';

  IF NOT FOUND OR v_bucket_public IS DISTINCT FROM false OR v_bucket_limit IS DISTINCT FROM 20971520 THEN
    RAISE EXCEPTION 'Storage bucket submission-files-vault verification failed (public=%, limit=%).', v_bucket_public, v_bucket_limit;
  END IF;
END
$$;
