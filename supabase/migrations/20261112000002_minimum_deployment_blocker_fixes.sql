-- HU-ASMS: Minimum Deployment Blocker Fixes (Forward Migration Only)
-- Strictly additive/forward remediation for:
--   1. Enforce 20 MB (20,971,520-byte) Telegram Cloud Bot API limit on project_file_rules.
--   2. Prevent unauthorized pending recovery/claim requests from blocking legitimate recovery
--      by scoping pending HU Student ID uniqueness strictly to `new_registration` and closing
--      competing pending claim/recovery rows when ownership is approved or verified by token.
--   3. Per-student failed verification attempt protection + auditing in `redeem_student_verification_token`.
--   4. Harden `student_verification_tokens` (revoke UPDATE from authenticated) and
--      `audit_student_verification_token_issue()` (revoke EXECUTE from PUBLIC, anon, authenticated, service_role).

-- ============================================================================
-- 1. ENFORCE 20 MB TELEGRAM CLOUD BOT API LIMIT IN project_file_rules
-- ============================================================================

UPDATE public.project_file_rules
SET max_file_size_bytes = 20971520
WHERE max_file_size_bytes > 20971520
   OR max_file_size_bytes <= 0;

ALTER TABLE public.project_file_rules
    DROP CONSTRAINT IF EXISTS chk_project_file_rules_max_size,
    ADD CONSTRAINT chk_project_file_rules_max_size
    CHECK (max_file_size_bytes > 0 AND max_file_size_bytes <= 20971520);

-- ============================================================================
-- 2. SCOPE PENDING HU ID UNIQUENESS SO UNAUTHORIZED RECOVERY CANNOT BLOCK OWNER
-- ============================================================================

DROP INDEX IF EXISTS public.uq_pending_registration_request_hu_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_new_registration_hu_id
    ON public.registration_requests (hu_student_id)
    WHERE status = 'pending'::public.request_status
      AND COALESCE(request_type, 'new_registration') = 'new_registration';

-- ============================================================================
-- 3. PERMISSION PARITY ON TOKEN TABLE & TRIGGER FUNCTION
-- ============================================================================

REVOKE UPDATE ON TABLE public.student_verification_tokens FROM authenticated;
REVOKE ALL ON FUNCTION public.audit_student_verification_token_issue() FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================================
-- 4. PER-STUDENT FAILED-ATTEMPT LOCKOUT & AUDITING ON TOKEN REDEMPTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.redeem_student_verification_token(
    p_hu_student_id TEXT,
    p_token_hash TEXT,
    p_telegram_user_id BIGINT,
    p_telegram_username TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_clean_hu_id TEXT;
    v_clean_hash TEXT;
    v_dup_student_id UUID;
    v_student public.students%ROWTYPE;
    v_token public.student_verification_tokens%ROWTYPE;
    v_prev_tg_id BIGINT;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_now_ms BIGINT;
    v_window_ms BIGINT := 900000; -- 15 minutes
    v_cutoff_ms BIGINT;
    v_max_failures INTEGER := 5;
    v_bucket_key TEXT;
    v_existing BIGINT[];
    v_recent BIGINT[];
    v_fail_count INTEGER := 0;
    v_retry_after_sec INTEGER := 900;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role'
       AND session_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'Forbidden: Token redemption requires backend service_role execution context.';
    END IF;

    v_clean_hu_id := UPPER(BTRIM(COALESCE(p_hu_student_id, '')));
    v_clean_hash := LOWER(BTRIM(COALESCE(p_token_hash, '')));

    IF v_clean_hu_id = '' OR p_telegram_user_id IS NULL OR p_telegram_user_id <= 0 THEN
        RAISE EXCEPTION 'Invalid verification credentials.' USING ERRCODE = '22023';
    END IF;

    -- Prevent duplicate Telegram bindings across student accounts
    SELECT s.id
    INTO v_dup_student_id
    FROM public.students s
    WHERE s.telegram_user_id = p_telegram_user_id
    FOR UPDATE;

    IF FOUND THEN
        RAISE EXCEPTION 'This Telegram account is already linked to another student record.'
            USING ERRCODE = '23505';
    END IF;

    -- Lock target student row when present
    SELECT *
    INTO v_student
    FROM public.students s
    WHERE s.hu_student_id = v_clean_hu_id
    FOR UPDATE;

    v_now_ms := FLOOR(EXTRACT(EPOCH FROM v_now) * 1000)::BIGINT;
    v_cutoff_ms := v_now_ms - v_window_ms;
    v_bucket_key := CASE
        WHEN v_student.id IS NOT NULL THEN 'token-fail:student:' || v_student.id::TEXT
        ELSE 'token-fail:huid:' || LEFT(v_clean_hu_id, 180)
    END;

    INSERT INTO public.rate_limit_buckets (bucket_key, request_timestamps, expires_at, updated_at)
    VALUES (v_bucket_key, '{}'::BIGINT[], v_now + INTERVAL '15 minutes', v_now)
    ON CONFLICT (bucket_key) DO NOTHING;

    SELECT b.request_timestamps
    INTO v_existing
    FROM public.rate_limit_buckets b
    WHERE b.bucket_key = v_bucket_key
    FOR UPDATE;

    SELECT COALESCE(array_agg(ts ORDER BY ts), '{}'::BIGINT[])
    INTO v_recent
    FROM unnest(COALESCE(v_existing, '{}'::BIGINT[])) AS ts
    WHERE ts > v_cutoff_ms;

    v_fail_count := COALESCE(array_length(v_recent, 1), 0);

    IF v_fail_count >= v_max_failures THEN
        v_retry_after_sec := GREATEST(1, CEIL(((v_recent[1] + v_window_ms) - v_now_ms)::DOUBLE PRECISION / 1000.0)::INTEGER);

        INSERT INTO public.audit_logs (
            actor_telegram_id,
            actor_role,
            action,
            entity_type,
            entity_id,
            metadata
        ) VALUES (
            p_telegram_user_id,
            'service_role',
            'STUDENT_VERIFICATION_LOCKED',
            'student',
            v_student.id,
            jsonb_build_object(
                'hu_student_id', v_clean_hu_id,
                'failed_attempts', v_fail_count,
                'retry_after_seconds', v_retry_after_sec
            )
        );

        RETURN jsonb_build_object(
            'ok', false,
            'code', 'LOCKED',
            'retry_after_seconds', v_retry_after_sec,
            'message', 'Too many failed verification attempts. Please try again later or contact the System Owner.'
        );
    END IF;

    IF v_student.id IS NOT NULL
       AND v_student.registration_status <> 'suspended'::public.student_registration_status
       AND length(v_clean_hash) = 64 THEN
        SELECT *
        INTO v_token
        FROM public.student_verification_tokens t
        WHERE t.student_id = v_student.id
          AND t.token_hash = v_clean_hash
          AND t.used_at IS NULL
          AND t.expires_at > v_now
        FOR UPDATE;
    END IF;

    IF v_token.id IS NULL THEN
        v_recent := array_append(v_recent, v_now_ms);

        UPDATE public.rate_limit_buckets
        SET request_timestamps = v_recent,
            expires_at = v_now + INTERVAL '15 minutes',
            updated_at = v_now
        WHERE bucket_key = v_bucket_key;

        INSERT INTO public.audit_logs (
            actor_telegram_id,
            actor_role,
            action,
            entity_type,
            entity_id,
            metadata
        ) VALUES (
            p_telegram_user_id,
            'service_role',
            'STUDENT_VERIFICATION_FAILED',
            'student',
            v_student.id,
            jsonb_build_object(
                'hu_student_id', v_clean_hu_id,
                'reason', CASE
                    WHEN v_student.id IS NULL THEN 'student_not_found'
                    WHEN v_student.registration_status = 'suspended'::public.student_registration_status THEN 'account_suspended'
                    ELSE 'invalid_or_expired_token'
                END,
                'attempt_count', COALESCE(array_length(v_recent, 1), 1)
            )
        );

        RETURN jsonb_build_object(
            'ok', false,
            'code', 'INVALID_TOKEN',
            'message', 'Invalid or expired verification token.'
        );
    END IF;

    IF v_token.purpose = 'roster_claim' AND v_student.telegram_user_id IS NOT NULL THEN
        RAISE EXCEPTION 'Student identity is already linked to a Telegram account; an account recovery token or admin approval is required.'
            USING ERRCODE = '23505';
    END IF;

    v_prev_tg_id := v_student.telegram_user_id;

    -- Reset failed attempt bucket upon valid verification
    DELETE FROM public.rate_limit_buckets
    WHERE bucket_key = v_bucket_key;

    UPDATE public.student_verification_tokens
    SET used_at = v_now,
        used_by_telegram_id = p_telegram_user_id
    WHERE id = v_token.id;

    UPDATE public.students
    SET telegram_user_id = p_telegram_user_id,
        telegram_username = NULLIF(BTRIM(COALESCE(p_telegram_username, '')), ''),
        registration_status = 'locked'::public.student_registration_status,
        is_locked = true,
        updated_at = v_now
    WHERE id = v_student.id;

    -- Approve matching pending request submitted by the verified owner
    UPDATE public.registration_requests
    SET status = 'approved'::public.request_status,
        admin_notes = 'Fulfilled via single-use verification token',
        reviewed_at = v_now,
        updated_at = v_now
    WHERE telegram_user_id = p_telegram_user_id
      AND hu_student_id = v_clean_hu_id
      AND status = 'pending'::public.request_status;

    -- Close competing unauthorized/unfulfilled pending requests for the same student record
    UPDATE public.registration_requests
    SET status = 'rejected'::public.request_status,
        admin_notes = 'Superseded by verified single-use verification token redemption',
        reviewed_at = v_now,
        updated_at = v_now
    WHERE (hu_student_id = v_clean_hu_id OR target_student_id = v_student.id)
      AND telegram_user_id <> p_telegram_user_id
      AND status = 'pending'::public.request_status;

    IF v_prev_tg_id IS DISTINCT FROM p_telegram_user_id THEN
        INSERT INTO public.identity_change_history (
            student_id,
            changed_by,
            old_values,
            new_values,
            reason
        ) VALUES (
            v_student.id,
            v_token.issued_by,
            jsonb_build_object('telegram_user_id', v_prev_tg_id, 'registration_status', v_student.registration_status),
            jsonb_build_object('telegram_user_id', p_telegram_user_id, 'registration_status', 'locked'),
            CASE
                WHEN v_token.purpose = 'account_recovery' THEN 'Verified single-use account recovery token redeemed'
                ELSE 'Verified single-use roster claim token redeemed'
            END
        );
    END IF;

    INSERT INTO public.audit_logs (
        actor_id,
        actor_telegram_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_token.issued_by,
        p_telegram_user_id,
        'service_role',
        CASE
            WHEN v_token.purpose = 'account_recovery' THEN 'STUDENT_TOKEN_RECOVERY_VERIFIED'
            ELSE 'STUDENT_TOKEN_CLAIM_VERIFIED'
        END,
        'student',
        v_student.id,
        jsonb_build_object(
            'hu_student_id', v_student.hu_student_id,
            'purpose', v_token.purpose,
            'previous_telegram_user_id', v_prev_tg_id,
            'new_telegram_user_id', p_telegram_user_id
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'student_id', v_student.id,
        'hu_student_id', v_student.hu_student_id,
        'full_name', v_student.full_name,
        'purpose', v_token.purpose
    );
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_student_verification_token(TEXT, TEXT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_student_verification_token(TEXT, TEXT, BIGINT, TEXT) TO service_role;

-- ============================================================================
-- 5. CLOSE COMPETING PENDING REQUESTS UPON ADMIN APPROVAL
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
    v_req_type VARCHAR(30);
    v_existing_student_id UUID;
    v_target_student public.students%ROWTYPE;
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

    v_req_type := COALESCE(v_req.request_type, 'new_registration');

    IF v_req_type = 'new_registration' THEN
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

    ELSIF v_req_type IN ('roster_claim', 'account_recovery') THEN
        SELECT s.id
        INTO v_existing_student_id
        FROM public.students s
        WHERE s.telegram_user_id = v_req.telegram_user_id
          AND (v_req.target_student_id IS NULL OR s.id <> v_req.target_student_id)
        LIMIT 1
        FOR UPDATE;

        IF FOUND THEN
            RAISE EXCEPTION 'Duplicate student conflict: Telegram account is already linked to another student.'
                USING ERRCODE = '23505';
        END IF;

        IF v_req.target_student_id IS NOT NULL THEN
            SELECT *
            INTO v_target_student
            FROM public.students s
            WHERE s.id = v_req.target_student_id
            FOR UPDATE;
        ELSE
            SELECT *
            INTO v_target_student
            FROM public.students s
            WHERE s.hu_student_id = v_req.hu_student_id
            FOR UPDATE;
        END IF;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Target student record not found for identity linking.'
                USING ERRCODE = 'P0002';
        END IF;

        IF v_target_student.registration_status = 'suspended'::public.student_registration_status THEN
            RAISE EXCEPTION 'Target student account is suspended and cannot be claimed or recovered.'
                USING ERRCODE = 'P0001';
        END IF;

        IF v_req_type = 'roster_claim' AND v_target_student.telegram_user_id IS NOT NULL THEN
            RAISE EXCEPTION 'Duplicate student conflict: Target student record is already linked to a Telegram account.'
                USING ERRCODE = '23505';
        END IF;

        UPDATE public.students
        SET telegram_user_id = v_req.telegram_user_id,
            telegram_username = v_req.telegram_username,
            registration_status = 'locked'::public.student_registration_status,
            is_locked = true,
            updated_at = v_reviewed_at
        WHERE id = v_target_student.id;

        v_student_id := v_target_student.id;

        INSERT INTO public.identity_change_history (
            student_id,
            changed_by,
            old_values,
            new_values,
            reason
        ) VALUES (
            v_target_student.id,
            v_actor_id,
            jsonb_build_object(
                'telegram_user_id', v_target_student.telegram_user_id,
                'telegram_username', v_target_student.telegram_username,
                'registration_status', v_target_student.registration_status
            ),
            jsonb_build_object(
                'telegram_user_id', v_req.telegram_user_id,
                'telegram_username', v_req.telegram_username,
                'registration_status', 'locked'
            ),
            COALESCE(
                v_req.recovery_reason,
                CASE
                    WHEN v_req_type = 'account_recovery' THEN 'System Owner approved Telegram account recovery'
                    ELSE 'System Owner approved roster claim'
                END
            )
        );
    ELSE
        RAISE EXCEPTION 'Unsupported registration request type (%).', v_req_type;
    END IF;

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

    -- Close any competing pending claim/recovery requests targeting this student/HU ID
    UPDATE public.registration_requests
    SET status = 'rejected'::public.request_status,
        admin_notes = 'Superseded by verified identity approval',
        reviewed_by = v_actor_id,
        reviewed_at = v_reviewed_at,
        updated_at = v_reviewed_at
    WHERE id <> p_request_id
      AND status = 'pending'::public.request_status
      AND (hu_student_id = v_req.hu_student_id OR target_student_id = v_student_id);

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
        CASE
            WHEN v_req_type = 'roster_claim' THEN 'STUDENT_ROSTER_CLAIM_APPROVED'
            WHEN v_req_type = 'account_recovery' THEN 'STUDENT_ACCOUNT_RECOVERY_APPROVED'
            ELSE 'STUDENT_REGISTRATION_APPROVED'
        END,
        'registration_request',
        p_request_id,
        jsonb_build_object(
            'request_type', v_req_type,
            'student_id', v_student_id,
            'hu_student_id', v_req.hu_student_id,
            'section_id', v_req.section_id,
            'telegram_user_id', v_req.telegram_user_id,
            'notes', v_clean_notes
        )
    );

    RETURN jsonb_build_object(
        'request_id', p_request_id,
        'request_type', v_req_type,
        'student_id', v_student_id,
        'status', 'approved'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_student_registration(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_student_registration(UUID, TEXT) TO authenticated, service_role;
