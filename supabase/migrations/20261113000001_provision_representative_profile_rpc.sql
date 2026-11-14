-- HU-ASMS Phase 15: Representative Profile Provisioning RPC
-- Migration to add privileged RPC for provisioning representative profiles
--
-- This RPC allows the authenticated web app (using anon key) to provision
-- representative profiles securely without requiring direct INSERT grants
-- on the profiles table.
--
-- Security model:
-- - Only System Owners can invoke this function
-- - Uses SECURITY DEFINER to elevate privileges for INSERT
-- - Validates input parameters strictly
-- - Logs all profile provisioning actions to audit_logs

-- ============================================================================
-- PRIVILEGED RPC FOR REPRESENTATIVE PROFILE PROVISIONING
-- ============================================================================

CREATE OR REPLACE FUNCTION public.provision_representative_profile(
    p_profile_id UUID,
    p_full_name TEXT,
    p_email TEXT,
    p_telegram_user_id BIGINT,
    p_telegram_username TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_id UUID;
    v_existing_profile_id UUID;
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    -- Validate required parameters
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION 'Invalid profile identifier: profile_id is required.';
    END IF;
    
    IF NULLIF(BTRIM(COALESCE(p_full_name, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Invalid full_name: cannot be empty.';
    END IF;
    
    IF NULLIF(BTRIM(COALESCE(p_email, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Invalid email: cannot be empty.';
    END IF;

    -- Verify caller is authenticated and is a System Owner
    v_actor_id := auth.uid();
    IF v_actor_id IS NOT NULL THEN
        IF NOT public.auth_is_system_owner() THEN
            RAISE EXCEPTION 'Forbidden: Active System Owner role required to provision representative profiles.';
        END IF;
    ELSE
        -- Allow service_role for system operations
        IF COALESCE(auth.role(), '') <> 'service_role'
           AND session_user NOT IN ('postgres', 'supabase_admin') THEN
            RAISE EXCEPTION 'Unauthorized: Active System Owner session or trusted service role required.';
        END IF;
    END IF;

    -- Check if profile already exists
    SELECT id
    INTO v_existing_profile_id
    FROM public.profiles
    WHERE id = p_profile_id
    FOR UPDATE;

    IF FOUND THEN
        -- Profile exists: update it
        UPDATE public.profiles
        SET role = 'representative',
            full_name = p_full_name,
            email = COALESCE(p_email, email),
            telegram_user_id = COALESCE(p_telegram_user_id, telegram_user_id),
            telegram_username = p_telegram_username,
            is_active = true,
            updated_at = v_now
        WHERE id = p_profile_id;

        -- Log audit entry for update
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
            'REPRESENTATIVE_PROFILE_UPDATED',
            'profile',
            p_profile_id,
            jsonb_build_object(
                'full_name', p_full_name,
                'email', p_email,
                'telegram_user_id', p_telegram_user_id,
                'telegram_username', p_telegram_username
            )
        );

        RETURN jsonb_build_object(
            'success', true,
            'profile_id', p_profile_id,
            'action', 'updated'
        );
    ELSE
        -- Profile doesn't exist: insert new one
        INSERT INTO public.profiles (
            id,
            role,
            full_name,
            email,
            telegram_user_id,
            telegram_username,
            is_active,
            created_at,
            updated_at
        ) VALUES (
            p_profile_id,
            'representative',
            p_full_name,
            p_email,
            p_telegram_user_id,
            p_telegram_username,
            true,
            v_now,
            v_now
        );

        -- Log audit entry for insert
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
            'REPRESENTATIVE_PROFILE_PROVISIONED',
            'profile',
            p_profile_id,
            jsonb_build_object(
                'full_name', p_full_name,
                'email', p_email,
                'telegram_user_id', p_telegram_user_id,
                'telegram_username', p_telegram_username
            )
        );

        RETURN jsonb_build_object(
            'success', true,
            'profile_id', p_profile_id,
            'action', 'created'
        );
    END IF;
END;
$$;

-- Grant EXECUTE to authenticated role (System Owners will be validated within the function)
GRANT EXECUTE ON FUNCTION public.provision_representative_profile(UUID, TEXT, TEXT, BIGINT, TEXT) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION public.provision_representative_profile IS
'Privileged RPC for provisioning representative profiles. Only accessible by System Owners. Uses SECURITY DEFINER to bypass RLS and direct INSERT restrictions. All actions are audited.';
