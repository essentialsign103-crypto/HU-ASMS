-- HU-ASMS: Migration 20261114000001 — Course-Section Offerings
-- Binds a university course catalog entry to a specific academic section,
-- academic year, and designated teacher.
--
-- Background: `courses` is a pure catalog table (code, title, department).
-- Representatives need to offer a course to their section — selecting the
-- course, their authorized section, and the delivering teacher.
--
-- Once an offering exists, representatives create `projects` targeting that
-- offering's section via `project_targets`, using the offering's `teacher_id`.
--
-- Constraints:
--   - One active offering per (course, section, academic_year).
--   - Section must belong to the given academic_year (enforced by trigger).
--   - Teacher must be active.
--   - Only the representative's authorized section may be used.
--     (Enforced at service layer, not DB, to remain consistent with
--     the existing representative authorization pattern.)

-- ============================================================================
-- 1. COURSE SECTION OFFERINGS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.course_section_offerings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    section_id UUID NOT NULL REFERENCES public.sections(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE RESTRICT,
    academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    -- One active offering per course + section + year
    CONSTRAINT uq_course_section_offering UNIQUE (course_id, section_id, academic_year_id)
);

CREATE INDEX IF NOT EXISTS idx_cso_section ON public.course_section_offerings (section_id)
    WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_cso_academic_year ON public.course_section_offerings (academic_year_id)
    WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_cso_course ON public.course_section_offerings (course_id)
    WHERE is_active = true;

CREATE TRIGGER trg_cso_updated_at
    BEFORE UPDATE ON public.course_section_offerings
    FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- ============================================================================
-- 2. INTEGRITY TRIGGER
-- Verifies section.academic_year_id matches the recorded academic_year_id,
-- and teacher.is_active is true.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_cso_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_section_year UUID;
    v_teacher_active BOOLEAN;
BEGIN
    -- Verify section belongs to the stated academic year
    SELECT s.academic_year_id
    INTO v_section_year
    FROM public.sections s
    WHERE s.id = NEW.section_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Section % not found.', NEW.section_id;
    END IF;

    IF v_section_year <> NEW.academic_year_id THEN
        RAISE EXCEPTION
            'Integrity violation: section % belongs to academic year %, not %.',
            NEW.section_id, v_section_year, NEW.academic_year_id;
    END IF;

    -- Verify teacher is active
    SELECT t.is_active
    INTO v_teacher_active
    FROM public.teachers t
    WHERE t.id = NEW.teacher_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Teacher % not found.', NEW.teacher_id;
    END IF;

    IF v_teacher_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Teacher % is not active and cannot be assigned to a course offering.', NEW.teacher_id;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_cso_integrity() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_cso_integrity ON public.course_section_offerings;
CREATE TRIGGER trg_enforce_cso_integrity
    BEFORE INSERT OR UPDATE ON public.course_section_offerings
    FOR EACH ROW EXECUTE FUNCTION public.enforce_cso_integrity();

-- ============================================================================
-- 3. RLS
-- ============================================================================

ALTER TABLE public.course_section_offerings ENABLE ROW LEVEL SECURITY;

-- Representatives and owners can read offerings for sections they manage or teach.
-- Service role has full access.
DROP POLICY IF EXISTS "Active staff can view course offerings" ON public.course_section_offerings;
CREATE POLICY "Active staff can view course offerings"
ON public.course_section_offerings
FOR SELECT
TO authenticated
USING (
    public.auth_is_system_owner()
    OR public.auth_is_rep_for_section(section_id)
);

DROP POLICY IF EXISTS "Representatives and owners can manage course offerings" ON public.course_section_offerings;
CREATE POLICY "Representatives and owners can manage course offerings"
ON public.course_section_offerings
FOR INSERT
TO authenticated
WITH CHECK (
    public.auth_is_system_owner()
    OR public.auth_is_rep_for_section(section_id)
);

DROP POLICY IF EXISTS "Representatives and owners can deactivate course offerings" ON public.course_section_offerings;
CREATE POLICY "Representatives and owners can deactivate course offerings"
ON public.course_section_offerings
FOR UPDATE
TO authenticated
USING (
    public.auth_is_system_owner()
    OR public.auth_is_rep_for_section(section_id)
)
WITH CHECK (
    public.auth_is_system_owner()
    OR public.auth_is_rep_for_section(section_id)
);

GRANT SELECT, INSERT, UPDATE ON public.course_section_offerings TO authenticated;
GRANT ALL ON public.course_section_offerings TO service_role;
