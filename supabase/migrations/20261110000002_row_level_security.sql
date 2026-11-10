-- HU-ASMS: Haramaya University Academic Submission Management System
-- Migration 02: Row Level Security (RLS) Policies & Access Control Helpers

-- ============================================================================
-- 1. HELPER FUNCTIONS FOR SECURITY CHECKS
-- ============================================================================

-- Check if current authenticated user is a System Owner
CREATE OR REPLACE FUNCTION auth_is_system_owner()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid()
          AND role = 'system_owner'
          AND is_active = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if current authenticated user is an active representative for a given section
CREATE OR REPLACE FUNCTION auth_is_rep_for_section(p_section_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM representative_assignments
        WHERE profile_id = auth.uid()
          AND section_id = p_section_id
          AND is_active = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Retrieve list of section IDs assigned to the current representative
CREATE OR REPLACE FUNCTION auth_get_assigned_section_ids()
RETURNS TABLE(section_id UUID) AS $$
BEGIN
    RETURN QUERY
    SELECT ra.section_id
    FROM representative_assignments ra
    WHERE ra.profile_id = auth.uid()
      AND ra.is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 2. ENABLE ROW LEVEL SECURITY ON ALL TABLES
-- ============================================================================

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE representative_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_change_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_file_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3. PROFILES POLICIES
-- ============================================================================

-- System Owner has full access to all profiles
CREATE POLICY "owner_full_access_profiles" ON profiles
    FOR ALL
    TO authenticated
    USING (auth_is_system_owner())
    WITH CHECK (auth_is_system_owner());

-- Users can read their own profile
CREATE POLICY "users_read_own_profile" ON profiles
    FOR SELECT
    TO authenticated
    USING (id = auth.uid());

-- Users can update basic profile fields (e.g. phone, username)
CREATE POLICY "users_update_own_profile" ON profiles
    FOR UPDATE
    TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- ============================================================================
-- 4. UNIVERSITY STRUCTURE POLICIES (DEPARTMENTS, YEARS, SECTIONS)
-- ============================================================================

-- Read access for all authenticated users (Owner & Representatives)
CREATE POLICY "auth_read_departments" ON departments
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "owner_manage_departments" ON departments
    FOR ALL TO authenticated
    USING (auth_is_system_owner())
    WITH CHECK (auth_is_system_owner());

CREATE POLICY "auth_read_academic_years" ON academic_years
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "owner_manage_academic_years" ON academic_years
    FOR ALL TO authenticated
    USING (auth_is_system_owner())
    WITH CHECK (auth_is_system_owner());

CREATE POLICY "auth_read_sections" ON sections
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "owner_manage_sections" ON sections
    FOR ALL TO authenticated
    USING (auth_is_system_owner())
    WITH CHECK (auth_is_system_owner());

-- Representative Assignments:
CREATE POLICY "owner_manage_rep_assignments" ON representative_assignments
    FOR ALL TO authenticated
    USING (auth_is_system_owner())
    WITH CHECK (auth_is_system_owner());

CREATE POLICY "reps_read_own_assignments" ON representative_assignments
    FOR SELECT TO authenticated
    USING (profile_id = auth.uid());

-- ============================================================================
-- 5. STUDENT ROSTER & IDENTITY POLICIES
-- ============================================================================

CREATE POLICY "owner_full_access_students" ON students
    FOR ALL TO authenticated
    USING (auth_is_system_owner())
    WITH CHECK (auth_is_system_owner());

-- Representatives can only read students in their assigned sections
CREATE POLICY "rep_read_assigned_section_students" ON students
    FOR SELECT TO authenticated
    USING (auth_is_rep_for_section(section_id));

-- Registration Requests
CREATE POLICY "owner_full_access_registration_requests" ON registration_requests
    FOR ALL TO authenticated
    USING (auth_is_system_owner())
    WITH CHECK (auth_is_system_owner());

CREATE POLICY "rep_read_section_reg_requests" ON registration_requests
    FOR SELECT TO authenticated
    USING (auth_is_rep_for_section(section_id));

-- Identity Changes
CREATE POLICY "owner_full_access_identity_changes" ON identity_change_requests
    FOR ALL TO authenticated
    USING (auth_is_system_owner())
    WITH CHECK (auth_is_system_owner());

CREATE POLICY "owner_read_identity_history" ON identity_change_history
    FOR SELECT TO authenticated
    USING (auth_is_system_owner());

-- ============================================================================
-- 6. ACADEMIC ENTITIES POLICIES (COURSES, TEACHERS, PROJECTS)
-- ============================================================================

CREATE POLICY "auth_read_courses" ON courses
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "owner_manage_courses" ON courses
    FOR ALL TO authenticated
    USING (auth_is_system_owner())
    WITH CHECK (auth_is_system_owner());

CREATE POLICY "auth_read_teachers" ON teachers
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "owner_manage_teachers" ON teachers
    FOR ALL TO authenticated
    USING (auth_is_system_owner())
    WITH CHECK (auth_is_system_owner());

CREATE POLICY "auth_read_projects" ON projects
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "owner_manage_projects" ON projects
    FOR ALL TO authenticated
    USING (auth_is_system_owner())
    WITH CHECK (auth_is_system_owner());

CREATE POLICY "auth_read_project_targets" ON project_targets
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "owner_manage_project_targets" ON project_targets
    FOR ALL TO authenticated
    USING (auth_is_system_owner())
    WITH CHECK (auth_is_system_owner());

CREATE POLICY "auth_read_project_file_rules" ON project_file_rules
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "owner_manage_project_file_rules" ON project_file_rules
    FOR ALL TO authenticated
    USING (auth_is_system_owner())
    WITH CHECK (auth_is_system_owner());

-- ============================================================================
-- 7. GROUP POLICIES
-- ============================================================================

CREATE POLICY "owner_full_access_groups" ON groups
    FOR ALL TO authenticated
    USING (auth_is_system_owner())
    WITH CHECK (auth_is_system_owner());

CREATE POLICY "rep_access_assigned_section_groups" ON groups
    FOR ALL TO authenticated
    USING (auth_is_rep_for_section(section_id))
    WITH CHECK (auth_is_rep_for_section(section_id));

CREATE POLICY "owner_full_access_group_members" ON group_members
    FOR ALL TO authenticated
    USING (auth_is_system_owner())
    WITH CHECK (auth_is_system_owner());

CREATE POLICY "rep_access_assigned_section_group_members" ON group_members
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM groups g
            WHERE g.id = group_members.group_id
              AND auth_is_rep_for_section(g.section_id)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM groups g
            WHERE g.id = group_members.group_id
              AND auth_is_rep_for_section(g.section_id)
        )
    );

-- ============================================================================
-- 8. SUBMISSION POLICIES
-- ============================================================================

CREATE POLICY "owner_full_access_submissions" ON submissions
    FOR ALL TO authenticated
    USING (auth_is_system_owner())
    WITH CHECK (auth_is_system_owner());

CREATE POLICY "rep_access_assigned_section_submissions" ON submissions
    FOR SELECT TO authenticated
    USING (auth_is_rep_for_section(section_id));

CREATE POLICY "owner_full_access_submission_files" ON submission_files
    FOR ALL TO authenticated
    USING (auth_is_system_owner())
    WITH CHECK (auth_is_system_owner());

CREATE POLICY "rep_read_assigned_section_submission_files" ON submission_files
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM submissions s
            WHERE s.id = submission_files.submission_id
              AND auth_is_rep_for_section(s.section_id)
        )
    );

CREATE POLICY "owner_full_access_submission_members" ON submission_members
    FOR ALL TO authenticated
    USING (auth_is_system_owner())
    WITH CHECK (auth_is_system_owner());

CREATE POLICY "rep_read_assigned_section_submission_members" ON submission_members
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM submissions s
            WHERE s.id = submission_members.submission_id
              AND auth_is_rep_for_section(s.section_id)
        )
    );

-- ============================================================================
-- 9. DELIVERY & AUDIT POLICIES
-- ============================================================================

CREATE POLICY "owner_full_access_deliveries" ON deliveries
    FOR ALL TO authenticated
    USING (auth_is_system_owner())
    WITH CHECK (auth_is_system_owner());

CREATE POLICY "rep_manage_assigned_section_deliveries" ON deliveries
    FOR ALL TO authenticated
    USING (auth_is_rep_for_section(section_id))
    WITH CHECK (auth_is_rep_for_section(section_id));

CREATE POLICY "owner_full_access_delivery_items" ON delivery_items
    FOR ALL TO authenticated
    USING (auth_is_system_owner())
    WITH CHECK (auth_is_system_owner());

CREATE POLICY "rep_read_delivery_items" ON delivery_items
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM deliveries d
            WHERE d.id = delivery_items.delivery_id
              AND auth_is_rep_for_section(d.section_id)
        )
    );

CREATE POLICY "owner_read_all_audit_logs" ON audit_logs
    FOR SELECT TO authenticated
    USING (auth_is_system_owner());

CREATE POLICY "rep_read_own_audit_logs" ON audit_logs
    FOR SELECT TO authenticated
    USING (actor_id = auth.uid());

CREATE POLICY "owner_access_notifications" ON notifications
    FOR ALL TO authenticated
    USING (auth_is_system_owner())
    WITH CHECK (auth_is_system_owner());
