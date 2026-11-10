-- HU-ASMS: Haramaya University Academic Submission Management System
-- Migration 01: Core Relational Schema, Constraints, Functions, and Triggers

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Enumerations and Custom Types
DO $$ BEGIN
    CREATE TYPE student_registration_status AS ENUM ('pending', 'approved', 'locked', 'suspended');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE request_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('system_owner', 'representative');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE submission_type_enum AS ENUM ('individual', 'group', 'both');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE group_status AS ENUM ('pending', 'verified', 'submitted', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE membership_status AS ENUM ('pending', 'confirmed', 'declined', 'removed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE submission_record_status AS ENUM ('active', 'superseded', 'delivered');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE delivery_status_enum AS ENUM ('pending', 'prepared', 'sent', 'failed', 'acknowledged');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3. Utility Function: Automatic Updated_At Timestamp
CREATE OR REPLACE FUNCTION update_timestamp_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = clock_timestamp();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- UNIVERSITY STRUCTURE ENTITIES
-- ============================================================================

-- Departments (e.g. Software Engineering, Computer Science)
CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(30) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TRIGGER trg_departments_updated_at
BEFORE UPDATE ON departments
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- Academic Years (e.g. 2nd Year, 3rd Year, 4th Year)
CREATE TABLE IF NOT EXISTS academic_years (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    year_level INT NOT NULL CHECK (year_level > 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TRIGGER trg_academic_years_updated_at
BEFORE UPDATE ON academic_years
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- Sections (e.g. Section A, Section B per Academic Year)
CREATE TABLE IF NOT EXISTS sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_section_per_year UNIQUE (academic_year_id, name)
);

CREATE TRIGGER trg_sections_updated_at
BEFORE UPDATE ON sections
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- ============================================================================
-- ROLES, PROFILES & REPRESENTATIVES
-- ============================================================================

-- User Profiles for Dashboard Users (System Owner & Section Representatives)
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'representative',
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50),
    telegram_user_id BIGINT UNIQUE,
    telegram_username VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- Representative Assignments to Sections
CREATE TABLE IF NOT EXISTS representative_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_rep_section UNIQUE (profile_id, section_id)
);

CREATE INDEX IF NOT EXISTS idx_rep_assignments_section ON representative_assignments(section_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_rep_assignments_profile ON representative_assignments(profile_id) WHERE is_active = true;

CREATE TRIGGER trg_rep_assignments_updated_at
BEFORE UPDATE ON representative_assignments
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- ============================================================================
-- STUDENT IDENTITY ENTITIES
-- ============================================================================

-- Master Student Roster & Registered Student Records
CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hu_student_id VARCHAR(50) UNIQUE NOT NULL, -- The unique university identifier
    full_name VARCHAR(255) NOT NULL,
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
    section_id UUID NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
    telegram_user_id BIGINT UNIQUE, -- Telegram numeric account ID
    telegram_username VARCHAR(100), -- Display only, not used for authorization
    phone VARCHAR(50),
    registration_status student_registration_status NOT NULL DEFAULT 'pending',
    is_locked BOOLEAN NOT NULL DEFAULT false, -- Set true once approved
    suspension_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_students_hu_id ON students(hu_student_id);
CREATE INDEX IF NOT EXISTS idx_students_telegram_id ON students(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_students_section ON students(section_id);
CREATE INDEX IF NOT EXISTS idx_students_year ON students(academic_year_id);

CREATE TRIGGER trg_students_updated_at
BEFORE UPDATE ON students
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- Registration Requests (First-time bot registrations awaiting admin verification)
CREATE TABLE IF NOT EXISTS registration_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hu_student_id VARCHAR(50) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
    section_id UUID NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
    telegram_user_id BIGINT NOT NULL,
    telegram_username VARCHAR(100),
    status request_status NOT NULL DEFAULT 'pending',
    admin_notes TEXT,
    reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_reg_requests_status ON registration_requests(status);
CREATE INDEX IF NOT EXISTS idx_reg_requests_huid ON registration_requests(hu_student_id);

CREATE TRIGGER trg_reg_requests_updated_at
BEFORE UPDATE ON registration_requests
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- Identity Correction Requests (When a locked student requests corrections)
CREATE TABLE IF NOT EXISTS identity_change_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    requested_changes JSONB NOT NULL, -- e.g. {"academic_year_id": "...", "section_id": "..."}
    status request_status NOT NULL DEFAULT 'pending',
    reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    admin_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TRIGGER trg_identity_change_requests_updated_at
BEFORE UPDATE ON identity_change_requests
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- Identity Change Audit History (Immutable log of academic identity edits)
CREATE TABLE IF NOT EXISTS identity_change_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    changed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    old_values JSONB NOT NULL,
    new_values JSONB NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_identity_history_student ON identity_change_history(student_id);

-- ============================================================================
-- ACADEMIC MANAGEMENT (COURSES, TEACHERS, PROJECTS)
-- ============================================================================

-- Courses
CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TRIGGER trg_courses_updated_at
BEFORE UPDATE ON courses
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- Teachers (Recipients for project submissions; no login required in v1)
CREATE TABLE IF NOT EXISTS teachers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    telegram_user_id BIGINT,
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TRIGGER trg_teachers_updated_at
BEFORE UPDATE ON teachers
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- Academic Projects
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    submission_type submission_type_enum NOT NULL DEFAULT 'individual',
    opening_date TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    deadline TIMESTAMPTZ NOT NULL,
    resubmission_allowed BOOLEAN NOT NULL DEFAULT true,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_deadline_after_opening CHECK (deadline > opening_date)
);

CREATE TRIGGER trg_projects_updated_at
BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- Project Targets (Links a project to one or multiple academic years & sections)
CREATE TABLE IF NOT EXISTS project_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    section_id UUID REFERENCES sections(id) ON DELETE CASCADE, -- NULL means ALL sections in that year
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_project_target UNIQUE (project_id, academic_year_id, section_id)
);

CREATE INDEX IF NOT EXISTS idx_project_targets_project ON project_targets(project_id);
CREATE INDEX IF NOT EXISTS idx_project_targets_scope ON project_targets(academic_year_id, section_id);

-- Project File & Group Constraints
CREATE TABLE IF NOT EXISTS project_file_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    allowed_extensions TEXT[] NOT NULL DEFAULT ARRAY['pdf'],
    allowed_mime_types TEXT[] NOT NULL DEFAULT ARRAY['application/pdf'],
    max_file_size_bytes BIGINT NOT NULL DEFAULT 20971520, -- 20MB
    min_group_size INT NOT NULL DEFAULT 1,
    max_group_size INT NOT NULL DEFAULT 10,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_group_size_bounds CHECK (min_group_size <= max_group_size)
);

CREATE TRIGGER trg_project_file_rules_updated_at
BEFORE UPDATE ON project_file_rules
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- ============================================================================
-- GROUP MANAGEMENT & MEMBERSHIP VERIFICATION
-- ============================================================================

-- Groups (Pre-created before submissions begin)
CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    section_id UUID NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
    group_code VARCHAR(50) NOT NULL, -- e.g. "Group 01" (unique within project & section)
    group_leader_id UUID REFERENCES students(id) ON DELETE SET NULL, -- Authorized group submitter
    status group_status NOT NULL DEFAULT 'pending',
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_group_code_project_section UNIQUE (project_id, section_id, group_code)
);

CREATE INDEX IF NOT EXISTS idx_groups_project_section ON groups(project_id, section_id);

CREATE TRIGGER trg_groups_updated_at
BEFORE UPDATE ON groups
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- Group Members & Independent Confirmation Status
CREATE TABLE IF NOT EXISTS group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    confirmation_status membership_status NOT NULL DEFAULT 'pending',
    is_group_leader BOOLEAN NOT NULL DEFAULT false,
    confirmed_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_member_per_group UNIQUE (group_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_student ON group_members(student_id);

CREATE TRIGGER trg_group_members_updated_at
BEFORE UPDATE ON group_members
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- Prevent a student from belonging to multiple groups for the SAME project
CREATE OR REPLACE FUNCTION enforce_single_group_per_project()
RETURNS TRIGGER AS $$
DECLARE
    v_project_id UUID;
    v_existing_group_count INT;
BEGIN
    SELECT project_id INTO v_project_id FROM groups WHERE id = NEW.group_id;

    SELECT COUNT(*) INTO v_existing_group_count
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    WHERE gm.student_id = NEW.student_id
      AND g.project_id = v_project_id
      AND gm.group_id <> NEW.group_id
      AND gm.confirmation_status IN ('pending', 'confirmed');

    IF v_existing_group_count > 0 THEN
        RAISE EXCEPTION 'Student % is already assigned to another group for project %', NEW.student_id, v_project_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_single_group_per_project
BEFORE INSERT OR UPDATE ON group_members
FOR EACH ROW EXECUTE FUNCTION enforce_single_group_per_project();

-- Automatically update group status to 'verified' when all members confirm
CREATE OR REPLACE FUNCTION check_and_update_group_verification()
RETURNS TRIGGER AS $$
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
    FROM group_members
    WHERE group_id = NEW.group_id;

    IF v_total_members > 0 AND v_confirmed_members = v_total_members THEN
        UPDATE groups SET status = 'verified', updated_at = clock_timestamp()
        WHERE id = NEW.group_id AND status = 'pending';
    ELSIF v_declined_members > 0 THEN
        UPDATE groups SET status = 'pending', updated_at = clock_timestamp()
        WHERE id = NEW.group_id AND status = 'verified';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_group_verification_check
AFTER INSERT OR UPDATE ON group_members
FOR EACH ROW EXECUTE FUNCTION check_and_update_group_verification();

-- ============================================================================
-- SUBMISSION MANAGEMENT
-- ============================================================================

-- Master Submissions Table
CREATE TABLE IF NOT EXISTS submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    section_id UUID NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
    submission_type submission_type_enum NOT NULL, -- 'individual' or 'group'
    student_id UUID REFERENCES students(id) ON DELETE RESTRICT, -- Required for individual
    group_id UUID REFERENCES groups(id) ON DELETE RESTRICT, -- Required for group
    version INT NOT NULL DEFAULT 1,
    status submission_record_status NOT NULL DEFAULT 'active',
    submitted_by_telegram_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    -- Enforce mutual exclusivity of submitter types
    CONSTRAINT chk_submission_ownership CHECK (
        (submission_type = 'individual' AND student_id IS NOT NULL AND group_id IS NULL) OR
        (submission_type = 'group' AND group_id IS NOT NULL AND student_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_submissions_project ON submissions(project_id);
CREATE INDEX IF NOT EXISTS idx_submissions_section ON submissions(section_id);
CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_submissions_group ON submissions(group_id);

-- CRITICAL DATABASE-LEVEL CONSTRAINTS: Only ONE active submission per project
-- 1. Individual: One active submission per student per project
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_individual_submission 
ON submissions(project_id, student_id) 
WHERE status = 'active' AND submission_type = 'individual';

-- 2. Group: One active submission per group per project
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_group_submission 
ON submissions(project_id, group_id) 
WHERE status = 'active' AND submission_type = 'group';

CREATE TRIGGER trg_submissions_updated_at
BEFORE UPDATE ON submissions
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- Submission Files (Storage paths, file signatures, size)
CREATE TABLE IF NOT EXISTS submission_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    original_filename VARCHAR(255) NOT NULL,
    storage_path TEXT NOT NULL, -- Path inside private Supabase storage bucket
    file_size_bytes BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    checksum_sha256 VARCHAR(64),
    telegram_file_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_submission_files_submission ON submission_files(submission_id);

-- Submission Members Snapshot (Historical snapshot of verified members at submission time)
CREATE TABLE IF NOT EXISTS submission_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
    hu_student_id VARCHAR(50) NOT NULL,
    student_name VARCHAR(255) NOT NULL,
    is_submitter BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_submission_members_sub ON submission_members(submission_id);

-- ============================================================================
-- MANUAL TEACHER DELIVERY & AUDIT LOGS
-- ============================================================================

-- Teacher Deliveries (Manual batching & forwarding records)
CREATE TABLE IF NOT EXISTS deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    section_id UUID NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
    representative_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    batch_count INT NOT NULL DEFAULT 0,
    status delivery_status_enum NOT NULL DEFAULT 'pending',
    channel VARCHAR(50) NOT NULL DEFAULT 'telegram', -- 'telegram', 'email', 'in_person'
    delivery_notes TEXT,
    failure_reason TEXT,
    prepared_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    sent_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TRIGGER trg_deliveries_updated_at
BEFORE UPDATE ON deliveries
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- Individual items included in a delivery batch
CREATE TABLE IF NOT EXISTS delivery_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_delivery_submission UNIQUE (delivery_id, submission_id)
);

-- Comprehensive Audit Log for security and compliance
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    actor_telegram_id BIGINT,
    actor_role VARCHAR(50),
    action VARCHAR(100) NOT NULL, -- e.g. 'STUDENT_REGISTERED', 'GROUP_CONFIRMED', 'SUBMISSION_CREATED', 'DELIVERY_SENT'
    entity_type VARCHAR(50) NOT NULL, -- 'student', 'submission', 'group', 'delivery', 'project'
    entity_id UUID,
    metadata JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Outbound Notification Queue
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_telegram_id BIGINT NOT NULL,
    recipient_type VARCHAR(50) NOT NULL, -- 'student', 'representative', 'owner'
    message TEXT NOT NULL,
    payload JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'failed'
    retry_count INT NOT NULL DEFAULT 0,
    sent_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status) WHERE status = 'pending';
