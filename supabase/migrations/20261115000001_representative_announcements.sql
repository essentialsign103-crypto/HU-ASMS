-- HU-ASMS: Representative Announcements & Recipient Tracking Schema
-- Migration: 20261115000001_representative_announcements.sql
-- Status: DESIGNED / REVIEW-READY (DO NOT APPLY TO REMOTE SUPABASE WITHOUT OWNER APPROVAL)

-- ============================================================================
-- 1. Table: public.announcements
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('admin', 'representative', 'teacher')),
    academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
    section_id UUID REFERENCES public.sections(id) ON DELETE CASCADE,
    course_id UUID REFERENCES public.courses(id) ON DELETE SET NULL,
    project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    attachment_url TEXT,
    attachment_file_name TEXT,
    attachment_file_size_bytes BIGINT,
    attachment_mime_type TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_announcements_section_id ON public.announcements(section_id);
CREATE INDEX IF NOT EXISTS idx_announcements_academic_year ON public.announcements(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_announcements_sender_id ON public.announcements(sender_id);
CREATE INDEX IF NOT EXISTS idx_announcements_sent_at ON public.announcements(sent_at DESC);

-- ============================================================================
-- 2. Table: public.announcement_recipients
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.announcement_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'delivered', 'failed')),
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_announcement_student UNIQUE (announcement_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_announcement_recipients_announcement ON public.announcement_recipients(announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_recipients_student ON public.announcement_recipients(student_id);

-- ============================================================================
-- 3. Row-Level Security (RLS) Policies
-- ============================================================================
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_recipients ENABLE ROW LEVEL SECURITY;

-- Announcements SELECT policy:
-- 1. Admins can view all.
-- 2. Teachers can view announcements for their courses/academic years.
-- 3. Representatives can view announcements for sections they are actively assigned to.
-- 4. Students can view announcements targeted to their enrolled section or academic year.
CREATE POLICY announcements_select_policy ON public.announcements
    FOR SELECT
    USING (
        -- Admin override
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role = 'admin'
        )
        OR
        -- Sender view
        sender_id = auth.uid()
        OR
        -- Representative scope
        EXISTS (
            SELECT 1 FROM public.representative_assignments ra
            WHERE ra.profile_id = auth.uid()
              AND ra.is_active = true
              AND (ra.section_id = announcements.section_id OR announcements.section_id IS NULL)
        )
        OR
        -- Student enrolled scope
        EXISTS (
            SELECT 1 FROM public.students s
            WHERE s.profile_id = auth.uid()
              AND s.registration_status = 'verified'
              AND (s.section_id = announcements.section_id OR announcements.section_id IS NULL)
              AND s.academic_year_id = announcements.academic_year_id
        )
    );

-- Announcements INSERT policy:
-- Representatives can only insert for their actively assigned section
CREATE POLICY announcements_rep_insert_policy ON public.announcements
    FOR INSERT
    WITH CHECK (
        -- Admin
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role = 'admin'
        )
        OR
        -- Representative strictly scoped to their assigned section
        (
            sender_id = auth.uid()
            AND sender_role = 'representative'
            AND section_id IS NOT NULL
            AND EXISTS (
                SELECT 1 FROM public.representative_assignments ra
                WHERE ra.profile_id = auth.uid()
                  AND ra.section_id = announcements.section_id
                  AND ra.is_active = true
            )
        )
    );

-- Recipient SELECT policy:
CREATE POLICY announcement_recipients_select_policy ON public.announcement_recipients
    FOR SELECT
    USING (
        -- Admin
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
        OR
        -- Student recipient
        EXISTS (SELECT 1 FROM public.students s WHERE s.id = announcement_recipients.student_id AND s.profile_id = auth.uid())
        OR
        -- Sender of parent announcement
        EXISTS (SELECT 1 FROM public.announcements a WHERE a.id = announcement_recipients.announcement_id AND a.sender_id = auth.uid())
    );

-- Recipient UPDATE policy (mark as read):
CREATE POLICY announcement_recipients_update_policy ON public.announcement_recipients
    FOR UPDATE
    USING (
        EXISTS (SELECT 1 FROM public.students s WHERE s.id = announcement_recipients.student_id AND s.profile_id = auth.uid())
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.students s WHERE s.id = announcement_recipients.student_id AND s.profile_id = auth.uid())
    );

-- ============================================================================
-- 4. Audit Logging Trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION public.log_announcement_creation()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.audit_logs (
        actor_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        NEW.sender_id,
        NEW.sender_role,
        'ANNOUNCEMENT_CREATED',
        'announcement',
        NEW.id,
        jsonb_build_object(
            'title', NEW.title,
            'section_id', NEW.section_id,
            'academic_year_id', NEW.academic_year_id,
            'priority', NEW.priority
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_log_announcement_creation
    AFTER INSERT ON public.announcements
    FOR EACH ROW
    EXECUTE FUNCTION public.log_announcement_creation();
