-- HU-ASMS: Essential Academic Structure Seed Script
-- Target: tkdrxfvxryemfdrwcmay (Production)
-- Scope: ONLY approved Haramaya University Departments, Academic Years, and Sections.
-- Excludes: Sample students, teachers, courses, projects, and groups.
-- Safety: Fully idempotent using fixed canonical UUIDs and ON CONFLICT clauses.
-- DO NOT EXECUTE without explicit user approval.

DO $$
DECLARE
    -- 1. Departments (College of Computing and Informatics - CCI, Haramaya University)
    dept_se_id UUID := '11111111-1111-1111-1111-111111111101';
    dept_cs_id UUID := '11111111-1111-1111-1111-111111111102';
    dept_it_id UUID := '11111111-1111-1111-1111-111111111103';
    dept_is_id UUID := '11111111-1111-1111-1111-111111111104';
    dept_isc_id UUID := '11111111-1111-1111-1111-111111111105';
    dept_stat_id UUID := '11111111-1111-1111-1111-111111111106';

    -- 2. Academic Years
    year_1_id UUID := '22222222-2222-2222-2222-222222222201';
    year_2_id UUID := '22222222-2222-2222-2222-222222222202';
    year_3_id UUID := '22222222-2222-2222-2222-222222222203';
    year_4_id UUID := '22222222-2222-2222-2222-222222222204';

    -- 3. Sections
    sec_1a_id UUID := '33333333-3333-3333-3333-333333333311';
    sec_1b_id UUID := '33333333-3333-3333-3333-333333333312';
    sec_2a_id UUID := '33333333-3333-3333-3333-333333333321';
    sec_2b_id UUID := '33333333-3333-3333-3333-333333333322';
    sec_3a_id UUID := '33333333-3333-3333-3333-333333333331';
    sec_3b_id UUID := '33333333-3333-3333-3333-333333333332';
    sec_4a_id UUID := '33333333-3333-3333-3333-333333333341';
    sec_4b_id UUID := '33333333-3333-3333-3333-333333333342';
BEGIN
    -- =========================================================================
    -- 1. DEPARTMENTS
    -- Table: departments (id UUID PK, code VARCHAR(30) UNIQUE, name VARCHAR(255), description TEXT)
    -- =========================================================================
    INSERT INTO departments (id, code, name, description) VALUES
        (dept_se_id,   'SE',   'Department of Software Engineering',   'College of Computing and Informatics, Haramaya University'),
        (dept_cs_id,   'CS',   'Department of Computer Science',       'College of Computing and Informatics, Haramaya University'),
        (dept_it_id,   'IT',   'Department of Information Technology', 'College of Computing and Informatics, Haramaya University'),
        (dept_is_id,   'IS',   'Department of Information Systems',    'College of Computing and Informatics, Haramaya University'),
        (dept_isc_id,  'ISc',  'Department of Information Science',    'College of Computing and Informatics, Haramaya University'),
        (dept_stat_id, 'STAT', 'Department of Statistics',             'College of Computing and Informatics, Haramaya University')
    ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        updated_at = clock_timestamp();

    -- =========================================================================
    -- 2. ACADEMIC YEARS
    -- Table: academic_years (id UUID PK, name VARCHAR(100), year_level INT CHECK (>0), is_active BOOLEAN)
    -- =========================================================================
    INSERT INTO academic_years (id, name, year_level, is_active) VALUES
        (year_1_id, '1st Year', 1, true),
        (year_2_id, '2nd Year', 2, true),
        (year_3_id, '3rd Year', 3, true),
        (year_4_id, '4th Year', 4, true)
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        year_level = EXCLUDED.year_level,
        is_active = EXCLUDED.is_active,
        updated_at = clock_timestamp();

    -- =========================================================================
    -- 3. SECTIONS
    -- Table: sections (id UUID PK, academic_year_id UUID FK, name VARCHAR(100))
    -- Constraint: uq_section_per_year UNIQUE (academic_year_id, name)
    -- =========================================================================
    INSERT INTO sections (id, academic_year_id, name) VALUES
        (sec_1a_id, year_1_id, 'Section A'),
        (sec_1b_id, year_1_id, 'Section B'),
        (sec_2a_id, year_2_id, 'Section A'),
        (sec_2b_id, year_2_id, 'Section B'),
        (sec_3a_id, year_3_id, 'Section A'),
        (sec_3b_id, year_3_id, 'Section B'),
        (sec_4a_id, year_4_id, 'Section A'),
        (sec_4b_id, year_4_id, 'Section B')
    ON CONFLICT (academic_year_id, name) DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = clock_timestamp();

END $$;
