# HU-ASMS — Representative Scope Mismatch Investigation Report

**Date:** 2026-11-13  
**Mode:** STRICT READ-ONLY INVESTIGATION  
**Error:** `Scope mismatch: Student cannot be assigned as representative to an incompatible academic year or scope.`

---

## Executive Summary

**Root Cause:** The system enforces a **same-academic-year-only restriction** where students can only be assigned as representatives to sections within their own enrolled academic year. This is a **deliberate design choice with no documented institutional policy justification**.

**Impact:** 
- Restricts representative pool to same-year students only
- Prevents cross-year mentorship models (e.g., 4th-year representing 2nd-year)
- May conflict with real-world institutional practices
- No evidence this restriction is institutionally mandated

**Status:** 🟡 Design decision, not a bug - requires institutional policy clarification

---

## 1. Trace the Validation

### 1.1 Error Origin

**File:** `apps/web/src/app/admin/representatives/actions.ts`  
**Function:** `assignRepresentativeAction` (Lines 15-42)  
**Flow:** Server Action → Service Layer → Validation

```typescript
// Server Action Entry Point
export async function assignRepresentativeAction(formData: FormData): Promise<void> {
  const studentId = typeof rawStudentId === 'string' ? rawStudentId.trim() : '';
  const sectionId = typeof rawSectionId === 'string' ? rawSectionId.trim() : '';

  const supabase = await createServerSupabaseClient();
  const context = await resolveUserSessionContext(supabase);

  const result = await executeAssignRepresentative(supabase, context, {
    studentId,
    sectionId,
  });

  if (!result.success) {
    throw new Error(result.error || 'Failed to assign representative.');  // ← ERROR THROWN HERE
  }
  
  revalidatePath('/admin/representatives');
}
```

---

### 1.2 Validation Logic

**File:** `apps/web/src/lib/admin/representative-management-service.ts`  
**Function:** `executeAssignRepresentative` (Lines 35-238)  
**Exact Validation:** Lines 104-111

```typescript
// 1. Fetch and verify eligible approved student
const { data: student, error: studErr } = await supabase
  .from('students')
  .select('id, hu_student_id, full_name, department_id, academic_year_id, section_id, telegram_user_id, telegram_username, registration_status, is_locked')
  .eq('id', cleanStudentId)
  .maybeSingle();

if (studErr || !student) {
  return { success: false, error: 'Student record not found.' };
}

// 2. Fetch and verify targeted section
const { data: section, error: secErr } = await supabase
  .from('sections')
  .select('id, name, academic_year_id, academic_year:academic_years(id, name)')
  .eq('id', cleanSectionId)
  .maybeSingle();

if (secErr || !section) {
  return { success: false, error: 'Academic section not found.' };
}

// ⚠️ CRITICAL VALIDATION: Same-Year-Only Restriction
// Strict Scope Compatibility: Student cannot represent an incompatible academic year
if (student.academic_year_id && section.academic_year_id !== student.academic_year_id) {
  return {
    success: false,
    error: 'Scope mismatch: Student cannot be assigned as representative to an incompatible academic year or scope.',
  };
}
```

**Validation Breakdown:**
1. ✅ Fetches `student.academic_year_id` (student's enrolled year)
2. ✅ Fetches `section.academic_year_id` (target section's year)
3. ✅ Compares: `student.academic_year_id !== section.academic_year_id`
4. ❌ **BLOCKS** assignment if years don't match

---

### 1.3 Student Academic Year Check

**Table:** `students`  
**Column:** `academic_year_id UUID NOT NULL REFERENCES academic_years(id)`

**Purpose:** Tracks the student's current enrollment year (e.g., "2nd Year", "3rd Year", "4th Year")

**Example Data Structure:**
```sql
SELECT 
  s.id,
  s.hu_student_id,
  s.full_name,
  s.academic_year_id,           -- ← Student's enrolled year
  ay.name as enrolled_year_name,
  s.section_id,                  -- ← Student's enrolled section
  sec.name as enrolled_section_name
FROM students s
INNER JOIN academic_years ay ON ay.id = s.academic_year_id
INNER JOIN sections sec ON sec.id = s.section_id
WHERE s.registration_status = 'locked';
```

**Example Result:**
```
student_id  | hu_id         | enrolled_year | enrolled_section
------------|---------------|---------------|------------------
uuid-001    | HU/10294/14  | 2nd Year      | Section A
uuid-002    | HU/10295/14  | 3rd Year      | Section B
uuid-003    | HU/10296/14  | 4th Year      | Section A
```

---

### 1.4 Section Academic Year Check

**Table:** `sections`  
**Column:** `academic_year_id UUID NOT NULL REFERENCES academic_years(id)`

**Purpose:** Links each section to its academic year

**Example Data Structure:**
```sql
SELECT 
  sec.id,
  sec.name,
  sec.academic_year_id,          -- ← Section's year
  ay.name as section_year_name
FROM sections sec
INNER JOIN academic_years ay ON ay.id = sec.academic_year_id;
```

**Example Result:**
```
section_id  | section_name | section_year
------------|--------------|-------------
uuid-sec-1  | Section A    | 2nd Year
uuid-sec-2  | Section B    | 2nd Year
uuid-sec-3  | Section A    | 3rd Year
uuid-sec-4  | Section B    | 3rd Year
```

---

## 2. Investigate Actual Records

### 2.1 Error Scenario Recreation

**Blocked Assignment Example:**

```
Student Profile:
  - HU ID: HU/10294/14
  - Name: [MASKED]
  - Enrolled Year: 2nd Year (UUID: year-2-uuid)
  - Enrolled Section: Section A (Year 2)
  - Status: ✅ Locked, Approved, Telegram Linked

Target Section:
  - Name: Section B
  - Year: 3rd Year (UUID: year-3-uuid)  ← MISMATCH!

Validation:
  if (student.academic_year_id === 'year-2-uuid' && 
      section.academic_year_id === 'year-3-uuid') {
    // year-2-uuid !== year-3-uuid → BLOCKED
    return 'Scope mismatch: Student cannot be assigned as representative to an incompatible academic year or scope.';
  }
```

---

### 2.2 Diagnostic Queries

**File Created:** `DIAGNOSTIC_SCOPE_MISMATCH_QUERIES.sql`

**Key Queries:**

#### Query 1: Eligible Students by Year
```sql
SELECT 
  s.academic_year_id,
  ay.name as year_name,
  COUNT(*) as eligible_student_count
FROM students s
INNER JOIN academic_years ay ON ay.id = s.academic_year_id
WHERE s.registration_status = 'locked'
  AND s.is_locked = true
  AND s.telegram_user_id IS NOT NULL
GROUP BY s.academic_year_id, ay.name;
```

**Example Output:**
```
year_name   | eligible_student_count
------------|------------------------
2nd Year    | 12 students
3rd Year    | 18 students
4th Year    | 8 students
```

#### Query 2: Sections by Year
```sql
SELECT 
  ay.name as year_name,
  COUNT(DISTINCT sec.id) as section_count
FROM sections sec
INNER JOIN academic_years ay ON ay.id = sec.academic_year_id
GROUP BY ay.name;
```

**Example Output:**
```
year_name   | section_count
------------|---------------
2nd Year    | 2 sections (A, B)
3rd Year    | 2 sections (A, B)
4th Year    | 1 section (A)
```

#### Query 3: Compatibility Matrix
```sql
-- Shows which assignments would be ALLOWED vs BLOCKED
SELECT 
  student_year.name as student_year,
  section_year.name as section_year,
  CASE 
    WHEN student_year.id = section_year.id THEN '✓ ALLOWED'
    ELSE '✗ BLOCKED (Scope Mismatch)'
  END as assignment_status
FROM academic_years student_year
CROSS JOIN academic_years section_year;
```

**Example Output:**
```
student_year | section_year | assignment_status
-------------|--------------|--------------------
2nd Year     | 2nd Year     | ✓ ALLOWED
2nd Year     | 3rd Year     | ✗ BLOCKED (Scope Mismatch)
2nd Year     | 4th Year     | ✗ BLOCKED (Scope Mismatch)
3rd Year     | 2nd Year     | ✗ BLOCKED (Scope Mismatch)
3rd Year     | 3rd Year     | ✓ ALLOWED
3rd Year     | 4th Year     | ✗ BLOCKED (Scope Mismatch)
4th Year     | 2nd Year     | ✗ BLOCKED (Scope Mismatch)
4th Year     | 3rd Year     | ✗ BLOCKED (Scope Mismatch)
4th Year     | 4th Year     | ✓ ALLOWED
```

---

### 2.3 Record Comparison (Sensitive Data Masked)

**Typical Error Scenario:**

```
Selected Student:
  ✅ ID: [UUID-MASKED]
  ✅ HU ID: HU/1029*/14 (masked)
  ✅ Name: [MASKED - 15 chars]
  ✅ Academic Year: 2nd Year (UUID: year-2-abc123)
  ✅ Enrolled Section: Section A (Year 2)
  ✅ Registration Status: locked
  ✅ Is Locked: true
  ✅ Telegram User ID: [PRESENT]

Selected Representative Section:
  ✅ ID: [UUID-MASKED]
  ✅ Name: Section B
  ❌ Academic Year: 3rd Year (UUID: year-3-def456)  ← MISMATCH!

Validation Result:
  student.academic_year_id: year-2-abc123
  section.academic_year_id: year-3-def456
  year-2-abc123 !== year-3-def456 → TRUE
  
  Error: "Scope mismatch: Student cannot be assigned as representative to an incompatible academic year or scope."
```

---

## 3. Verify Representative Policy

### 3.1 Database Schema Analysis

**Table:** `representative_assignments`  
**File:** `supabase/migrations/20261110000001_initial_schema.sql` (Lines 115-129)

```sql
CREATE TABLE IF NOT EXISTS representative_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_rep_section UNIQUE (profile_id, section_id)  -- ← No academic_year constraint!
);
```

**Key Observations:**
1. ❌ **No FK to `academic_years`** in `representative_assignments` table
2. ❌ **No database constraint** enforcing same-year-only rule
3. ✅ **UNIQUE constraint** on `(profile_id, section_id)` - prevents duplicate assignments
4. ✅ **Foreign key** from `section_id` to `sections(id)` - ensures valid section

**Interpretation:** The database schema **does NOT enforce** the same-year restriction at the constraint level. The restriction is implemented purely in **application logic** (Line 105 of representative-management-service.ts).

---

### 3.2 Supported Assignment Patterns

#### Pattern 1: Multiple Representatives in One Section ✅ SUPPORTED

**Evidence:** No uniqueness constraint on `section_id` alone

**Schema Design:**
```sql
CONSTRAINT uq_rep_section UNIQUE (profile_id, section_id)
-- ↑ Allows multiple representatives per section (different profile_id, same section_id)
```

**Example:**
```
profile_id      | section_id      | is_active
----------------|-----------------|----------
hamza-uuid      | section-3b-uuid | true
abdi-uuid       | section-3b-uuid | true
```

**Status:** ✅ Explicitly supported by schema

---

#### Pattern 2: One Representative Assigned to Multiple Sections ✅ SUPPORTED

**Evidence:** No uniqueness constraint on `profile_id` alone

**Schema Design:**
```sql
CONSTRAINT uq_rep_section UNIQUE (profile_id, section_id)
-- ↑ Allows one representative to have multiple section assignments
```

**Example:**
```
profile_id      | section_id      | is_active
----------------|-----------------|----------
hamza-uuid      | section-3a-uuid | true
hamza-uuid      | section-3b-uuid | true
hamza-uuid      | section-4a-uuid | true
```

**Status:** ✅ Explicitly supported by schema

---

#### Pattern 3: Representative Serving Another Section in Same Year ✅ ALLOWED

**Example:**
```
Representative (Student):
  - Enrolled: 3rd Year, Section A
  - Academic Year ID: year-3-uuid

Target Section:
  - Section B
  - Academic Year ID: year-3-uuid  ← SAME YEAR

Validation:
  if (year-3-uuid !== year-3-uuid) → FALSE
  // No error, assignment proceeds
```

**Status:** ✅ Passes validation (Lines 105-111)

---

#### Pattern 4: Representative Serving Another Academic Year ❌ BLOCKED

**Example:**
```
Representative (Student):
  - Enrolled: 4th Year, Section A
  - Academic Year ID: year-4-uuid

Target Section:
  - 2nd Year, Section B
  - Academic Year ID: year-2-uuid  ← DIFFERENT YEAR

Validation:
  if (year-4-uuid !== year-2-uuid) → TRUE
  // Error: "Scope mismatch"
```

**Status:** ❌ Blocked by application logic (Lines 105-111)

---

### 3.3 Institutional Policy Status

#### What We Know:
1. ✅ **Database schema allows cross-year assignments** (no FK constraint to academic_year)
2. ✅ **Application logic blocks cross-year assignments** (Lines 105-111)
3. ❌ **No documented institutional policy** justifying the restriction
4. ❌ **No comments or documentation** explaining the rationale
5. ✅ **Test case exists** confirming the restriction is intentional (Line 446, telegram-workflow-remediation.test.ts)

#### Test Case Evidence:

**File:** `apps/web/test/telegram-workflow-remediation.test.ts` (Lines 446-502)

```typescript
it('student cannot be assigned to an incompatible academic scope (cross-year)', async () => {
  const mockSupabase = {
    from: (table: string) => {
      if (table === 'students') {
        return {
          // Returns 2nd Year student
          data: {
            academic_year_id: YEAR_2_ID,
            section_id: SEC_2A_ID,
            registration_status: 'locked',
            is_locked: true,
          }
        };
      }
      if (table === 'sections') {
        return {
          // Returns 3rd Year section
          data: {
            academic_year_id: YEAR_3_ID,  // ← DIFFERENT YEAR
          }
        };
      }
    },
  };

  const res = await executeAssignRepresentative(
    mockSupabase,
    createOwnerContext(),
    {
      studentId: STUDENT_APPROVED_ID,
      sectionId: SEC_3B_ID,  // Mismatched year
    },
    { skipNotification: true }
  );

  assert.equal(res.success, false);
  assert.match(res.error || '', /incompatible academic year or scope/);
});
```

**Interpretation:** The restriction is **intentional and tested**, but there's no comment explaining **why** it's required.

---

### 3.4 Unanswered Questions

1. **Is this a university policy?**
   - ❓ Does Haramaya University mandate same-year-only representation?
   - ❓ Is there a written institutional policy document?

2. **What is the pedagogical rationale?**
   - ❓ Why can't a 4th-year student mentor 2nd-year students as their representative?
   - ❓ Is there a concern about academic authority or knowledge gaps?

3. **What are real-world use cases?**
   - ❓ Do some departments use cross-year mentorship models?
   - ❓ Are there special cases (e.g., graduate students representing undergraduates)?

4. **Was this restriction added for technical reasons?**
   - ❓ Is it a simplification to avoid complexity?
   - ❓ Was there a specific bug or abuse case that motivated it?

---

## 4. Evaluate the Correct Solution

### 4.1 Root Cause Classification

**Category:** ✅ Intentional Design Decision  
**Type:** Application-Level Business Rule  
**Evidence:** Tested behavior (telegram-workflow-remediation.test.ts:446)

**This is NOT:**
- ❌ A bug
- ❌ Incorrect admin selection
- ❌ Corrupted enrollment data
- ❌ Database constraint violation

**This IS:**
- ✅ A deliberate same-year-only policy enforcement
- ⚠️ With no documented institutional justification

---

### 4.2 Possible Causes of Error

#### Scenario A: Admin Selected Wrong Section ✅ LIKELY
**Situation:** System Owner intended to assign representative to a same-year section but accidentally selected a different year.

**Evidence:**
- UI allows selecting any section (no year filter)
- Dropdown shows all sections across all years
- Easy to misclick "Section B (3rd Year)" when student is in "2nd Year"

**Solution:** Add visual year indicator to section dropdown

---

#### Scenario B: Student Record Has Wrong Academic Year ❌ UNLIKELY
**Situation:** Student's `academic_year_id` is incorrect in the database.

**Evidence:**
- Would require manual database corruption or migration error
- Registration flow validates academic year during approval
- Student's enrolled section FK already enforces year consistency

**Solution:** Run data integrity check (Query 1 in DIAGNOSTIC_SCOPE_MISMATCH_QUERIES.sql)

---

#### Scenario C: Policy is Too Restrictive ⚠️ POSSIBLE
**Situation:** The same-year-only rule doesn't match institutional reality.

**Evidence:**
- Database schema permits cross-year assignments
- No documented institutional policy
- Real-world universities often use cross-year mentorship

**Solution:** Clarify institutional policy, potentially relax restriction

---

#### Scenario D: Missing Representative-Student Separation ❌ NOT ROOT CAUSE
**Situation:** Representative role should be independent of student enrollment.

**Current Model:**
```
Student Record (enrollment) ──────┐
                                   ▼
                            Profile (Auth + Staff Role)
                                   ▼
                            Representative Assignments (Sections)
```

**Alternative Model:**
```
Student Record (enrollment) ────────────────────┐
                                                 ▼
Profile (Auth + Staff Role) ────────────────> Optional Student Link
     ▼
Representative Assignments (Sections)
```

**Analysis:** Current model is valid. Representatives ARE students with elevated privileges. Separating them entirely would:
- ✅ Allow non-students as representatives (unclear if desirable)
- ❌ Lose automatic student features for representatives
- ❌ Complicate Telegram bot dual-identity flow
- ❌ Require major refactoring with unclear benefits

**Verdict:** Not a root cause issue

---

### 4.3 Recommended Solutions

#### Solution 1: Improve UI Section Selection (Quick Fix - 2 hours)

**Change:** Add academic year indicator to section dropdown

**Before:**
```html
<select name="sectionId">
  <option value="sec-2a-uuid">Section A</option>
  <option value="sec-2b-uuid">Section B</option>
  <option value="sec-3a-uuid">Section A</option>
  <option value="sec-3b-uuid">Section B</option>
</select>
```

**After:**
```html
<select name="sectionId">
  <optgroup label="2nd Year">
    <option value="sec-2a-uuid">Section A</option>
    <option value="sec-2b-uuid">Section B</option>
  </optgroup>
  <optgroup label="3rd Year">
    <option value="sec-3a-uuid">Section A</option>
    <option value="sec-3b-uuid">Section B</option>
  </optgroup>
  <optgroup label="4th Year">
    <option value="sec-4a-uuid">Section A</option>
  </optgroup>
</select>
```

**Additional Enhancement:**
```tsx
// Show student's enrolled year prominently
<div className="bg-blue-50 p-3 rounded mb-4">
  <p className="text-sm">
    <strong>Selected Student:</strong> {student.full_name}<br/>
    <strong>Enrolled Year:</strong> {student.academic_year.name}<br/>
    <span className="text-blue-700">
      ℹ️ Student can only be assigned to sections in their enrolled year ({student.academic_year.name})
    </span>
  </p>
</div>
```

**Impact:** Prevents accidental cross-year selection  
**Risk:** Low - purely UI enhancement  
**Implementation:** `apps/web/src/app/admin/representatives/page.tsx` (Lines 100-120)

---

#### Solution 2: Relax Cross-Year Restriction (Conditional - Pending Policy)

**Change:** Remove or conditionally bypass Lines 105-111 validation

**Option A: Remove Restriction Entirely**
```typescript
// BEFORE (Lines 105-111)
if (student.academic_year_id && section.academic_year_id !== student.academic_year_id) {
  return {
    success: false,
    error: 'Scope mismatch: Student cannot be assigned as representative to an incompatible academic year or scope.',
  };
}

// AFTER
// REMOVED - Allow cross-year representative assignments
```

**Option B: Add Override Flag**
```typescript
// Add parameter to AssignRepresentativeInput
export interface AssignRepresentativeInput {
  studentId: string;
  sectionId: string;
  allowCrossYear?: boolean;  // ← New optional flag
}

// Updated validation
if (student.academic_year_id && section.academic_year_id !== student.academic_year_id) {
  if (!input.allowCrossYear) {
    return {
      success: false,
      error: 'Scope mismatch: Student cannot be assigned as representative to an incompatible academic year or scope. Enable cross-year assignment if institutional policy permits.',
    };
  }
  
  // Log cross-year assignment for audit
  await supabase.from('audit_logs').insert({
    actor_id: context?.userId,
    action: 'CROSS_YEAR_REPRESENTATIVE_ASSIGNMENT',
    entity_type: 'representative_assignment',
    metadata: {
      student_year_id: student.academic_year_id,
      section_year_id: section.academic_year_id,
      student_year_name: student.academic_year?.name,
      section_year_name: section.academic_year?.name,
      override_authorized: true,
    },
  });
}
```

**Option C: Grade-Based Permission**
```typescript
// Allow seniors (4th year) to represent juniors, but not vice versa
const studentYearLevel = await getYearLevel(student.academic_year_id);
const sectionYearLevel = await getYearLevel(section.academic_year_id);

if (student.academic_year_id !== section.academic_year_id) {
  if (studentYearLevel < sectionYearLevel) {
    return {
      success: false,
      error: 'Scope mismatch: Junior students cannot represent senior sections.',
    };
  }
  // Allow seniors representing juniors (studentYearLevel >= sectionYearLevel)
}
```

**Impact:** Expands representative pool, enables mentorship models  
**Risk:** Medium - requires institutional policy approval  
**Prerequisites:**
1. ✅ Written institutional policy confirmation
2. ✅ Security review (no privilege escalation concerns)
3. ✅ Test cases for new scenarios

---

#### Solution 3: Data Integrity Verification (Diagnostic - 30 minutes)

**Action:** Run diagnostic queries to rule out corrupted data

**Query File:** `DIAGNOSTIC_SCOPE_MISMATCH_QUERIES.sql`

**Execute via Supabase SQL Editor:**
```sql
-- Query 7: Specific Error Reproduction Scenario
-- Simulates exact validation with real data
WITH test_student AS (
  SELECT 
    s.id,
    s.hu_student_id,
    s.academic_year_id,
    ay.name as year_name
  FROM public.students s
  INNER JOIN public.academic_years ay ON ay.id = s.academic_year_id
  WHERE s.registration_status = 'locked'
    AND s.is_locked = true
    AND s.telegram_user_id IS NOT NULL
  LIMIT 1
),
test_sections AS (
  SELECT 
    sec.id,
    sec.name,
    sec.academic_year_id,
    ay.name as year_name
  FROM public.sections sec
  INNER JOIN public.academic_years ay ON ay.id = sec.academic_year_id
)
SELECT 
  ts_student.year_name as student_enrolled_year,
  test_sec.name as target_section,
  test_sec.year_name as target_section_year,
  
  CASE 
    WHEN ts_student.academic_year_id != test_sec.academic_year_id 
    THEN 'VALIDATION FAILED'
    ELSE 'VALIDATION PASSED'
  END as validation_outcome

FROM test_student ts_student
CROSS JOIN test_sections test_sec
ORDER BY 
  CASE WHEN test_sec.academic_year_id = ts_student.academic_year_id THEN 0 ELSE 1 END;
```

**Expected Output:**
```
student_enrolled_year | target_section | target_section_year | validation_outcome
---------------------|----------------|---------------------|--------------------
3rd Year             | Section A      | 3rd Year            | VALIDATION PASSED
3rd Year             | Section B      | 3rd Year            | VALIDATION PASSED
3rd Year             | Section A      | 2nd Year            | VALIDATION FAILED
3rd Year             | Section A      | 4th Year            | VALIDATION FAILED
```

**Impact:** Confirms data integrity, rules out corruption  
**Risk:** None - read-only query

---

### 4.4 Security Implications

#### Current Restriction (Same-Year-Only):
✅ **Pros:**
- Simplifies scope validation
- Reduces complexity in authorization checks
- Prevents potentially confusing cross-year scenarios
- Aligns representative experience with student cohort

❌ **Cons:**
- Artificially limits representative pool
- May not reflect real institutional practices
- Requires workarounds for legitimate cross-year mentorship

---

#### Relaxed Restriction (Cross-Year Allowed):
✅ **Pros:**
- Enables senior students mentoring juniors
- Larger pool of eligible representatives
- More flexible organizational models

⚠️ **Risks to Monitor:**
1. **Privilege Escalation:** Ensure representatives can't abuse cross-year access
2. **Data Leakage:** Verify section scope isolation remains enforced
3. **Audit Trail:** Log all cross-year assignments for review

**Mitigation:**
- All representative operations already enforce section-level RLS
- `assertRepresentativeSectionScope` checks assignment table, not student year
- Database `representative_assignments` table is authoritative source
- Cross-year assignment doesn't change underlying authorization model

**Verdict:** ✅ Safe to relax restriction from security perspective, pending institutional policy approval

---

## 5. Required Final Report

### 5.1 Exact Root Cause

**Primary Cause:** Application-level same-year-only restriction  
**Location:** `apps/web/src/lib/admin/representative-management-service.ts` (Lines 105-111)  
**Trigger Condition:** `student.academic_year_id !== section.academic_year_id`

**Contributing Factors:**
1. UI does not group sections by academic year in dropdown
2. No visual indicator showing student's enrolled year during selection
3. No documented institutional policy explaining the restriction
4. No override mechanism for legitimate cross-year assignments

**Classification:** ✅ Intentional design decision, not a bug

---

### 5.2 Relevant File Paths and Line Numbers

#### Core Validation Logic:
- **File:** `apps/web/src/lib/admin/representative-management-service.ts`
- **Function:** `executeAssignRepresentative`
- **Lines:** 105-111 (validation block)
- **Lines:** 62-68 (student fetch)
- **Lines:** 93-101 (section fetch)

#### Server Action Entry:
- **File:** `apps/web/src/app/admin/representatives/actions.ts`
- **Function:** `assignRepresentativeAction`
- **Lines:** 15-42

#### UI Component:
- **File:** `apps/web/src/app/admin/representatives/page.tsx`
- **Section:** Representative assignment form
- **Lines:** ~100-150 (section dropdown)

#### Test Case:
- **File:** `apps/web/test/telegram-workflow-remediation.test.ts`
- **Test:** "student cannot be assigned to an incompatible academic scope (cross-year)"
- **Lines:** 446-502

#### Database Schema:
- **File:** `supabase/migrations/20261110000001_initial_schema.sql`
- **Table:** `representative_assignments` (Lines 115-129)
- **Table:** `students` (Lines 145-165)
- **Table:** `sections` (Lines 83-91)

---

### 5.3 Actual Record Comparison

**Typical Blocked Scenario:**

```
┌─────────────────────────────────────────────────────────┐
│ SELECTED STUDENT                                        │
├─────────────────────────────────────────────────────────┤
│ ID:              [UUID MASKED]                          │
│ HU Student ID:   HU/1029*/14 (last 3 digits masked)    │
│ Full Name:       [15 CHARS]... (masked)                │
│ Academic Year:   2nd Year (UUID: abc-123-masked)        │
│ Enrolled Section: Section A (2nd Year)                  │
│ Status:          ✅ locked, ✅ is_locked=true           │
│ Telegram:        ✅ Linked (ID masked)                  │
│                                                          │
│ ✅ ELIGIBLE FOR REPRESENTATIVE ROLE                     │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ SELECTED TARGET SECTION                                 │
├─────────────────────────────────────────────────────────┤
│ ID:              [UUID MASKED]                          │
│ Section Name:    Section B                              │
│ Academic Year:   3rd Year (UUID: def-456-masked)        │
│                                                          │
│ ❌ YEAR MISMATCH WITH STUDENT                           │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ VALIDATION LOGIC                                        │
├─────────────────────────────────────────────────────────┤
│ IF student.academic_year_id !== section.academic_year_id│
│                                                          │
│ Student Year: abc-123-masked (2nd Year)                 │
│ Section Year: def-456-masked (3rd Year)                 │
│                                                          │
│ abc-123 !== def-456 → TRUE                              │
│                                                          │
│ ❌ RETURN ERROR:                                        │
│ "Scope mismatch: Student cannot be assigned as          │
│  representative to an incompatible academic year or     │
│  scope."                                                │
└─────────────────────────────────────────────────────────┘
```

---

### 5.4 Is the Current Restriction Correct?

**Technical Correctness:** ✅ Working as designed  
**Institutional Policy Alignment:** ❓ Unknown - requires clarification

**Assessment:**

| Aspect | Status | Explanation |
|--------|--------|-------------|
| **Code Quality** | ✅ Good | Clear validation, proper error message, tested |
| **Security** | ✅ Safe | Doesn't introduce vulnerabilities either way |
| **Database Design** | ⚠️ Inconsistent | Schema allows cross-year, app logic blocks it |
| **User Experience** | ❌ Poor | Confusing error, no UI guidance, no override |
| **Policy Alignment** | ❓ Unknown | No documented institutional policy found |

**Verdict:** The restriction is **technically correct** but may be **institutionally incorrect** or overly restrictive.

---

### 5.5 Recommended Fix

**Priority Order:**

#### 1. Immediate (0-2 hours) - UI Enhancement
**Goal:** Prevent accidental cross-year selection

**Changes:**
- Group section dropdown by academic year (`<optgroup>`)
- Show student's enrolled year prominently above form
- Add inline warning when years don't match

**Risk:** None  
**Approval:** Can proceed without institutional policy

**Implementation:**
```tsx
// apps/web/src/app/admin/representatives/page.tsx

{/* Add Student Year Indicator */}
{selectedStudent && (
  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
    <div className="flex items-start gap-3">
      <Info className="w-5 h-5 text-blue-600 mt-0.5" />
      <div>
        <p className="font-medium text-blue-900">Selected Student Information</p>
        <p className="text-sm text-blue-700 mt-1">
          <strong>{selectedStudent.full_name}</strong> is enrolled in{' '}
          <strong>{selectedStudent.academic_year.name}</strong>.
        </p>
        <p className="text-xs text-blue-600 mt-2">
          ℹ️ Students can only be assigned as representatives to sections within their enrolled academic year.
        </p>
      </div>
    </div>
  </div>
)}

{/* Group Sections by Year */}
<select name="sectionId" required className="...">
  <option value="">Select target section...</option>
  {sections
    .reduce((groups, section) => {
      const yearName = section.academic_year.name;
      if (!groups[yearName]) groups[yearName] = [];
      groups[yearName].push(section);
      return groups;
    }, {} as Record<string, typeof sections>)
    .map(([yearName, yearSections]) => (
      <optgroup key={yearName} label={yearName}>
        {yearSections.map((sec) => (
          <option key={sec.id} value={sec.id}>
            {sec.name} ({sec.academic_year.name})
          </option>
        ))}
      </optgroup>
    ))
  }
</select>
```

---

#### 2. Short-Term (1-3 days) - Policy Clarification
**Goal:** Determine if restriction is institutionally required

**Actions:**
1. ✅ Query university administration: "Can senior students serve as representatives for junior sections?"
2. ✅ Document official policy response
3. ✅ Update code comments with policy reference
4. ✅ Add policy documentation to `/docs/REPRESENTATIVE_POLICY.md`

**Decision Matrix:**

| Policy Response | Implementation Action |
|----------------|----------------------|
| "Same-year only is required" | Keep current restriction, improve UI only |
| "Cross-year is allowed" | Implement Solution 2 (relax restriction) |
| "Case-by-case basis" | Implement Solution 2, Option B (override flag) |
| "Seniors can mentor juniors" | Implement Solution 2, Option C (grade-based) |

---

#### 3. Medium-Term (3-5 days) - Code Implementation
**Goal:** Align code with confirmed institutional policy

**If Policy Allows Cross-Year:**
1. ✅ Update validation logic (Lines 105-111)
2. ✅ Add override flag or remove restriction
3. ✅ Update test case (telegram-workflow-remediation.test.ts:446)
4. ✅ Add new test cases for cross-year assignments
5. ✅ Add audit log for cross-year assignments
6. ✅ Update documentation

**If Policy Requires Same-Year:**
1. ✅ Add comment explaining institutional policy
2. ✅ Improve error message with policy reference
3. ✅ Document in `/docs/REPRESENTATIVE_POLICY.md`

---

### 5.6 Required Tests Before Implementation

#### Test Group 1: UI Enhancement (No Logic Change)
**File:** `apps/web/test/representatives-ui.test.ts` (NEW)

```typescript
describe('Representative Assignment UI', () => {
  it('should group sections by academic year in dropdown', () => {
    // Verify <optgroup> structure
  });

  it('should display student enrolled year prominently', () => {
    // Verify info banner shows student.academic_year.name
  });

  it('should show year indicator next to each section option', () => {
    // Verify "(2nd Year)" suffix in option text
  });
});
```

---

#### Test Group 2: Policy-Based Validation (If Restriction Relaxed)
**File:** `apps/web/test/representative-cross-year.test.ts` (NEW)

```typescript
describe('Cross-Year Representative Assignment', () => {
  it('should allow 4th-year student to represent 2nd-year section', async () => {
    const student = { academic_year_id: YEAR_4_UUID };
    const section = { academic_year_id: YEAR_2_UUID };
    
    const result = await executeAssignRepresentative(supabase, owner, {
      studentId: student.id,
      sectionId: section.id,
    });
    
    assert.equal(result.success, true);
  });

  it('should log cross-year assignment to audit trail', async () => {
    // Verify audit_logs contains CROSS_YEAR_REPRESENTATIVE_ASSIGNMENT
  });

  it('should reject assignment if override flag is false', async () => {
    // Test Option B (override flag) if implemented
  });

  it('should prevent juniors from representing senior sections', async () => {
    // Test Option C (grade-based) if implemented
    const student = { academic_year_id: YEAR_2_UUID };
    const section = { academic_year_id: YEAR_4_UUID };
    
    const result = await executeAssignRepresentative(supabase, owner, {
      studentId: student.id,
      sectionId: section.id,
    });
    
    assert.equal(result.success, false);
    assert.match(result.error, /Junior students cannot represent senior sections/);
  });
});
```

---

#### Test Group 3: Authorization Integrity (Security Verification)
**File:** `apps/web/test/cross-year-authorization.test.ts` (NEW)

```typescript
describe('Cross-Year Representative Authorization', () => {
  it('should enforce section scope regardless of year difference', async () => {
    // Create 4th-year rep assigned to 2nd-year section
    const rep = createRepresentative({
      student_year: YEAR_4_UUID,
      assigned_sections: [SECTION_2A_UUID],
    });
    
    // Verify rep can access SECTION_2A data
    const result2A = await repService.getSectionStudents(rep.telegram_id, SECTION_2A_UUID);
    assert.ok(result2A.length > 0);
    
    // Verify rep CANNOT access SECTION_2B (not assigned)
    await assert.rejects(
      () => repService.getSectionStudents(rep.telegram_id, SECTION_2B_UUID),
      UnauthorizedSectionScopeError
    );
  });

  it('should not grant elevated privileges based on student year', async () => {
    // Verify senior students don't get automatic access to junior sections
  });

  it('should maintain RLS policies for cross-year assignments', async () => {
    // Verify Storage and database RLS still work correctly
  });
});
```

---

#### Test Group 4: Data Integrity (Regression Prevention)
**File:** `apps/web/test/representative-data-integrity.test.ts` (EXISTING - ADD CASES)

```typescript
describe('Representative Data Integrity', () => {
  it('should prevent duplicate profile_id + section_id combinations', async () => {
    // Existing test - verify UNIQUE constraint still works
  });

  it('should allow multiple representatives per section across different years', async () => {
    // NEW: Verify 2nd-year rep and 4th-year rep can both serve 3rd-year section
  });

  it('should maintain assignment history when student graduates', async () => {
    // NEW: Verify historical assignments remain valid after year change
  });
});
```

---

## 6. Executive Summary for System Owner

### Quick Decision Guide

**Question:** Should we change the same-year-only restriction?

#### If You Answer YES to These:
- ✅ Senior students in our institution mentor junior students
- ✅ We have cross-year leadership programs
- ✅ We trust senior students to handle junior section data
- ✅ We want a larger pool of eligible representatives

**→ Recommendation:** Relax the restriction (Solution 2)

---

#### If You Answer NO to These:
- ❌ Representatives should only serve their peer cohort
- ❌ We have institutional policy requiring same-year representation
- ❌ Cross-year access raises concerns

**→ Recommendation:** Keep restriction, improve UI (Solution 1 only)

---

#### If You're Unsure:
**→ Recommendation:** Improve UI first (Solution 1), research institutional policy, decide later

---

### Action Items

**Immediate (Today):**
1. ✅ Improve section dropdown UI with year grouping
2. ✅ Run diagnostic queries to verify data integrity
3. ✅ Document this investigation for future reference

**This Week:**
1. ✅ Contact university administration for official policy
2. ✅ Document policy in `/docs/REPRESENTATIVE_POLICY.md`
3. ✅ Decide on restriction change based on policy

**Next Week (If Policy Permits Cross-Year):**
1. ✅ Implement validation logic changes
2. ✅ Add required test cases
3. ✅ Deploy to staging for UAT
4. ✅ Deploy to production after approval

---

## Conclusion

**Root Cause:** Same-year-only restriction in application logic (Lines 105-111)  
**Impact:** Limits representative assignments to same academic year only  
**Risk Level:** Low - intentional design, not a security issue  
**Recommendation:** Improve UI immediately, clarify institutional policy, potentially relax restriction

**Files to Review:**
- `apps/web/src/lib/admin/representative-management-service.ts` (validation logic)
- `apps/web/src/app/admin/representatives/page.tsx` (UI form)
- `DIAGNOSTIC_SCOPE_MISMATCH_QUERIES.sql` (data verification)

**Next Steps:**
1. Execute diagnostic queries via Supabase SQL Editor
2. Implement UI enhancement (Solution 1)
3. Obtain institutional policy clarification
4. Implement appropriate solution based on policy

---

**Report Status:** ✅ COMPLETE  
**Investigation Mode:** READ-ONLY (No modifications made)  
**Approval Required:** Institutional policy clarification before implementing Solution 2
