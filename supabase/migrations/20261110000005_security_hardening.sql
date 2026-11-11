-- HU-ASMS: Migration 05 - Mandatory Security Hardening (Phase 14 Step 2B Remediation)
-- Prevents profile role escalation, secures function search_paths, enforces narrow audit RPC, and locks down grants

-- ============================================================================
-- 1. HARDEN SECURITY DEFINER & TRIGGER FUNCTIONS (IMMUTABLE SEARCH_PATH & QUALIFIED OBJECTS)
-- ============================================================================

-- Function: auth_is_system_owner() with SET search_path = ''
CREATE OR REPLACE FUNCTION public.auth_is_system_owner()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND role = 'system_owner'::public.user_role
          AND is_active = true
    );
END;
$$;

-- Function: auth_is_rep_for_section() with SET search_path = ''
CREATE OR REPLACE FUNCTION public.auth_is_rep_for_section(p_section_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.representative_assignments
        WHERE profile_id = auth.uid()
          AND section_id = p_section_id
          AND is_active = true
    );
END;
$$;

-- Function: auth_get_assigned_section_ids() with SET search_path = ''
CREATE OR REPLACE FUNCTION public.auth_get_assigned_section_ids()
RETURNS TABLE(section_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN QUERY
    SELECT ra.section_id
    FROM public.representative_assignments ra
    WHERE ra.profile_id = auth.uid()
      AND ra.is_active = true;
END;
$$;

-- Function Execution Privileges
REVOKE ALL ON FUNCTION public.auth_is_system_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_is_system_owner() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.auth_is_rep_for_section(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_is_rep_for_section(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.auth_get_assigned_section_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_get_assigned_section_ids() TO authenticated, service_role;

-- Harden Utility & Trigger Functions with SET search_path = '' and fully qualified names
CREATE OR REPLACE FUNCTION public.update_timestamp_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = clock_timestamp();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_single_group_per_project()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_project_id UUID;
    v_existing_group_count INT;
BEGIN
    SELECT project_id INTO v_project_id FROM public.groups WHERE id = NEW.group_id;

    SELECT COUNT(*) INTO v_existing_group_count
    FROM public.group_members gm
    JOIN public.groups g ON g.id = gm.group_id
    WHERE gm.student_id = NEW.student_id
      AND g.project_id = v_project_id
      AND gm.group_id <> NEW.group_id
      AND gm.confirmation_status IN ('pending', 'confirmed');

    IF v_existing_group_count > 0 THEN
        RAISE EXCEPTION 'Student % is already assigned to another group for project %', NEW.student_id, v_project_id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_and_update_group_verification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_total_members INT;
    v_confirmed_members INT;
    v_declined_members INT;
BEGIN
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE confirmation_status = 'confirmed'),
        COUNT(*) FILTER (WHERE confirmation_status = 'declined')
    INTO v_total_members, v_confirmed_members, v_declined_members
    FROM public.group_members
    WHERE group_id = NEW.group_id;

    IF v_total_members > 0 AND v_confirmed_members = v_total_members THEN
        UPDATE public.groups SET status = 'verified', updated_at = clock_timestamp()
        WHERE id = NEW.group_id AND status = 'pending';
    ELSIF v_declined_members > 0 THEN
        UPDATE public.groups SET status = 'pending', updated_at = clock_timestamp()
        WHERE id = NEW.group_id AND status = 'verified';
    END IF;

    RETURN NEW;
END;
$$;

-- ============================================================================
-- 2. PROFILE PRIVILEGE PROTECTION (PREVENT SELF-ROLE ESCALATION)
-- ============================================================================

-- Trigger (SECURITY INVOKER so current_user reflects actual caller role)
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF (OLD.role IS DISTINCT FROM NEW.role OR OLD.is_active IS DISTINCT FROM NEW.is_active) THEN
        IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin')
           AND COALESCE(auth.role(), '') <> 'service_role'
           AND NOT public.auth_is_system_owner() THEN
            RAISE EXCEPTION 'Privilege Escalation Blocked: Only a System Owner or trusted backend service may modify role or activation status.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_profile_privileged_columns() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.protect_profile_privileged_columns() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_protect_profile_privileges ON public.profiles;
CREATE TRIGGER trg_protect_profile_privileges
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileged_columns();

-- Harden RLS Policy for Profile Self-Updates
DROP POLICY IF EXISTS "users_update_own_profile" ON public.profiles;
CREATE POLICY "users_update_own_profile" ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (id = auth.uid())
    WITH CHECK (
        id = auth.uid()
        AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
        AND is_active = (SELECT p.is_active FROM public.profiles p WHERE p.id = auth.uid())
    );

-- Administrative helper: Securely set profile role or active status via verified System Owner or service_role
CREATE OR REPLACE FUNCTION public.admin_set_profile_status(
    p_target_id UUID,
    p_new_role public.user_role DEFAULT NULL,
    p_new_active BOOLEAN DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Inside SECURITY DEFINER, verify JWT owner / service_role or direct DBA session_user (never current_user)
    IF NOT (
        public.auth_is_system_owner()
        OR COALESCE(auth.role(), '') = 'service_role'
        OR session_user IN ('postgres', 'supabase_admin')
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Only a System Owner or service_role can update profile roles or activation status.';
    END IF;

    UPDATE public.profiles
    SET role = COALESCE(p_new_role, role),
        is_active = COALESCE(p_new_active, is_active),
        updated_at = clock_timestamp()
    WHERE id = p_target_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target profile % not found.', p_target_id;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_profile_status(UUID, public.user_role, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_status(UUID, public.user_role, BOOLEAN) TO authenticated, service_role;

-- ============================================================================
-- 3. NARROW SCOPED AUDIT LOG WRITER (BLOCKS FABRICATION & IMPERSONATION)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_scoped_audit_log(
    p_action TEXT,
    p_entity_type TEXT,
    p_entity_id UUID,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_id UUID;
    v_actor_role TEXT;
    v_is_active BOOLEAN;
    v_section_id UUID;
    v_audit_id UUID;
BEGIN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authenticated session required to record audit log.';
    END IF;

    -- Derive actor_role strictly from authoritative profile row (prevents spoofing)
    SELECT p.role::text, p.is_active
    INTO v_actor_role, v_is_active
    FROM public.profiles p
    WHERE p.id = v_actor_id;

    IF v_actor_role IS NULL OR v_is_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Forbidden: Active staff profile required to record audit events.';
    END IF;

    -- Allowlist only representative/owner portal workflow events & resolve real target section
    IF p_action = 'GROUP_PRECREATED' AND p_entity_type = 'group' THEN
        SELECT g.section_id INTO v_section_id
        FROM public.groups g
        WHERE g.id = p_entity_id;
    ELSIF p_action IN (
        'TEACHER_DELIVERY_PREPARED',
        'TEACHER_DELIVERY_DISPATCHED',
        'TEACHER_DELIVERY_ACKNOWLEDGED'
    ) AND p_entity_type = 'delivery' THEN
        SELECT d.section_id INTO v_section_id
        FROM public.deliveries d
        WHERE d.id = p_entity_id;
    ELSE
        RAISE EXCEPTION 'Forbidden: Invalid or unpermitted audit action "%" for entity "%".', p_action, p_entity_type;
    END IF;

    IF v_section_id IS NULL THEN
        RAISE EXCEPTION 'Invalid audit target: % (%) not found.', p_entity_type, p_entity_id;
    END IF;

    IF NOT (public.auth_is_system_owner() OR public.auth_is_rep_for_section(v_section_id)) THEN
        RAISE EXCEPTION 'Forbidden: Access denied for audit logging in section %.', v_section_id;
    END IF;

    INSERT INTO public.audit_logs (
        actor_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_actor_id,
        v_actor_role,
        p_action,
        p_entity_type,
        p_entity_id,
        COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING id INTO v_audit_id;

    RETURN v_audit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_scoped_audit_log(TEXT, TEXT, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_scoped_audit_log(TEXT, TEXT, UUID, JSONB) TO authenticated, service_role;

-- ============================================================================
-- 4. POSTGRESQL TABLE, COLUMN & DEFAULT GRANTS HARDENING
-- ============================================================================

-- A. Revoke ALL table and sequence access from anon role (Zero anonymous access)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- B. Revoke TRUNCATE, TRIGGER, REFERENCES across all tables from authenticated (RLS does not block TRUNCATE)
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM authenticated;

-- C. Restrict column-level UPDATE on profiles for authenticated users
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, phone, telegram_username) ON public.profiles TO authenticated;

-- D. Immutable Audit & Snapshot Tables: Forbid direct writes / truncation for authenticated
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.identity_change_history FROM authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.submission_members FROM authenticated;

-- E. Service Role retains full privileges for trusted backend bot & server tasks
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
