-- HU-ASMS Phase 14 Track B: Atomic Transactional RPCs & Database Integrity Parity
-- Local staged forward migration (DO NOT apply remotely while deployment freeze is active).
--
-- Remediates Track B Final Review findings C1, C2, and C3:
--   C1: Atomic teacher delivery dispatch + transactional audit_logs RPC (`mark_delivery_sent_with_audit`),
--       eliminating non-atomic post-handover status/audit splits and prohibiting 'sent' -> 'prepared' reverts.
--   C2: Partial unique indexes on pending `registration_requests` plus atomic approval/rejection RPCs
--       (`approve_student_registration`, `reject_student_registration`) with row locking (`FOR UPDATE`).
--   C3: Database-level authorization & integrity parity on `groups`, `group_members`, `deliveries`,
--       and `delivery_items` (including tightened `delivery_items`, `groups`, and `group_members` RLS policies),
--       blocking representative self-verification bypasses and untargeted/inactive/cross-section payloads.

-- ============================================================================
-- 1. C2: PENDING REGISTRATION REQUEST UNIQUENESS CONSTRAINTS
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_registration_request_hu_id
    ON public.registration_requests (hu_student_id)
    WHERE status = 'pending'::public.request_status;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_registration_request_telegram_id
    ON public.registration_requests (telegram_user_id)
    WHERE status = 'pending'::public.request_status;

-- ============================================================================
-- 2. C2: ATOMIC STUDENT REGISTRATION APPROVAL & REJECTION RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.approve_student_registration(
    p_request_id UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_id UUID;
    v_req public.registration_requests%ROWTYPE;
    v_existing_student_id UUID;
    v_student_id UUID;
    v_clean_notes TEXT;
    v_reviewed_at TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF p_request_id IS NULL THEN
        RAISE EXCEPTION 'Invalid registration request identifier.';
    END IF;

    v_actor_id := auth.uid();
    IF v_actor_id IS NOT NULL THEN
        IF NOT public.auth_is_system_owner() THEN
            RAISE EXCEPTION 'Forbidden: Active System Owner role required to approve student registrations.';
        END IF;
    ELSE
        IF COALESCE(auth.role(), '') <> 'service_role'
           AND session_user NOT IN ('postgres', 'supabase_admin') THEN
            RAISE EXCEPTION 'Unauthorized: Active System Owner session or trusted service role required.';
        END IF;
    END IF;

    v_clean_notes := LEFT(NULLIF(BTRIM(COALESCE(p_notes, '')), ''), 500);

    SELECT *
    INTO v_req
    FROM public.registration_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registration request not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_req.status <> 'pending'::public.request_status THEN
        RAISE EXCEPTION 'Registration request has already been processed (%).', v_req.status
            USING ERRCODE = 'P0001';
    END IF;

    SELECT s.id
    INTO v_existing_student_id
    FROM public.students s
    WHERE s.hu_student_id = v_req.hu_student_id
       OR s.telegram_user_id = v_req.telegram_user_id
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        RAISE EXCEPTION 'Duplicate student conflict: HU Student ID or Telegram account is already registered.'
            USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.students (
        hu_student_id,
        full_name,
        department_id,
        academic_year_id,
        section_id,
        telegram_user_id,
        telegram_username,
        registration_status,
        is_locked
    ) VALUES (
        v_req.hu_student_id,
        v_req.full_name,
        v_req.department_id,
        v_req.academic_year_id,
        v_req.section_id,
        v_req.telegram_user_id,
        v_req.telegram_username,
        'locked'::public.student_registration_status,
        true
    )
    RETURNING id INTO v_student_id;

    UPDATE public.registration_requests
    SET status = 'approved'::public.request_status,
        admin_notes = COALESCE(v_clean_notes, admin_notes),
        reviewed_by = v_actor_id,
        reviewed_at = v_reviewed_at,
        updated_at = v_reviewed_at
    WHERE id = p_request_id
      AND status = 'pending'::public.request_status;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registration request is no longer pending.' USING ERRCODE = 'P0001';
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
        CASE WHEN v_actor_id IS NOT NULL THEN 'system_owner' ELSE 'service_role' END,
        'STUDENT_REGISTRATION_APPROVED',
        'registration_request',
        p_request_id,
        jsonb_build_object(
            'student_id', v_student_id,
            'hu_student_id', v_req.hu_student_id,
            'section_id', v_req.section_id,
            'telegram_user_id', v_req.telegram_user_id,
            'notes', v_clean_notes
        )
    );

    RETURN jsonb_build_object(
        'request_id', p_request_id,
        'student_id', v_student_id,
        'status', 'approved'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_student_registration(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_student_registration(UUID, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reject_student_registration(
    p_request_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_id UUID;
    v_req public.registration_requests%ROWTYPE;
    v_reason TEXT;
    v_reviewed_at TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF p_request_id IS NULL THEN
        RAISE EXCEPTION 'Invalid registration request identifier.';
    END IF;

    v_actor_id := auth.uid();
    IF v_actor_id IS NOT NULL THEN
        IF NOT public.auth_is_system_owner() THEN
            RAISE EXCEPTION 'Forbidden: Active System Owner role required to reject student registrations.';
        END IF;
    ELSE
        IF COALESCE(auth.role(), '') <> 'service_role'
           AND session_user NOT IN ('postgres', 'supabase_admin') THEN
            RAISE EXCEPTION 'Unauthorized: Active System Owner session or trusted service role required.';
        END IF;
    END IF;

    v_reason := LEFT(COALESCE(NULLIF(BTRIM(COALESCE(p_reason, '')), ''), 'Identity verification mismatch'), 500);

    SELECT *
    INTO v_req
    FROM public.registration_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registration request not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_req.status <> 'pending'::public.request_status THEN
        RAISE EXCEPTION 'Registration request has already been processed (%).', v_req.status
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.registration_requests
    SET status = 'rejected'::public.request_status,
        admin_notes = v_reason,
        reviewed_by = v_actor_id,
        reviewed_at = v_reviewed_at,
        updated_at = v_reviewed_at
    WHERE id = p_request_id
      AND status = 'pending'::public.request_status;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registration request is no longer pending.' USING ERRCODE = 'P0001';
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
        CASE WHEN v_actor_id IS NOT NULL THEN 'system_owner' ELSE 'service_role' END,
        'STUDENT_REGISTRATION_REJECTED',
        'registration_request',
        p_request_id,
        jsonb_build_object(
            'hu_student_id', v_req.hu_student_id,
            'section_id', v_req.section_id,
            'reason', v_reason
        )
    );

    RETURN jsonb_build_object(
        'request_id', p_request_id,
        'status', 'rejected',
        'reason', v_reason
    );
END;
$$;

REVOKE ALL ON FUNCTION public.reject_student_registration(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_student_registration(UUID, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 3. C1: ATOMIC DELIVERY DISPATCH WITH TRANSACTIONAL AUDIT LOGGING
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mark_delivery_sent_with_audit(
    p_delivery_id UUID,
    p_dispatch_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_id UUID;
    v_actor_role TEXT;
    v_is_active BOOLEAN;
    v_delivery public.deliveries%ROWTYPE;
    v_item_count INT;
    v_clean_notes TEXT;
    v_sent_at TIMESTAMPTZ := clock_timestamp();
    v_audit_id UUID;
BEGIN
    IF p_delivery_id IS NULL THEN
        RAISE EXCEPTION 'Invalid delivery identifier.';
    END IF;

    v_actor_id := auth.uid();
    IF v_actor_id IS NOT NULL THEN
        SELECT p.role::text, p.is_active
        INTO v_actor_role, v_is_active
        FROM public.profiles p
        WHERE p.id = v_actor_id;

        IF v_actor_role IS NULL
           OR v_is_active IS DISTINCT FROM true
           OR v_actor_role NOT IN ('representative', 'system_owner') THEN
            RAISE EXCEPTION 'Forbidden: Active representative or system owner profile required.';
        END IF;
    ELSE
        IF COALESCE(auth.role(), '') <> 'service_role'
           AND session_user NOT IN ('postgres', 'supabase_admin') THEN
            RAISE EXCEPTION 'Unauthorized: Authenticated staff session required to dispatch delivery.';
        END IF;
        v_actor_role := 'service_role';
    END IF;

    SELECT *
    INTO v_delivery
    FROM public.deliveries
    WHERE id = p_delivery_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery record not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_actor_id IS NOT NULL
       AND NOT (public.auth_is_system_owner() OR public.auth_is_rep_for_section(v_delivery.section_id)) THEN
        RAISE EXCEPTION 'Forbidden: Section scope violation for delivery %.', p_delivery_id;
    END IF;

    IF v_delivery.status <> 'prepared'::public.delivery_status_enum THEN
        RAISE EXCEPTION 'Invalid delivery state transition: Expected "prepared" before dispatch, found "%".', v_delivery.status
            USING ERRCODE = 'P0001';
    END IF;

    SELECT COUNT(*)
    INTO v_item_count
    FROM public.delivery_items di
    WHERE di.delivery_id = p_delivery_id;

    IF v_item_count <= 0 OR v_item_count <> v_delivery.batch_count THEN
        RAISE EXCEPTION 'Delivery integrity check failed: batch_count (%) does not match committed delivery_items count (%).',
            v_delivery.batch_count, v_item_count;
    END IF;

    v_clean_notes := LEFT(NULLIF(BTRIM(COALESCE(p_dispatch_notes, '')), ''), 1000);

    UPDATE public.deliveries
    SET status = 'sent'::public.delivery_status_enum,
        sent_at = v_sent_at,
        delivery_notes = COALESCE(v_clean_notes, delivery_notes),
        updated_at = v_sent_at
    WHERE id = p_delivery_id
      AND status = 'prepared'::public.delivery_status_enum;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery is no longer in "prepared" status.' USING ERRCODE = 'P0001';
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
        'TEACHER_DELIVERY_DISPATCHED',
        'delivery',
        p_delivery_id,
        jsonb_build_object(
            'section_id', v_delivery.section_id,
            'project_id', v_delivery.project_id,
            'prepared_by', v_delivery.representative_id,
            'dispatched_by', v_actor_id,
            'batch_count', v_item_count,
            'notes', v_clean_notes
        )
    )
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object(
        'delivery_id', p_delivery_id,
        'status', 'sent',
        'sent_at', v_sent_at,
        'audit_id', v_audit_id,
        'batch_count', v_item_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_delivery_sent_with_audit(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_delivery_sent_with_audit(UUID, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 4. C3: PROJECT TARGETING HELPER & TRIGGER-LEVEL INTEGRITY PARITY
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_project_targeted_to_section(
    p_project_id UUID,
    p_section_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.sections s
        INNER JOIN public.project_targets pt ON pt.project_id = p_project_id
        WHERE s.id = p_section_id
          AND pt.academic_year_id = s.academic_year_id
          AND (pt.section_id IS NULL OR pt.section_id = p_section_id)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.is_project_targeted_to_section(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_project_targeted_to_section(UUID, UUID) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4A. Group Integrity & Self-Verification Prevention (`public.groups`)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_group_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_is_privileged BOOLEAN;
    v_project_active BOOLEAN;
    v_submission_type public.submission_type_enum;
    v_leader_section UUID;
    v_leader_status public.student_registration_status;
BEGIN
    v_is_privileged := (
        COALESCE(auth.role(), '') = 'service_role'
        OR session_user IN ('postgres', 'supabase_admin')
        OR public.auth_is_system_owner()
    );

    SELECT p.is_active, p.submission_type
    INTO v_project_active, v_submission_type
    FROM public.projects p
    WHERE p.id = NEW.project_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid group project reference: project % not found.', NEW.project_id;
    END IF;

    IF v_submission_type NOT IN ('group'::public.submission_type_enum, 'both'::public.submission_type_enum) THEN
        RAISE EXCEPTION 'Integrity Violation: Groups cannot be created for individual-only project %.', NEW.project_id;
    END IF;

    IF TG_OP = 'INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.section_id IS DISTINCT FROM OLD.section_id THEN
        IF v_project_active IS DISTINCT FROM true THEN
            RAISE EXCEPTION 'Integrity Violation: Project % is inactive and cannot accept new groups.', NEW.project_id;
        END IF;

        IF NOT public.is_project_targeted_to_section(NEW.project_id, NEW.section_id) THEN
            RAISE EXCEPTION 'Scope Violation: Project % is not targeted to section %.', NEW.project_id, NEW.section_id;
        END IF;
    END IF;

    IF NEW.group_leader_id IS NOT NULL THEN
        SELECT s.section_id, s.registration_status
        INTO v_leader_section, v_leader_status
        FROM public.students s
        WHERE s.id = NEW.group_leader_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Invalid group leader: student % not found.', NEW.group_leader_id;
        END IF;

        IF v_leader_section <> NEW.section_id THEN
            RAISE EXCEPTION 'Cross-section violation: Designated group leader belongs to a different section.';
        END IF;

        IF v_leader_status NOT IN ('approved'::public.student_registration_status, 'locked'::public.student_registration_status) THEN
            RAISE EXCEPTION 'Integrity Violation: Group leader must have an approved or locked student identity.';
        END IF;
    END IF;

    IF NOT v_is_privileged THEN
        IF TG_OP = 'INSERT' THEN
            IF NEW.status IN ('verified'::public.group_status, 'submitted'::public.group_status) THEN
                RAISE EXCEPTION 'Forbidden: Representatives cannot directly create verified or submitted groups.';
            END IF;

            IF auth.uid() IS NOT NULL AND NEW.created_by IS NOT NULL AND NEW.created_by <> auth.uid() THEN
                RAISE EXCEPTION 'Forbidden: Group creator attribution must match authenticated user.';
            END IF;
        ELSE
            IF NEW.project_id IS DISTINCT FROM OLD.project_id
               OR NEW.section_id IS DISTINCT FROM OLD.section_id
               OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
                RAISE EXCEPTION 'Forbidden: Project, section, and creator are immutable for existing groups.';
            END IF;

            IF NEW.status IS DISTINCT FROM OLD.status
               AND NEW.status IN ('verified'::public.group_status, 'submitted'::public.group_status) THEN
                RAISE EXCEPTION 'Forbidden: Only student confirmation consensus or backend submission processing may mark a group verified or submitted.';
            END IF;

            IF OLD.status = 'submitted'::public.group_status AND NEW.status IS DISTINCT FROM OLD.status THEN
                RAISE EXCEPTION 'Forbidden: Submitted groups cannot change lifecycle status from the representative portal.';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- Trigger functions do not require DML caller EXECUTE privileges in PostgreSQL; restrict to owner only
REVOKE ALL ON FUNCTION public.enforce_group_integrity() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_group_integrity ON public.groups;
CREATE TRIGGER trg_enforce_group_integrity
BEFORE INSERT OR UPDATE ON public.groups
FOR EACH ROW EXECUTE FUNCTION public.enforce_group_integrity();

-- ----------------------------------------------------------------------------
-- 4B. Group Member Section, Approved Identity, Size Bounds & Confirmation Guard
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_group_member_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_is_privileged BOOLEAN;
    v_group_section UUID;
    v_student_section UUID;
    v_student_status public.student_registration_status;
BEGIN
    v_is_privileged := (
        COALESCE(auth.role(), '') = 'service_role'
        OR session_user IN ('postgres', 'supabase_admin')
        OR public.auth_is_system_owner()
    );

    SELECT g.section_id
    INTO v_group_section
    FROM public.groups g
    WHERE g.id = NEW.group_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid group reference: group % not found.', NEW.group_id;
    END IF;

    SELECT s.section_id, s.registration_status
    INTO v_student_section, v_student_status
    FROM public.students s
    WHERE s.id = NEW.student_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid student reference: student % not found.', NEW.student_id;
    END IF;

    IF v_student_section <> v_group_section THEN
        RAISE EXCEPTION 'Cross-section violation: Student % is not enrolled in group section %.', NEW.student_id, v_group_section;
    END IF;

    IF NEW.confirmation_status IN ('pending'::public.membership_status, 'confirmed'::public.membership_status)
       AND v_student_status NOT IN ('approved'::public.student_registration_status, 'locked'::public.student_registration_status) THEN
        RAISE EXCEPTION 'Integrity Violation: Student % does not have an approved or locked academic identity.', NEW.student_id;
    END IF;

    IF NOT v_is_privileged THEN
        IF TG_OP = 'INSERT' THEN
            IF NEW.confirmation_status = 'confirmed'::public.membership_status OR NEW.confirmed_at IS NOT NULL THEN
                RAISE EXCEPTION 'Forbidden: Representatives cannot self-confirm group memberships.';
            END IF;
        ELSE
            IF NEW.group_id IS DISTINCT FROM OLD.group_id OR NEW.student_id IS DISTINCT FROM OLD.student_id THEN
                RAISE EXCEPTION 'Forbidden: Group and student bindings are immutable.';
            END IF;

            IF (NEW.confirmation_status = 'confirmed'::public.membership_status AND OLD.confirmation_status IS DISTINCT FROM 'confirmed'::public.membership_status)
               OR (NEW.confirmed_at IS NOT NULL AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at) THEN
                RAISE EXCEPTION 'Forbidden: Representatives cannot confirm group memberships on behalf of students.';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- Trigger functions do not require DML caller EXECUTE privileges in PostgreSQL; restrict to owner only
REVOKE ALL ON FUNCTION public.enforce_group_member_integrity() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_group_member_integrity ON public.group_members;
CREATE TRIGGER trg_enforce_group_member_integrity
BEFORE INSERT OR UPDATE ON public.group_members
FOR EACH ROW EXECUTE FUNCTION public.enforce_group_member_integrity();

-- Deferred constraint trigger checking min_group_size and max_group_size on transaction commit
CREATE OR REPLACE FUNCTION public.enforce_group_member_size_bounds()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_project_id UUID;
    v_group_status public.group_status;
    v_min_size INT;
    v_max_size INT;
    v_active_count INT;
BEGIN
    SELECT g.project_id, g.status
    INTO v_project_id, v_group_status
    FROM public.groups g
    WHERE g.id = NEW.group_id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- Cancelled groups no longer require active membership minimums
    IF v_group_status = 'cancelled'::public.group_status THEN
        RETURN NULL;
    END IF;

    SELECT
        COALESCE(pfr.min_group_size, 2),
        COALESCE(pfr.max_group_size, 10)
    INTO v_min_size, v_max_size
    FROM public.projects p
    LEFT JOIN public.project_file_rules pfr ON pfr.project_id = p.id
    WHERE p.id = v_project_id;

    SELECT COUNT(*)
    INTO v_active_count
    FROM public.group_members gm
    WHERE gm.group_id = NEW.group_id
      AND gm.confirmation_status IN ('pending'::public.membership_status, 'confirmed'::public.membership_status);

    IF v_active_count > v_max_size THEN
        RAISE EXCEPTION 'Group size exceeded: % active member(s) exceeds project maximum of %.',
            v_active_count, v_max_size;
    END IF;

    IF TG_OP = 'INSERT'
       AND NEW.confirmation_status IN ('pending'::public.membership_status, 'confirmed'::public.membership_status)
       AND v_active_count < v_min_size THEN
        RAISE EXCEPTION 'Group too small: % active member(s) is below project minimum of %.',
            v_active_count, v_min_size;
    END IF;

    RETURN NULL;
END;
$$;

-- Trigger functions do not require DML caller EXECUTE privileges in PostgreSQL; restrict to owner only
REVOKE ALL ON FUNCTION public.enforce_group_member_size_bounds() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_group_member_size_bounds ON public.group_members;
CREATE CONSTRAINT TRIGGER trg_enforce_group_member_size_bounds
AFTER INSERT OR UPDATE ON public.group_members
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_group_member_size_bounds();

-- Harden group consensus verification trigger to enforce min/max member bounds before verifying
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
    v_min_size INT;
    v_max_size INT;
BEGIN
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE confirmation_status = 'confirmed'::public.membership_status),
        COUNT(*) FILTER (WHERE confirmation_status = 'declined'::public.membership_status)
    INTO v_total_members, v_confirmed_members, v_declined_members
    FROM public.group_members
    WHERE group_id = NEW.group_id;

    SELECT
        COALESCE(pfr.min_group_size, 2),
        COALESCE(pfr.max_group_size, 10)
    INTO v_min_size, v_max_size
    FROM public.groups g
    JOIN public.projects p ON p.id = g.project_id
    LEFT JOIN public.project_file_rules pfr ON pfr.project_id = p.id
    WHERE g.id = NEW.group_id;

    IF v_total_members > 0
       AND v_confirmed_members = v_total_members
       AND v_confirmed_members >= COALESCE(v_min_size, 2)
       AND v_confirmed_members <= COALESCE(v_max_size, 10) THEN
        UPDATE public.groups
        SET status = 'verified'::public.group_status,
            updated_at = clock_timestamp()
        WHERE id = NEW.group_id
          AND status = 'pending'::public.group_status;
    ELSIF v_declined_members > 0 OR v_confirmed_members < COALESCE(v_min_size, 2) THEN
        UPDATE public.groups
        SET status = 'pending'::public.group_status,
            updated_at = clock_timestamp()
        WHERE id = NEW.group_id
          AND status = 'verified'::public.group_status;
    END IF;

    RETURN NEW;
END;
$$;

-- Trigger functions do not require DML caller EXECUTE privileges in PostgreSQL; restrict to owner only
REVOKE ALL ON FUNCTION public.check_and_update_group_verification() FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4C. Delivery Header & State-Machine Integrity (`public.deliveries`)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_delivery_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_is_privileged BOOLEAN;
    v_project_course UUID;
    v_project_teacher UUID;
    v_project_active BOOLEAN;
    v_teacher_active BOOLEAN;
    v_item_count INT;
BEGIN
    v_is_privileged := (
        COALESCE(auth.role(), '') = 'service_role'
        OR session_user IN ('postgres', 'supabase_admin')
        OR public.auth_is_system_owner()
    );

    SELECT p.course_id, p.teacher_id, p.is_active
    INTO v_project_course, v_project_teacher, v_project_active
    FROM public.projects p
    WHERE p.id = NEW.project_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid delivery project reference: project % not found.', NEW.project_id;
    END IF;

    IF NEW.course_id <> v_project_course THEN
        RAISE EXCEPTION 'Integrity Violation: Delivery course_id does not match project course_id.';
    END IF;

    IF NEW.teacher_id <> v_project_teacher THEN
        RAISE EXCEPTION 'Integrity Violation: Delivery teacher_id does not match assigned project teacher.';
    END IF;

    IF NEW.batch_count IS NULL OR NEW.batch_count <= 0 THEN
        RAISE EXCEPTION 'Integrity Violation: Delivery batch_count must be greater than zero.';
    END IF;

    IF TG_OP = 'INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.section_id IS DISTINCT FROM OLD.section_id THEN
        IF v_project_active IS DISTINCT FROM true THEN
            RAISE EXCEPTION 'Integrity Violation: Cannot create or retarget delivery for inactive project %.', NEW.project_id;
        END IF;

        IF NOT public.is_project_targeted_to_section(NEW.project_id, NEW.section_id) THEN
            RAISE EXCEPTION 'Scope Violation: Project % is not targeted to section %.', NEW.project_id, NEW.section_id;
        END IF;

        SELECT t.is_active
        INTO v_teacher_active
        FROM public.teachers t
        WHERE t.id = NEW.teacher_id;

        IF v_teacher_active IS DISTINCT FROM true THEN
            RAISE EXCEPTION 'Integrity Violation: Assigned project teacher % is inactive.', NEW.teacher_id;
        END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NOT v_is_privileged THEN
            IF NEW.status <> 'prepared'::public.delivery_status_enum THEN
                RAISE EXCEPTION 'Forbidden: Representatives may only prepare new deliveries in "prepared" status.';
            END IF;

            IF auth.uid() IS NOT NULL AND NEW.representative_id <> auth.uid() THEN
                RAISE EXCEPTION 'Forbidden: Delivery representative_id must match authenticated actor.';
            END IF;
        END IF;
    ELSE
        IF NOT v_is_privileged THEN
            IF NEW.project_id IS DISTINCT FROM OLD.project_id
               OR NEW.section_id IS DISTINCT FROM OLD.section_id
               OR NEW.course_id IS DISTINCT FROM OLD.course_id
               OR NEW.teacher_id IS DISTINCT FROM OLD.teacher_id
               OR NEW.representative_id IS DISTINCT FROM OLD.representative_id
               OR NEW.batch_count IS DISTINCT FROM OLD.batch_count THEN
                RAISE EXCEPTION 'Forbidden: Immutable delivery scope and batch_count cannot be altered.';
            END IF;
        END IF;

        IF NEW.status IS DISTINCT FROM OLD.status THEN
            IF NOT (
                (OLD.status = 'pending'::public.delivery_status_enum AND NEW.status IN ('prepared'::public.delivery_status_enum, 'failed'::public.delivery_status_enum))
                OR (OLD.status = 'prepared'::public.delivery_status_enum AND NEW.status IN ('sent'::public.delivery_status_enum, 'failed'::public.delivery_status_enum))
                OR (OLD.status = 'sent'::public.delivery_status_enum AND NEW.status IN ('acknowledged'::public.delivery_status_enum, 'failed'::public.delivery_status_enum))
            ) THEN
                RAISE EXCEPTION 'Invalid delivery state transition: Cannot change status from "%" to "%".',
                    OLD.status, NEW.status;
            END IF;
        END IF;

        IF NEW.status IN ('sent'::public.delivery_status_enum, 'acknowledged'::public.delivery_status_enum) THEN
            SELECT COUNT(*)
            INTO v_item_count
            FROM public.delivery_items di
            WHERE di.delivery_id = NEW.id;

            IF v_item_count <= 0 OR v_item_count <> NEW.batch_count THEN
                RAISE EXCEPTION 'Integrity Violation: Delivery % batch_count (%) does not match delivery_items count (%).',
                    NEW.id, NEW.batch_count, v_item_count;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- Trigger functions do not require DML caller EXECUTE privileges in PostgreSQL; restrict to owner only
REVOKE ALL ON FUNCTION public.enforce_delivery_integrity() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_delivery_integrity ON public.deliveries;
CREATE TRIGGER trg_enforce_delivery_integrity
BEFORE INSERT OR UPDATE ON public.deliveries
FOR EACH ROW EXECUTE FUNCTION public.enforce_delivery_integrity();

-- ----------------------------------------------------------------------------
-- 4D. Delivery Item Section/Project/Active-Submission Binding (`public.delivery_items`)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_delivery_item_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_delivery_section UUID;
    v_delivery_project UUID;
    v_delivery_status public.delivery_status_enum;
    v_sub_section UUID;
    v_sub_project UUID;
    v_sub_status public.submission_record_status;
BEGIN
    IF TG_OP = 'DELETE' THEN
        SELECT d.status
        INTO v_delivery_status
        FROM public.deliveries d
        WHERE d.id = OLD.delivery_id;

        IF FOUND AND v_delivery_status IN ('sent'::public.delivery_status_enum, 'acknowledged'::public.delivery_status_enum) THEN
            RAISE EXCEPTION 'Integrity Violation: Cannot delete delivery_items from a delivery already in "%" status.',
                v_delivery_status;
        END IF;

        RETURN OLD;
    END IF;

    SELECT d.section_id, d.project_id, d.status
    INTO v_delivery_section, v_delivery_project, v_delivery_status
    FROM public.deliveries d
    WHERE d.id = NEW.delivery_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid delivery reference: delivery % not found.', NEW.delivery_id;
    END IF;

    IF v_delivery_status <> 'prepared'::public.delivery_status_enum THEN
        RAISE EXCEPTION 'Integrity Violation: delivery_items may only be attached while parent delivery is in "prepared" status (found "%").',
            v_delivery_status;
    END IF;

    IF TG_OP = 'UPDATE' AND (NEW.delivery_id IS DISTINCT FROM OLD.delivery_id OR NEW.submission_id IS DISTINCT FROM OLD.submission_id) THEN
        RAISE EXCEPTION 'Integrity Violation: delivery_items bindings are immutable.';
    END IF;

    SELECT s.section_id, s.project_id, s.status
    INTO v_sub_section, v_sub_project, v_sub_status
    FROM public.submissions s
    WHERE s.id = NEW.submission_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid submission reference: submission % not found.', NEW.submission_id;
    END IF;

    IF v_sub_section <> v_delivery_section OR v_sub_project <> v_delivery_project THEN
        RAISE EXCEPTION 'Scope Violation: Submission % does not belong to delivery section % and project %.',
            NEW.submission_id, v_delivery_section, v_delivery_project;
    END IF;

    IF v_sub_status <> 'active'::public.submission_record_status THEN
        RAISE EXCEPTION 'Integrity Violation: Only active submissions may be attached to a delivery batch (found "%").',
            v_sub_status;
    END IF;

    RETURN NEW;
END;
$$;

-- Trigger functions do not require DML caller EXECUTE privileges in PostgreSQL; restrict to owner only
REVOKE ALL ON FUNCTION public.enforce_delivery_item_integrity() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_delivery_item_integrity ON public.delivery_items;
CREATE TRIGGER trg_enforce_delivery_item_integrity
BEFORE INSERT OR UPDATE OR DELETE ON public.delivery_items
FOR EACH ROW EXECUTE FUNCTION public.enforce_delivery_item_integrity();

-- ----------------------------------------------------------------------------
-- 4E. Tighten Representative RLS Policies (`groups`, `group_members`, `delivery_items`)
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "rep_access_assigned_section_groups" ON public.groups;
CREATE POLICY "rep_access_assigned_section_groups" ON public.groups
    FOR ALL TO authenticated
    USING (public.auth_is_rep_for_section(section_id))
    WITH CHECK (
        public.auth_is_rep_for_section(section_id)
        AND status NOT IN ('verified'::public.group_status, 'submitted'::public.group_status)
    );

DROP POLICY IF EXISTS "rep_access_assigned_section_group_members" ON public.group_members;
CREATE POLICY "rep_access_assigned_section_group_members" ON public.group_members
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.groups g
            WHERE g.id = group_members.group_id
              AND public.auth_is_rep_for_section(g.section_id)
        )
    )
    WITH CHECK (
        confirmation_status <> 'confirmed'::public.membership_status
        AND confirmed_at IS NULL
        AND EXISTS (
            SELECT 1
            FROM public.groups g
            INNER JOIN public.students s ON s.id = group_members.student_id
            WHERE g.id = group_members.group_id
              AND public.auth_is_rep_for_section(g.section_id)
              AND s.section_id = g.section_id
              AND s.registration_status IN ('approved'::public.student_registration_status, 'locked'::public.student_registration_status)
        )
    );

DROP POLICY IF EXISTS "rep_manage_section_delivery_items" ON public.delivery_items;
CREATE POLICY "rep_manage_section_delivery_items" ON public.delivery_items
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.deliveries d
            WHERE d.id = delivery_items.delivery_id
              AND public.auth_is_rep_for_section(d.section_id)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.deliveries d
            INNER JOIN public.submissions s ON s.id = delivery_items.submission_id
            WHERE d.id = delivery_items.delivery_id
              AND public.auth_is_rep_for_section(d.section_id)
              AND d.status = 'prepared'::public.delivery_status_enum
              AND s.section_id = d.section_id
              AND s.project_id = d.project_id
              AND s.status = 'active'::public.submission_record_status
        )
    );
