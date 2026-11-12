-- HU-ASMS: Critical Blockers Remediation Migration (Phases A & C)
-- Forward migration (LOCAL STAGED ONLY — do NOT apply remotely until authorized).
--
-- Phase A (Secure Student Identity Linking & Account Recovery):
--   1. Extends `public.registration_requests` with `request_type` ('new_registration',
--      'roster_claim', 'account_recovery'), `target_student_id`, and `recovery_reason`.
--   2. Adds `public.student_verification_tokens` (SHA-256 hashed, single-use, expiring
--      tokens issued by System Owner for out-of-band verification) plus atomic RPC
--      `public.redeem_student_verification_token(...)`.
--   3. Forward-updates `public.approve_student_registration(UUID, TEXT)` to process
--      new registrations, roster claims, and Telegram account recovery requests safely
--      while preventing duplicate Telegram bindings and unverified claims.
--
-- Phase C (Persistent Bot State & Distributed Rate Limiting):
--   4. Adds `public.bot_sessions` for persistent grammY session + @grammyjs/conversations
--      state across serverless Vercel instances and cold starts.
--   5. Adds `public.rate_limit_buckets` and atomic RPC
--      `public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT)` for distributed
--      sliding-window rate limiting shared across Vercel serverless invocations.

-- ============================================================================
-- 1. PHASE C: PERSISTENT BOT SESSIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bot_sessions (
    session_key TEXT PRIMARY KEY,
    session_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp() + INTERVAL '24 hours'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_bot_sessions_expires_at
    ON public.bot_sessions (expires_at);

ALTER TABLE public.bot_sessions ENABLE ROW LEVEL SECURITY;

-- Zero anon/authenticated policies: only backend service_role reads/writes bot sessions.
REVOKE ALL ON TABLE public.bot_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.bot_sessions TO service_role;

-- ============================================================================
-- 2. PHASE C: DISTRIBUTED RATE LIMIT BUCKETS & ATOMIC RPC
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
    bucket_key TEXT PRIMARY KEY,
    request_timestamps BIGINT[] NOT NULL DEFAULT '{}'::BIGINT[],
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_expires_at
    ON public.rate_limit_buckets (expires_at);

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.rate_limit_buckets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rate_limit_buckets TO service_role;

CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
    p_key TEXT,
    p_max_requests INTEGER,
    p_window_ms BIGINT
)
RETURNS TABLE (
    allowed BOOLEAN,
    remaining INTEGER,
    retry_after_ms BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now_ms BIGINT;
    v_cutoff_ms BIGINT;
    v_existing BIGINT[];
    v_recent BIGINT[];
    v_count INTEGER;
    v_oldest_ms BIGINT;
    v_retry_after BIGINT := 0;
    v_ttl INTERVAL;
BEGIN
    -- Strictly service_role only (invoked by server-side webhook & Next.js server actions)
    IF COALESCE(auth.role(), '') <> 'service_role'
       AND session_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'Forbidden: Distributed rate limiting requires service_role context.';
    END IF;

    IF p_key IS NULL OR BTRIM(p_key) = '' OR length(p_key) > 255 THEN
        RAISE EXCEPTION 'Invalid rate limit key.';
    END IF;

    IF p_max_requests IS NULL OR p_max_requests < 1 THEN
        RAISE EXCEPTION 'Invalid max_requests threshold.';
    END IF;

    IF p_window_ms IS NULL OR p_window_ms < 1000 THEN
        RAISE EXCEPTION 'Invalid window_ms duration.';
    END IF;

    v_now_ms := FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
    v_cutoff_ms := v_now_ms - p_window_ms;
    v_ttl := pg_catalog.make_interval(secs => (p_window_ms::DOUBLE PRECISION / 1000.0));

    INSERT INTO public.rate_limit_buckets (bucket_key, request_timestamps, expires_at, updated_at)
    VALUES (p_key, '{}'::BIGINT[], clock_timestamp() + v_ttl, clock_timestamp())
    ON CONFLICT (bucket_key) DO NOTHING;

    SELECT b.request_timestamps
    INTO v_existing
    FROM public.rate_limit_buckets b
    WHERE b.bucket_key = p_key
    FOR UPDATE;

    SELECT COALESCE(array_agg(ts ORDER BY ts), '{}'::BIGINT[])
    INTO v_recent
    FROM unnest(COALESCE(v_existing, '{}'::BIGINT[])) AS ts
    WHERE ts > v_cutoff_ms;

    v_count := COALESCE(array_length(v_recent, 1), 0);

    IF v_count >= p_max_requests THEN
        v_oldest_ms := v_recent[1];
        v_retry_after := GREATEST(1000, (v_oldest_ms + p_window_ms) - v_now_ms);

        UPDATE public.rate_limit_buckets
        SET request_timestamps = v_recent,
            expires_at = clock_timestamp() + v_ttl,
            updated_at = clock_timestamp()
        WHERE bucket_key = p_key;

        RETURN QUERY SELECT FALSE, 0, v_retry_after;
        RETURN;
    END IF;

    v_recent := array_append(v_recent, v_now_ms);

    UPDATE public.rate_limit_buckets
    SET request_timestamps = v_recent,
        expires_at = clock_timestamp() + v_ttl,
        updated_at = clock_timestamp()
    WHERE bucket_key = p_key;

    RETURN QUERY SELECT TRUE, GREATEST(0, p_max_requests - COALESCE(array_length(v_recent, 1), 0)), 0::BIGINT;
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) TO service_role;

-- ============================================================================
-- 3. PHASE A: VERIFIED IDENTITY CLAIM & RECOVERY REQUESTS + TOKENS
-- ============================================================================

ALTER TABLE public.registration_requests
    ADD COLUMN IF NOT EXISTS request_type VARCHAR(30) NOT NULL DEFAULT 'new_registration'
        CHECK (request_type IN ('new_registration', 'roster_claim', 'account_recovery')),
    ADD COLUMN IF NOT EXISTS target_student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS recovery_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_reg_requests_target_student
    ON public.registration_requests (target_student_id)
    WHERE target_student_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.student_verification_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    purpose VARCHAR(30) NOT NULL CHECK (purpose IN ('roster_claim', 'account_recovery')),
    issued_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    used_by_telegram_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_student_verif_tokens_student
    ON public.student_verification_tokens (student_id);

ALTER TABLE public.student_verification_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.student_verification_tokens FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.student_verification_tokens TO authenticated, service_role;

DROP POLICY IF EXISTS "System Owners manage student verification tokens" ON public.student_verification_tokens;
CREATE POLICY "System Owners manage student verification tokens"
ON public.student_verification_tokens
FOR ALL
USING (public.auth_is_system_owner())
WITH CHECK (public.auth_is_system_owner());

CREATE OR REPLACE FUNCTION public.audit_student_verification_token_issue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.audit_logs (
        actor_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        NEW.issued_by,
        CASE WHEN NEW.issued_by IS NOT NULL THEN 'system_owner' ELSE 'service_role' END,
        'STUDENT_VERIFICATION_TOKEN_ISSUED',
        'student',
        NEW.student_id,
        jsonb_build_object(
            'token_id', NEW.id,
            'purpose', NEW.purpose,
            'expires_at', NEW.expires_at
        )
    );
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_student_verification_token_issue() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit_student_verification_token_issue ON public.student_verification_tokens;
CREATE TRIGGER trg_audit_student_verification_token_issue
AFTER INSERT ON public.student_verification_tokens
FOR EACH ROW EXECUTE FUNCTION public.audit_student_verification_token_issue();

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
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role'
       AND session_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'Forbidden: Token redemption requires backend service_role execution context.';
    END IF;

    v_clean_hu_id := UPPER(BTRIM(COALESCE(p_hu_student_id, '')));
    v_clean_hash := LOWER(BTRIM(COALESCE(p_token_hash, '')));

    IF v_clean_hu_id = '' OR length(v_clean_hash) <> 64 OR p_telegram_user_id IS NULL OR p_telegram_user_id <= 0 THEN
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

    -- Lock target student row (do not disclose existence/status on invalid credentials)
    SELECT *
    INTO v_student
    FROM public.students s
    WHERE s.hu_student_id = v_clean_hu_id
    FOR UPDATE;

    IF NOT FOUND OR v_student.registration_status = 'suspended'::public.student_registration_status THEN
        RAISE EXCEPTION 'Invalid or expired verification token.' USING ERRCODE = 'P0002';
    END IF;

    SELECT *
    INTO v_token
    FROM public.student_verification_tokens t
    WHERE t.student_id = v_student.id
      AND t.token_hash = v_clean_hash
      AND t.used_at IS NULL
      AND t.expires_at > v_now
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid or expired verification token.' USING ERRCODE = 'P0002';
    END IF;

    IF v_token.purpose = 'roster_claim' AND v_student.telegram_user_id IS NOT NULL THEN
        RAISE EXCEPTION 'Student identity is already linked to a Telegram account; an account recovery token or admin approval is required.'
            USING ERRCODE = '23505';
    END IF;

    v_prev_tg_id := v_student.telegram_user_id;

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

    -- Close any matching pending request submitted by this Telegram user for this HU ID
    UPDATE public.registration_requests
    SET status = 'approved'::public.request_status,
        admin_notes = 'Fulfilled via single-use verification token',
        reviewed_at = v_now,
        updated_at = v_now
    WHERE telegram_user_id = p_telegram_user_id
      AND hu_student_id = v_clean_hu_id
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
-- 4. PHASE A: ATOMIC REGISTRATION / ROSTER CLAIM / ACCOUNT RECOVERY APPROVAL
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
        -- Prevent Telegram account from being linked to a second student
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
