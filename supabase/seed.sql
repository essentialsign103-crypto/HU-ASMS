-- HU-ASMS: Haramaya University Academic Submission Management System
-- Seed Data: University Structure, Departments, Years, Sections, Courses, Teachers, Sample Projects

-- Clean previous seed test records if re-running
DO $$
DECLARE
    dept_se_id UUID := '11111111-1111-1111-1111-111111111101';
    dept_cs_id UUID := '11111111-1111-1111-1111-111111111102';
    dept_it_id UUID := '11111111-1111-1111-1111-111111111103';
    dept_is_id UUID := '11111111-1111-1111-1111-111111111104';

    year_2_id UUID := '22222222-2222-2222-2222-222222222202';
    year_3_id UUID := '22222222-2222-2222-2222-222222222203';
    year_4_id UUID := '22222222-2222-2222-2222-222222222204';

    sec_2a_id UUID := '33333333-3333-3333-3333-333333333321';
    sec_2b_id UUID := '33333333-3333-3333-3333-333333333322';
    sec_3a_id UUID := '33333333-3333-3333-3333-333333333331';
    sec_3b_id UUID := '33333333-3333-3333-3333-333333333332';
    sec_4a_id UUID := '33333333-3333-3333-3333-333333333341';

    teacher_abebe_id UUID := '44444444-4444-4444-4444-444444444401';
    teacher_dawit_id UUID := '44444444-4444-4444-4444-444444444402';
    teacher_sara_id  UUID := '44444444-4444-4444-4444-444444444403';

    course_db_id UUID := '55555555-5555-5555-5555-555555555501';
    course_se_id UUID := '55555555-5555-5555-5555-555555555502';
    course_cn_id UUID := '55555555-5555-5555-5555-555555555503';

    project_db_id UUID := '66666666-6666-6666-6666-666666666601';
    project_se_id UUID := '66666666-6666-6666-6666-666666666602';

    student_hamza_id UUID := '77777777-7777-7777-7777-777777777701';
    student_a_id     UUID := '77777777-7777-7777-7777-777777777702';
    student_b_id     UUID := '77777777-7777-7777-7777-777777777703';
    student_c_id     UUID := '77777777-7777-7777-7777-777777777704';
BEGIN
    -- 1. Departments
    INSERT INTO departments (id, code, name, description) VALUES
        (dept_se_id, 'SE', 'Department of Software Engineering', 'College of Computing and Informatics'),
        (dept_cs_id, 'CS', 'Department of Computer Science', 'College of Computing and Informatics'),
        (dept_it_id, 'IT', 'Department of Information Technology', 'College of Computing and Informatics'),
        (dept_is_id, 'IS', 'Department of Information Systems', 'College of Computing and Informatics')
    ON CONFLICT (code) DO NOTHING;

    -- 2. Academic Years
    INSERT INTO academic_years (id, name, year_level, is_active) VALUES
        (year_2_id, '2nd Year', 2, true),
        (year_3_id, '3rd Year', 3, true),
        (year_4_id, '4th Year', 4, true)
    ON CONFLICT DO NOTHING;

    -- 3. Sections
    INSERT INTO sections (id, academic_year_id, name) VALUES
        (sec_2a_id, year_2_id, 'Section A'),
        (sec_2b_id, year_2_id, 'Section B'),
        (sec_3a_id, year_3_id, 'Section A'),
        (sec_3b_id, year_3_id, 'Section B'),
        (sec_4a_id, year_4_id, 'Section A')
    ON CONFLICT (academic_year_id, name) DO NOTHING;

    -- 4. Teachers
    INSERT INTO teachers (id, full_name, email, phone, department_id, is_active) VALUES
        (teacher_abebe_id, 'Dr. Abebe Kebede', 'abebe.kebede@hu.edu.et', '+251911000001', dept_se_id, true),
        (teacher_dawit_id, 'Mr. Dawit Tadesse', 'dawit.tadesse@hu.edu.et', '+251911000002', dept_cs_id, true),
        (teacher_sara_id,  'Ms. Sara Mohammed', 'sara.mohammed@hu.edu.et', '+251911000003', dept_it_id, true)
    ON CONFLICT DO NOTHING;

    -- 5. Courses
    INSERT INTO courses (id, code, title, department_id, description, is_active) VALUES
        (course_db_id, 'SEng3112', 'Database Management Systems', dept_se_id, 'Relational databases, indexing, and SQL design', true),
        (course_se_id, 'SEng3121', 'Software Engineering Architecture', dept_se_id, 'System design patterns, microservices, and workflows', true),
        (course_cn_id, 'CoSc3042', 'Computer Networks & Distributed Systems', dept_cs_id, 'Protocols, socket programming, and cloud topology', true)
    ON CONFLICT (code) DO NOTHING;

    -- 6. Sample Projects
    -- Individual Project: Database Management Assignment
    INSERT INTO projects (
        id, course_id, teacher_id, title, description,
        submission_type, opening_date, deadline, resubmission_allowed, is_active
    ) VALUES (
        project_db_id,
        course_db_id,
        teacher_abebe_id,
        'Database Management Assignment 1: Schema Normalization',
        'Normalize the provided hospital database schema to 3NF/BCNF and write SQL DDL scripts. Submit in PDF format.',
        'individual',
        clock_timestamp(),
        clock_timestamp() + interval '14 days',
        true,
        true
    ) ON CONFLICT DO NOTHING;

    -- Group Project: Software Engineering Architecture Project
    INSERT INTO projects (
        id, course_id, teacher_id, title, description,
        submission_type, opening_date, deadline, resubmission_allowed, is_active
    ) VALUES (
        project_se_id,
        course_se_id,
        teacher_abebe_id,
        'Software Engineering Architecture Term Project: Milestone 1',
        'Produce architectural design specifications, C4 diagrams, and component interactions. One group submission required per team.',
        'group',
        clock_timestamp(),
        clock_timestamp() + interval '21 days',
        false,
        true
    ) ON CONFLICT DO NOTHING;

    -- 7. Project Targets
    -- DB Assignment targeted to 3rd Year Section B and Section A
    INSERT INTO project_targets (project_id, academic_year_id, section_id) VALUES
        (project_db_id, year_3_id, sec_3b_id),
        (project_db_id, year_3_id, sec_3a_id)
    ON CONFLICT (project_id, academic_year_id, section_id) DO NOTHING;

    -- SE Project targeted to 3rd Year Section B
    INSERT INTO project_targets (project_id, academic_year_id, section_id) VALUES
        (project_se_id, year_3_id, sec_3b_id)
    ON CONFLICT (project_id, academic_year_id, section_id) DO NOTHING;

    -- 8. Project File Rules
    INSERT INTO project_file_rules (
        project_id, allowed_extensions, allowed_mime_types, max_file_size_bytes, min_group_size, max_group_size
    ) VALUES 
        (project_db_id, ARRAY['pdf'], ARRAY['application/pdf'], 20971520, 1, 1),
        (project_se_id, ARRAY['pdf', 'zip'], ARRAY['application/pdf', 'application/zip'], 52428800, 2, 5)
    ON CONFLICT (project_id) DO NOTHING;

    -- 9. Sample Students (3rd Year, Section B)
    INSERT INTO students (
        id, hu_student_id, full_name, department_id, academic_year_id, section_id,
        registration_status, is_locked, phone
    ) VALUES
        (student_hamza_id, 'HU/10294/14', 'Hamza Mohammed (Representative)', dept_se_id, year_3_id, sec_3b_id, 'approved', true, '+251911223344'),
        (student_a_id,     'HU/10295/14', 'Student A (Almaz Kebede)', dept_se_id, year_3_id, sec_3b_id, 'approved', true, '+251911223345'),
        (student_b_id,     'HU/10296/14', 'Student B (Beshir Ahmed)', dept_se_id, year_3_id, sec_3b_id, 'approved', true, '+251911223346'),
        (student_c_id,     'HU/10297/14', 'Student C (Chala Bekele)', dept_se_id, year_3_id, sec_3b_id, 'approved', true, '+251911223347')
    ON CONFLICT (hu_student_id) DO NOTHING;

END $$;
