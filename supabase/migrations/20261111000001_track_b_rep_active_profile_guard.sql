-- HU-ASMS Phase 14 Track B: Active Profile Enforcement for Representative Section Scope
-- Local staged forward migration (excludes all Track C1 concurrency/bot/rate-limit objects).
-- Ensures deactivated or non-staff profiles cannot retain RLS access via representative_assignments.

CREATE OR REPLACE FUNCTION public.auth_is_rep_for_section(p_section_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.representative_assignments ra
        INNER JOIN public.profiles p ON p.id = ra.profile_id
        WHERE ra.profile_id = auth.uid()
          AND ra.section_id = p_section_id
          AND ra.is_active = true
          AND p.is_active = true
          AND p.role IN ('representative'::public.user_role, 'system_owner'::public.user_role)
    );
END;
$$;

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
    INNER JOIN public.profiles p ON p.id = ra.profile_id
    WHERE ra.profile_id = auth.uid()
      AND ra.is_active = true
      AND p.is_active = true
      AND p.role IN ('representative'::public.user_role, 'system_owner'::public.user_role);
END;
$$;

REVOKE ALL ON FUNCTION public.auth_is_rep_for_section(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_is_rep_for_section(UUID) TO authenticated, service_role;

-- Unused in RLS policies, triggers, and application RPC calls; revoke general execution under least privilege
REVOKE ALL ON FUNCTION public.auth_get_assigned_section_ids() FROM PUBLIC, anon, authenticated, service_role;
