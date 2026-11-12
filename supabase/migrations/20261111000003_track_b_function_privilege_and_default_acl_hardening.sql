-- =============================================================================
-- HU-ASMS — Track B Least-Privilege Function ACL & Default Privilege Hardening
-- Target Migration: 20261111000003
-- =============================================================================
-- Enforces strict least-privilege EXECUTE grants across all 18 public functions
-- created across migrations 20261110000001..20261110000005 and
-- 20261111000001..20261111000002, replacing blanket authenticated grants and
-- stripping PostgreSQL's default PUBLIC/anon/authenticated function privileges:
--
--   1. Trigger functions (9) + unused helper auth_get_assigned_section_ids (1):
--      REVOKE ALL FROM PUBLIC, anon, authenticated, service_role
--      (PostgreSQL checks trigger EXECUTE only at CREATE TRIGGER time, not on DML.)
--   2. Service-only administrative function (1): admin_set_profile_status
--      REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role
--   3. SSR-only authenticated audit helper (1): record_scoped_audit_log
--      REVOKE ALL FROM PUBLIC, anon, service_role; GRANT EXECUTE TO authenticated
--      (Body rejects auth.uid() IS NULL, so service_role without user sub fails anyway.)
--   4. Scoped RLS / SECURITY INVOKER trigger / SSR-coupled functions (6):
--      REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated, service_role
--      (approve_student_registration & reject_student_registration remain coupled
--       to admin/students/page.tsx Server Actions until refactored to service_role.)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Trigger Functions (9) & Unused Helper (1) — Owner Only (postgres)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.auth_get_assigned_section_ids() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_timestamp_column() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_single_group_per_project() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.check_and_update_group_verification() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_profile_privileged_columns() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.enforce_group_integrity() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_group_member_integrity() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_group_member_size_bounds() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_delivery_integrity() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_delivery_item_integrity() FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Service-Only Administrative Function (1) — service_role Only
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.admin_set_profile_status(UUID, public.user_role, BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_status(UUID, public.user_role, BOOLEAN) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Scoped Audit Log Helper (1) — authenticated Only (requires auth.uid())
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.record_scoped_audit_log(TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_scoped_audit_log(TEXT, TEXT, UUID, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS / Trigger Helpers (3), Scoped Rep Workflow (1),
--    and SSR-Coupled Admin Workflows (2) — authenticated, service_role Only
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.auth_is_system_owner() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_is_system_owner() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.auth_is_rep_for_section(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_is_rep_for_section(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_project_targeted_to_section(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_project_targeted_to_section(UUID, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.approve_student_registration(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_student_registration(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reject_student_registration(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_student_registration(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_delivery_sent_with_audit(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_delivery_sent_with_audit(UUID, TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Default Function Privileges — Block Implicit PUBLIC, anon, authenticated
-- ---------------------------------------------------------------------------
-- cli_login_postgres operates under role postgres when creating functions.
-- Revoke implicit default EXECUTE on newly created public functions from PUBLIC,
-- anon, and authenticated (without weakening existing grants or table/sequence ACLs).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin') THEN
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated',
      current_user
    );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin')
     AND pg_has_role(current_user, 'supabase_admin', 'MEMBER') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
      REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 6. Post-Apply Least-Privilege Verification (4-Bucket ACL Assertion)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_sig TEXT;
  v_oid REGPROCEDURE;
  v_owner_only_sigs CONSTANT TEXT[] := ARRAY[
    'public.auth_get_assigned_section_ids()',
    'public.update_timestamp_column()',
    'public.enforce_single_group_per_project()',
    'public.check_and_update_group_verification()',
    'public.protect_profile_privileged_columns()',
    'public.enforce_group_integrity()',
    'public.enforce_group_member_integrity()',
    'public.enforce_group_member_size_bounds()',
    'public.enforce_delivery_integrity()',
    'public.enforce_delivery_item_integrity()'
  ];
  v_service_only_sigs CONSTANT TEXT[] := ARRAY[
    'public.admin_set_profile_status(uuid, public.user_role, boolean)'
  ];
  v_authenticated_only_sigs CONSTANT TEXT[] := ARRAY[
    'public.record_scoped_audit_log(text, text, uuid, jsonb)'
  ];
  v_auth_and_service_sigs CONSTANT TEXT[] := ARRAY[
    'public.auth_is_system_owner()',
    'public.auth_is_rep_for_section(uuid)',
    'public.is_project_targeted_to_section(uuid, uuid)',
    'public.approve_student_registration(uuid, text)',
    'public.reject_student_registration(uuid, text)',
    'public.mark_delivery_sent_with_audit(uuid, text)'
  ];
BEGIN
  -- Bucket 1: Owner-only (10 functions — no PUBLIC, anon, authenticated, service_role)
  FOREACH v_sig IN ARRAY v_owner_only_sigs LOOP
    v_oid := to_regprocedure(v_sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Missing expected public function: %', v_sig;
    END IF;
    IF has_function_privilege('public', v_oid, 'EXECUTE')
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Least-privilege violation on owner-only function: %', v_sig;
    END IF;
  END LOOP;

  -- Bucket 2: service_role-only (1 function — admin_set_profile_status)
  FOREACH v_sig IN ARRAY v_service_only_sigs LOOP
    v_oid := to_regprocedure(v_sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Missing expected public function: %', v_sig;
    END IF;
    IF has_function_privilege('public', v_oid, 'EXECUTE')
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Least-privilege violation on service-only function: %', v_sig;
    END IF;
  END LOOP;

  -- Bucket 3: authenticated-only (1 function — record_scoped_audit_log)
  FOREACH v_sig IN ARRAY v_authenticated_only_sigs LOOP
    v_oid := to_regprocedure(v_sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Missing expected public function: %', v_sig;
    END IF;
    IF has_function_privilege('public', v_oid, 'EXECUTE')
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Least-privilege violation on authenticated-only function: %', v_sig;
    END IF;
  END LOOP;

  -- Bucket 4: authenticated + service_role only (6 functions)
  FOREACH v_sig IN ARRAY v_auth_and_service_sigs LOOP
    v_oid := to_regprocedure(v_sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Missing expected public function: %', v_sig;
    END IF;
    IF has_function_privilege('public', v_oid, 'EXECUTE')
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Least-privilege violation on scoped/coupled function: %', v_sig;
    END IF;
  END LOOP;
END
$$;
