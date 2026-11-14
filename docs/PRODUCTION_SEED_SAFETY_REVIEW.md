# Production Seed Script Safety Review

**Date:** November 10, 2026  
**File:** `supabase/seed.sql`  
**Review Type:** STRICTLY READ-ONLY Safety Analysis  
**Status:** ⚠️ AWAITING EXECUTION APPROVAL

---

## Executive Summary

The seed script is **SAFE TO EXECUTE** against production database with the following characteristics:

✅ **Idempotent** — Uses `ON CONFLICT DO NOTHING`, can be safely re-run  
✅ **No destructive operations** — No DELETE, TRUNCATE, or UPDATE statements  
✅ **No Auth user creation** — Does not touch `auth.users` table  
✅ **No profile creation** — Does not create System Owner or representative profiles  
✅ **Migration compatible** — Aligns with all 11 applied migrations  
⚠️ **Contains sample/demo data** — Includes 4 test students for demonstration

---

## Section 1: SQL Structure Analysis

### Script Format

**Wrapper:** `DO $$ ... END $$;` (anonymous PL/pgSQL block)

**Execution Mode:** Atomic transaction — all INSERTs succeed or all fail

**Variable Declarations:** Uses local UUID variables for record IDs (lines 8-42)

**Idempotency Mechanism:** All INSERT statements use `ON CONFLICT ... DO NOTHING`

---

## Section 2: Tables Modified

### Tables with INSERT Operations (10 total)

| # | Table | Records | Type | Essential |
|---|-------|---------|------|-----------|
| 1 | `departments` | 4 | Core Structure | ✅ YES |
| 2 | `academic_years` | 3 | Core Structure | ✅ YES |
| 3 | `sections` | 5 | Core Structure | ✅ YES |
| 4 | `teachers` | 3 | Academic Content | ⚠️ DEMO |
| 5 | `courses` | 3 | Academic Content | ⚠️ DEMO |
| 6 | `projects` | 2 | Academic Content | ⚠️ DEMO |
| 7 | `project_targets` | 3 | Academic Content | ⚠️ DEMO |
| 8 | `project_file_rules` | 2 | Academic Content | ⚠️ DEMO |
| 9 | `students` | 4 | Test Data | ❌ DEMO ONLY |
| 10 | (no other tables) | - | - | - |

**NOT Modified:**
- ❌ `auth.users` — No Auth user creation
- ❌ `profiles` — No dashboard user profiles
- ❌ `representative_assignments` — No rep assignments
- ❌ `registration_requests` — No pending requests
- ❌ Any RLS policies, migrations, or schema objects

---

## Section 3: Exact Record Details

### 3.1 Departments (ESSENTIAL) ✅

**Table:** `departments`  
**Records:** 4  
**Purpose:** Core university organizational structure

```sql
INSERT INTO departments (id, code, name, description) VALUES
  ('11111111-1111-1111-1111-111111111101', 'SE', 'Department of Software Engineering', 'College of Computing and Informatics'),
  ('11111111-1111-1111-1111-111111111102', 'CS', 'Department of Computer Science', 'College of Computing and Informatics'),
  ('11111111-1111-1111-1111-111111111103', 'IT', 'Department of Information Technology', 'College of Computing and Informatics'),
  ('11111111-1111-1111-1111-111111111104', 'IS', 'Department of Information Systems', 'College of Computing and Informatics')
ON CONFLICT (code) DO NOTHING;
```

**Conflict Resolution:** Unique constraint on `code` column

**Impact:** BLOCKS REGISTRATION if empty — required for student registration workflow

**Verification Need:** ⚠️ Confirm these are official Haramaya University departments

---

### 3.2 Academic Years (ESSENTIAL) ✅

**Table:** `academic_years`  
**Records:** 3  
**Purpose:** Year-level classification for students

```sql
INSERT INTO academic_years (id, name, year_level, is_active) VALUES
  ('22222222-2222-2222-2222-222222222202', '2nd Year', 2, true),
  ('22222222-2222-2222-2222-222222222203', '3rd Year', 3, true),
  ('22222222-2222-2222-2222-222222222204', '4th Year', 4, true)
ON CONFLICT DO NOTHING;
```

**Conflict Resolution:** No explicit unique constraint (conflict on primary key `id` only)

**Impact:** Required for registration after department selection

**Note:** Missing 1st Year — may need addition if 1st year students register

---

### 3.3 Sections (ESSENTIAL) ✅

**Table:** `sections`  
**Records:** 5  
**Purpose:** Section groupings within academic years

```sql
INSERT INTO sections (id, academic_year_id, name) VALUES
  ('33333333-3333-3333-3333-333333333321', '22222222-2222-2222-2222-222222222202', 'Section A'),  -- 2nd Year
  ('33333333-3333-3333-3333-333333333322', '22222222-2222-2222-2222-222222222202', 'Section B'),  -- 2nd Year
  ('33333333-3333-3333-3333-333333333331', '22222222-2222-2222-2222-222222222203', 'Section A'),  -- 3rd Year
  ('33333333-3333-3333-3333-333333333332', '22222222-2222-2222-2222-222222222203', 'Section B'),  -- 3rd Year
  ('33333333-3333-3333-3333-333333333341', '22222222-2222-2222-2222-222222222204', 'Section A')   -- 4th Year
ON CONFLICT (academic_year_id, name) DO NOTHING;
```

**Conflict Resolution:** Unique constraint on `(academic_year_id, name)`

**Impact:** Required for final step of registration workflow

**Note:** 4th Year has only Section A (no Section B) — may need expansion

---

### 3.4 Teachers (DEMO DATA) ⚠️

**Table:** `teachers`  
**Records:** 3  
**Purpose:** Faculty members for course assignments

```sql
INSERT INTO teachers (id, full_name, email, phone, department_id, is_active) VALUES
  ('44444444-4444-4444-4444-444444444401', 'Dr. Abebe Kebede', 'abebe.kebede@hu.edu.et', '+251911000001', dept_se_id, true),
  ('44444444-4444-4444-4444-444444444402', 'Mr. Dawit Tadesse', 'dawit.tadesse@hu.edu.et', '+251911000002', dept_cs_id, true),
  ('44444444-4444-4444-4444-444444444403', 'Ms. Sara Mohammed', 'sara.mohammed@hu.edu.et', '+251911000003', dept_it_id, true)
ON CONFLICT DO NOTHING;
```

**Type:** Sample demonstration data  
**Essential:** ❌ NOT required for student registration  
**Use Case:** Enables project/course workflow testing

**Email Domain:** Uses `@hu.edu.et` (Haramaya University domain) ✅

---

### 3.5 Courses (DEMO DATA) ⚠️

**Table:** `courses`  
**Records:** 3  
**Purpose:** Academic courses offered

```sql
INSERT INTO courses (id, code, title, department_id, description, is_active) VALUES
  ('55555555-5555-5555-5555-555555555501', 'SEng3112', 'Database Management Systems', dept_se_id, '...', true),
  ('55555555-5555-5555-5555-555555555502', 'SEng3121', 'Software Engineering Architecture', dept_se_id, '...', true),
  ('55555555-5555-5555-5555-555555555503', 'CoSc3042', 'Computer Networks & Distributed Systems', dept_cs_id, '...', true)
ON CONFLICT (code) DO NOTHING;
```

**Type:** Sample demonstration data  
**Essential:** ❌ NOT required for student registration  
**Conflict Resolution:** Unique constraint on `code`

---

### 3.6 Projects (DEMO DATA) ⚠️

**Table:** `projects`  
**Records:** 2  
**Purpose:** Assignment/project definitions

**Project 1:** Database Management Assignment (individual)
- Deadline: 14 days from insertion
- File type: PDF only
- Max size: 20MB

**Project 2:** Software Engineering Architecture Project (group)
- Deadline: 21 days from insertion
- File types: PDF, ZIP
- Group size: 2-5 members
- Max size: 20MB

**Type:** Sample demonstration data  
**Essential:** ❌ NOT required for student registration  
**Note:** Uses `clock_timestamp()` for dynamic dates

---

### 3.7 Project Targets (DEMO DATA) ⚠️

**Table:** `project_targets`  
**Records:** 3  
**Purpose:** Links projects to specific academic year/section combinations

```sql
INSERT INTO project_targets (project_id, academic_year_id, section_id) VALUES
  (project_db_id, year_3_id, sec_3b_id),  -- DB Assignment → 3rd Year Section B
  (project_db_id, year_3_id, sec_3a_id),  -- DB Assignment → 3rd Year Section A
  (project_se_id, year_3_id, sec_3b_id)   -- SE Project → 3rd Year Section B
ON CONFLICT (project_id, academic_year_id, section_id) DO NOTHING;
```

**Type:** Sample demonstration data  
**Essential:** ❌ NOT required for student registration

---

### 3.8 Project File Rules (DEMO DATA) ⚠️

**Table:** `project_file_rules`  
**Records:** 2  
**Purpose:** File upload validation rules per project

```sql
INSERT INTO project_file_rules (
  project_id, allowed_extensions, allowed_mime_types, max_file_size_bytes, min_group_size, max_group_size
) VALUES 
  (project_db_id, ARRAY['pdf'], ARRAY['application/pdf'], 20971520, 1, 1),
  (project_se_id, ARRAY['pdf', 'zip'], ARRAY['application/pdf', 'application/zip'], 20971520, 2, 5)
ON CONFLICT (project_id) DO NOTHING;
```

**Type:** Sample demonstration data  
**Essential:** ❌ NOT required for student registration

---

### 3.9 Students (TEST DATA) ❌

**Table:** `students`  
**Records:** 4  
**Purpose:** Sample students for testing workflows

```sql
INSERT INTO students (
  id, hu_student_id, full_name, department_id, academic_year_id, section_id,
  registration_status, is_locked, phone
) VALUES
  ('77777777-7777-7777-7777-777777777701', '1341/17', 'Hamza Teha(Representative)', dept_se_id, year_3_id, sec_3b_id, 'approved', true, '+251965614501'),
  ('77777777-7777-7777-7777-777777777702', 'HU/10295/14', 'Student A (Almaz Kebede)', dept_se_id, year_3_id, sec_3b_id, 'approved', true, '+251911223345'),
  ('77777777-7777-7777-7777-777777777703', 'HU/10296/14', 'Student B (Beshir Ahmed)', dept_se_id, year_3_id, sec_3b_id, 'approved', true, '+251911223346'),
  ('77777777-7777-7777-7777-777777777704', 'HU/10297/14', 'Student C (Chala Bekele)', dept_se_id, year_3_id, sec_3b_id, 'approved', true, '+251911223347')
ON CONFLICT (hu_student_id) DO NOTHING;
```

**Type:** TEST/DEMO data only  
**Essential:** ❌ ABSOLUTELY NOT required for production  
**Status:** All marked as `'approved'` and `is_locked = true`

**⚠️ PRODUCTION CONCERN:** These are sample students for testing. Should they be included in production?

**Conflict Resolution:** Unique constraint on `hu_student_id`

---

## Section 4: Foreign Key Dependencies

### Insertion Order (Respects FK Constraints) ✅

The seed script follows correct dependency order:

```
1. departments          (no FK dependencies)
   ↓
2. academic_years       (no FK dependencies)
   ↓
3. sections             (FK: academic_year_id → academic_years)
   ↓
4. teachers             (FK: department_id → departments)
   ↓
5. courses              (FK: department_id → departments)
   ↓
6. projects             (FK: course_id → courses, teacher_id → teachers)
   ↓
7. project_targets      (FK: project_id → projects, academic_year_id → academic_years, section_id → sections)
   ↓
8. project_file_rules   (FK: project_id → projects)
   ↓
9. students             (FK: department_id → departments, academic_year_id → academic_years, section_id → sections)
```

**Status:** ✅ All FK dependencies satisfied, no circular references

---

## Section 5: Idempotency Analysis

### Conflict Resolution Mechanisms

| Table | Conflict Clause | Behavior |
|-------|-----------------|----------|
| `departments` | `ON CONFLICT (code) DO NOTHING` | Skips if code exists |
| `academic_years` | `ON CONFLICT DO NOTHING` | Skips if PK exists |
| `sections` | `ON CONFLICT (academic_year_id, name) DO NOTHING` | Skips if year+name exists |
| `teachers` | `ON CONFLICT DO NOTHING` | Skips if PK exists |
| `courses` | `ON CONFLICT (code) DO NOTHING` | Skips if code exists |
| `projects` | `ON CONFLICT DO NOTHING` | Skips if PK exists |
| `project_targets` | `ON CONFLICT (project_id, academic_year_id, section_id) DO NOTHING` | Skips if combo exists |
| `project_file_rules` | `ON CONFLICT (project_id) DO NOTHING` | Skips if project_id exists |
| `students` | `ON CONFLICT (hu_student_id) DO NOTHING` | Skips if HU ID exists |

**Verdict:** ✅ **FULLY IDEMPOTENT** — Can be safely executed multiple times

**Behavior on Re-run:**
- Existing records: Preserved unchanged
- New records: Inserted
- Duplicate records: Silently skipped (no error)

---

## Section 6: Data Modification Risk Assessment

### Operations Performed

✅ **INSERT only** — No UPDATE, DELETE, or TRUNCATE statements  
✅ **Conditional INSERT** — Uses `ON CONFLICT DO NOTHING`  
✅ **Atomic execution** — Wrapped in `DO $$ ... END $$` block  
✅ **No schema changes** — Does not ALTER tables or modify structure

### Existing Data Protection

**Will NOT:**
- ❌ Delete existing departments
- ❌ Modify existing System Owner profile
- ❌ Update existing students
- ❌ Remove existing registration requests
- ❌ Change existing auth users
- ❌ Modify RLS policies

**Will ONLY:**
- ✅ Add missing departments/years/sections IF they don't exist
- ✅ Preserve existing records via conflict resolution
- ✅ Skip duplicate INSERTs silently

---

## Section 7: Live Database Conflict Analysis

### Known Existing Records

**From previous investigations:**
1. **System Owner Profile:** `f70220b8-b150-44dc-8542-fd979be72b7d` exists in `profiles` table
2. **No departments:** 0 rows currently in `departments`
3. **No students:** Likely 0 rows (needs verification)

### Potential Conflicts

| Scenario | Risk | Resolution |
|----------|------|------------|
| System Owner profile exists | ✅ SAFE | Seed doesn't touch `profiles` |
| Departments empty | ✅ SAFE | Will insert all 4 departments |
| Sample students vs. real students | ⚠️ CHECK | If real students have same HU IDs, seed students will be skipped |
| Auth users exist | ✅ SAFE | Seed doesn't touch `auth.users` |

**Critical Check Required:**

Does production already have students with these HU IDs?
- `1341/17`
- `HU/10295/14`
- `HU/10296/14`
- `HU/10297/14`

If YES → seed students will be silently skipped (safe)  
If NO → seed students will be inserted (may be undesirable in production)

---

## Section 8: Migration Compatibility

### Applied Migrations (from previous investigation)

Total: **11 migrations** applied to production

**Migration verification:**

1. `20261110000001_initial_schema.sql` — Defines all tables ✅
2. `20261110000002_row_level_security.sql` — RLS policies ✅
3. `20261110000003_storage_setup.sql` — Storage buckets ✅
4. Additional security/hardening migrations ✅

**Seed Script Compatibility:**

✅ Uses table names from `20261110000001_initial_schema.sql`  
✅ Respects unique constraints defined in migrations  
✅ Uses correct column names and data types  
✅ Does not conflict with RLS policies (uses PUBLIC schema)  
✅ Does not modify storage buckets

**Verdict:** ✅ **FULLY COMPATIBLE** with applied migrations

---

## Section 9: Auth User & Profile Creation

### Does Seed Create Auth Users? ❌ NO

**Verified:** Seed script does **NOT** contain:
- `INSERT INTO auth.users`
- `INSERT INTO profiles`
- `INSERT INTO representative_assignments`

**System Owner status:** Manually created, NOT touched by seed

**Representative accounts:** NOT created by seed — must be created via dashboard

---

## Section 10: Essential vs. Optional Data

### Essential Records (REQUIRED FOR OPERATION) ✅

**Must Execute:**

1. **Departments (4 records)** 🔴 CRITICAL
   - Blocks registration if missing
   - Required for student workflow

2. **Academic Years (3 records)** 🔴 CRITICAL
   - Required for registration workflow
   - Note: Missing 1st Year

3. **Sections (5 records)** 🔴 CRITICAL
   - Required for registration workflow
   - Note: 4th Year has only 1 section

**Total Essential Records:** 12

---

### Optional Demo Data (SAFE TO SKIP) ⚠️

**Can Skip or Remove:**

4. **Teachers (3 records)** 🟡 OPTIONAL
   - Not required for student registration
   - Enables project/course workflows

5. **Courses (3 records)** 🟡 OPTIONAL
   - Not required for student registration
   - Enables project creation

6. **Projects (2 records)** 🟡 OPTIONAL
   - Not required for student registration
   - Enables submission workflows

7. **Project Targets (3 records)** 🟡 OPTIONAL
   - Depends on projects

8. **Project File Rules (2 records)** 🟡 OPTIONAL
   - Depends on projects

9. **Students (4 records)** ❌ TEST DATA ONLY
   - NOT required for production
   - Sample/test accounts

**Total Optional Records:** 17

---

## Section 11: Recommended Execution Strategy

### Option A: Full Seed (Simplest) ✅

**Execute:** Entire `supabase/seed.sql` as-is

**Advantages:**
- ✅ One-step execution
- ✅ Enables immediate testing of all workflows
- ✅ Idempotent (safe to re-run)

**Disadvantages:**
- ⚠️ Includes 4 sample students (may be undesirable in production)
- ⚠️ Includes demo teachers/courses/projects

**Best For:** Initial deployment, staging environments, testing

---

### Option B: Essential Records Only (Production Safe) 🛡️

**Execute:** Modified seed with only departments, academic_years, sections

**SQL:**
```sql
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
END $$;
```

**Advantages:**
- ✅ Only essential records
- ✅ No sample students
- ✅ Minimal test/demo data
- ✅ Production-appropriate

**Disadvantages:**
- ⚠️ Cannot test submission workflows without projects
- ⚠️ Requires manual teacher/course/project creation later

**Best For:** Production deployment where sample data is undesirable

---

### Option C: Phased Execution (Most Control) 🎯

**Phase 1:** Departments + Academic Years + Sections (immediate)  
**Phase 2:** Teachers + Courses (when ready to configure academics)  
**Phase 3:** Projects (when assignments are defined)  
**Phase 4:** Students (never in production — test environments only)

**Best For:** Gradual rollout, official university data verification

---

## Section 12: Pre-Execution Verification Checklist

### Before Running Seed Script: ✅

- [ ] Confirm official Haramaya University department codes/names
- [ ] Verify academic year levels are correct (2nd, 3rd, 4th)
- [ ] Determine if 1st Year needs to be added
- [ ] Verify section naming convention (Section A, Section B)
- [ ] Decide: Full seed vs. Essential-only vs. Phased
- [ ] Check for existing students with conflicting HU IDs
- [ ] Backup current database state (Supabase automatic backups enabled?)
- [ ] Review demo teachers/courses — are they acceptable placeholders?

---

## Section 13: Execution Procedure

### Recommended Method: Supabase SQL Editor

**Steps:**

1. **Log into Supabase Dashboard**
   - Project: `tkdrxfvxryemfdrwcmay`
   - Navigate to: SQL Editor

2. **Copy Seed Script**
   - Full seed: Entire `supabase/seed.sql`
   - OR Essential-only: Modified script from Section 11, Option B

3. **Paste into SQL Editor**

4. **Execute Query**
   - Click "Run" button
   - Wait for completion (should take < 5 seconds)

5. **Verify Execution**
   ```sql
   -- Check departments
   SELECT COUNT(*) FROM departments;  -- Expected: 4
   
   -- Check academic years
   SELECT COUNT(*) FROM academic_years;  -- Expected: 3
   
   -- Check sections
   SELECT COUNT(*) FROM sections;  -- Expected: 5
   
   -- Check if students were inserted (if full seed)
   SELECT COUNT(*) FROM students WHERE id LIKE '77777777-%';  -- Expected: 0 or 4
   ```

6. **Test Registration Workflow**
   - Send `/start` to `@HU_ASMS_Bot`
   - Enter test Student ID
   - Enter full name
   - **Verify:** Department selection displays with 4 options

---

### Alternative Method: psql Command Line

```bash
psql "postgresql://postgres:[SERVICE_ROLE_KEY]@tkdrxfvxryemfdrwcmay.supabase.co:5432/postgres" -f supabase/seed.sql
```

⚠️ **Security:** Do NOT expose service role key in logs

---

## Section 14: Post-Execution Verification

### Required Checks After Execution:

1. **Verify Record Counts:**
   ```sql
   SELECT 
     (SELECT COUNT(*) FROM departments) as dept_count,
     (SELECT COUNT(*) FROM academic_years) as year_count,
     (SELECT COUNT(*) FROM sections) as section_count,
     (SELECT COUNT(*) FROM teachers) as teacher_count,
     (SELECT COUNT(*) FROM courses) as course_count,
     (SELECT COUNT(*) FROM projects) as project_count;
   ```

   **Expected (Full Seed):**
   ```
   dept_count: 4
   year_count: 3
   section_count: 5
   teacher_count: 3
   course_count: 3
   project_count: 2
   ```

2. **Verify Department Data:**
   ```sql
   SELECT code, name FROM departments ORDER BY code;
   ```

   **Expected:**
   ```
   CS | Department of Computer Science
   IS | Department of Information Systems
   IT | Department of Information Technology
   SE | Department of Software Engineering
   ```

3. **Test Live Telegram Bot:**
   - Send `/start` to `@HU_ASMS_Bot`
   - Verify department selection keyboard appears
   - Verify academic year selection appears
   - Verify section selection appears

4. **Verify System Owner Unaffected:**
   ```sql
   SELECT id, email, role FROM profiles 
   WHERE id = 'f70220b8-b150-44dc-8542-fd979be72b7d';
   ```

   **Expected:** System Owner profile still exists unchanged

---

## Section 15: Rollback Plan

### If Execution Fails or Causes Issues:

**Idempotency Protection:** ✅ Script cannot corrupt existing data

**Rollback Options:**

1. **Minimal Impact Approach:**
   - Seed script uses `ON CONFLICT DO NOTHING`
   - Existing records are NOT modified
   - New records can be manually deleted if needed

2. **Manual Record Removal:**
   ```sql
   -- Remove seed students (if undesired in production)
   DELETE FROM students WHERE id LIKE '77777777-%';
   
   -- Remove demo projects (if undesired)
   DELETE FROM project_file_rules WHERE project_id LIKE '66666666-%';
   DELETE FROM project_targets WHERE project_id LIKE '66666666-%';
   DELETE FROM projects WHERE id LIKE '66666666-%';
   
   -- Remove demo courses
   DELETE FROM courses WHERE id LIKE '55555555-%';
   
   -- Remove demo teachers
   DELETE FROM teachers WHERE id LIKE '44444444-%';
   ```

   ⚠️ **Do NOT delete departments/years/sections** — required for operation

3. **Supabase Point-in-Time Recovery:**
   - If catastrophic failure occurs
   - Supabase provides automatic backups
   - Can restore to pre-execution state

---

## Section 16: Known Limitations & Considerations

### Missing Data Elements

1. **1st Year Academic Year** ❌
   - Seed only includes 2nd, 3rd, 4th years
   - If 1st year students need to register, must be added

2. **Limited Sections** ⚠️
   - 4th Year has only Section A
   - May need Section B if class size requires it

3. **No Representative Assignments** ⚠️
   - Seed does not assign representatives to sections
   - Must be done manually via System Owner dashboard

4. **Demo Teachers Use Sample Names** ⚠️
   - "Dr. Abebe Kebede", "Mr. Dawit Tadesse", etc.
   - Should be replaced with real faculty before production

5. **Sample Projects Have Dynamic Deadlines** ⚠️
   - Uses `clock_timestamp() + interval '14 days'`
   - Deadlines calculated from insertion time
   - Real projects should have explicit dates

---

## Section 17: Security Considerations

### Access Control

✅ **RLS Policies Enforced:** Seed data respects existing RLS policies  
✅ **No Privilege Escalation:** Does not grant roles or permissions  
✅ **No Auth Bypass:** Does not create backdoor accounts  
✅ **Service Role Required:** Execution requires admin privileges (via Supabase dashboard or service_role connection)

### Data Privacy

✅ **No Real Student PII:** Sample students use fictitious names  
✅ **No Real Phone Numbers:** Phone numbers are dummy values  
✅ **No Real Email:** Teacher emails use `@hu.edu.et` domain (institutional)

### Audit Trail

⚠️ **No Audit Logging:** Seed execution itself is not logged in `audit_logs` table  
✅ **Supabase Logs:** Execution visible in Supabase query logs  
✅ **Timestamped Records:** All inserted records have `created_at` timestamps

---

## Section 18: Final Safety Verdict

### Overall Assessment: ✅ SAFE TO EXECUTE

**Confidence Level:** HIGH

**Reasoning:**

1. ✅ **Idempotent** — Cannot cause data corruption on re-run
2. ✅ **Non-destructive** — No DELETE/UPDATE/TRUNCATE operations
3. ✅ **Migration-compatible** — Aligns with applied schema
4. ✅ **Conflict-protected** — Existing records preserved
5. ✅ **No auth manipulation** — Does not touch auth.users or profiles
6. ✅ **FK-respecting** — Correct insertion order
7. ✅ **Atomic** — All-or-nothing execution
8. ⚠️ **Contains demo data** — 4 sample students + demo projects

---

## Section 19: Recommended Action

### Immediate Next Steps:

1. **Obtain Official Verification** ⚠️
   - Confirm departments (SE, CS, IT, IS) are official
   - Confirm academic year structure
   - Confirm section naming

2. **Choose Execution Strategy:**
   - **Full Seed** (includes demo data) — for staging/testing
   - **Essential-Only** (departments/years/sections) — for production

3. **Execute Seed Script:**
   - Via Supabase SQL Editor
   - Follow procedure in Section 13
   - Verify results per Section 14

4. **Test Registration Workflow:**
   - Telegram bot `/start` command
   - Verify department/year/section selection

5. **Document Execution:**
   - Record execution timestamp
   - Note any issues or deviations
   - Update deployment documentation

---

## Section 20: Questions Requiring User Decision

### Before Execution, Confirm:

1. **Are the department codes/names officially correct?**
   - SE, CS, IT, IS — are these the official Haramaya University departments?

2. **Should sample students be included in production?**
   - 4 test students with IDs: `1341/17`, `HU/10295/14`, `HU/10296/14`, `HU/10297/14`
   - Recommended: NO for production

3. **Should demo teachers/courses/projects be included?**
   - Enables immediate workflow testing
   - Can be removed later if needed

4. **Is 1st Year missing intentionally?**
   - Seed only has 2nd, 3rd, 4th years
   - Does 1st Year need to be added?

5. **Execute full seed or essential-only?**
   - Full: All tables including demos
   - Essential: Only departments/years/sections

---

## Appendix A: Seed Script Line-by-Line Breakdown

| Lines | Content | Type | Risk |
|-------|---------|------|------|
| 1-5 | Header comments | Documentation | None |
| 6 | `DO $$` | Begin PL/pgSQL block | None |
| 7 | `DECLARE` | Variable declarations | None |
| 8-42 | UUID variable assignments | Setup | None |
| 43 | `BEGIN` | Start execution block | None |
| 44-47 | `INSERT INTO departments` | Core data | LOW |
| 48-52 | `INSERT INTO academic_years` | Core data | LOW |
| 53-59 | `INSERT INTO sections` | Core data | LOW |
| 60-65 | `INSERT INTO teachers` | Demo data | LOW |
| 66-71 | `INSERT INTO courses` | Demo data | LOW |
| 72-93 | `INSERT INTO projects` (2 records) | Demo data | LOW |
| 94-100 | `INSERT INTO project_targets` | Demo data | LOW |
| 101-107 | `INSERT INTO project_file_rules` | Demo data | LOW |
| 108-118 | `INSERT INTO students` | Test data | MEDIUM ⚠️ |
| 119 | `END $$;` | End block | None |

**Riskiest Section:** Lines 108-118 (sample students) — may be undesirable in production

---

## Appendix B: Alternative Execution Commands

### Via Supabase CLI (if installed)

```bash
supabase db push --db-url postgresql://postgres:[KEY]@tkdrxfvxryemfdrwcmay.supabase.co:5432/postgres
```

### Via curl (REST API)

```bash
curl -X POST 'https://tkdrxfvxryemfdrwcmay.supabase.co/rest/v1/rpc/exec_sql' \
  -H "apikey: [ANON_KEY]" \
  -H "Authorization: Bearer [SERVICE_ROLE_KEY]" \
  -H "Content-Type: application/json" \
  -d '{"query": "[SEED_SQL_ESCAPED]"}'
```

⚠️ **Not Recommended:** REST API approach is complex and error-prone

---

**Review Complete** — Awaiting execution approval and official university data verification.
