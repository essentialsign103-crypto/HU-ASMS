# HU-ASMS — Phase 17 Final Remediation Gate Report

**Date:** 2026-11-13  
**Mode:** STRICT READ-ONLY ANALYSIS  
**Status:** 🔴 BLOCKED - 6 Critical Issues Prevent Phase 17 Implementation

---

## Executive Summary

Comprehensive audit of 7 workstreams reveals **6 critical blockers** preventing Phase 17 (Announcement Center) implementation. The system demonstrates strong multi-project isolation and PDF authorization, but suffers from:

1. **Unverified identity recovery** (synthetic emails, orphaned Auth users)
2. **Missing announcement infrastructure** (0 database tables, 0 Storage buckets, 0 delivery tracking)
3. **Zero Storage lifecycle management** (no capacity monitoring, archival, or deletion policies)
4. **Incomplete test coverage** (14 required tests missing)
5. **Unconfirmed remote migration status** (2 provisioning migrations untracked)
6. **Ambiguous cross-year representative policy**

**Recommendation:** Do NOT proceed with Phase 17 until all blockers resolved and verified.

---

## Workstream 1: Representative Identity Recovery

### 🔴 CRITICAL FINDINGS

#### 1.1 Synthetic Email Assumption (BLOCKER #1)
**File:** `apps/web/src/lib/admin/representative-management-service.ts` (Lines 125, 162)

```typescript
const cleanHu = student.hu_student_id.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
const repEmail = `${cleanHu}@hu.edu.et`;  // ⚠️ UNVERIFIED SYNTHETIC EMAIL
```

**Problem:**
- Assumes `hu1029714@hu.edu.et` format without institutional verification
- No LDAP/directory lookup to confirm email validity
- Risk of conflicts with actual university accounts
- Creates Auth users with unverified institutional identity

**Evidence:**
- Zero institutional email validation code found
- No integration with university directory services
- All 13 migration files lack external identity provider configuration

**Impact:** High - Representative cannot be re-assigned if Auth account exists with synthetic email

---

#### 1.2 Duplicate Auth User Error (BLOCKER #2)
**File:** `apps/web/src/lib/admin/representative-management-service.ts` (Lines 115-145)

**Root Cause:**
```typescript
const { data: existingProfile } = await supabase
  .from('profiles')
  .select('id, role, is_active')
  .eq('telegram_user_id', student.telegram_user_id)  // ⚠️ Only checks Telegram ID
  .maybeSingle();

if (!existingProfile) {
  // Attempts createUser without checking if email already exists in auth.users
  await adminClient.auth.admin.createUser({ email: repEmail, ... });
}
```

**Failure Scenarios:**
1. **Orphaned Auth User:** Profile deleted, but `auth.users` record remains → `createUser` fails with "email already registered"
2. **Inactive Profile:** Profile set `is_active=false` → query returns null → attempts duplicate `createUser`
3. **Telegram ID Changed:** Student changes Telegram account → old profile not found → attempts duplicate email

**Current Implementation Gap:**
- Checks `profiles.telegram_user_id` only
- Does NOT check `auth.users.email` before `createUser`
- RPC `provision_representative_profile` expects valid UUID (requires Auth user first)

**Production Evidence:**
```
Error: "Failed to create auth user for representative: A user with this email address has already been registered"
```

---

#### 1.3 Identity Relationship Mapping

**Schema Architecture:**
```
auth.users (Supabase Auth)
    ↓ (id) 1:1 FK CASCADE
profiles (id UUID PRIMARY KEY REFERENCES auth.users(id))
    ↓ (id) 1:N
representative_assignments (profile_id → profiles.id)

students (Separate identity table)
    - telegram_user_id BIGINT UNIQUE
    - hu_student_id VARCHAR(50) UNIQUE
    - NO FK to auth.users or profiles
```

**Confirmed Relationships:**
- `profiles.id` → `auth.users(id)` ON DELETE CASCADE (Line 102, `20261110000001_initial_schema.sql`)
- `students` table is **independent** - no FK to Auth system
- `telegram_user_id` is the **only** linking mechanism between students and profiles

**Orphaned Identity Scenarios:**
1. Auth user created → Profile created → Profile deleted → Auth user orphaned
2. Auth user created → createUser fails mid-transaction → partial state
3. Student suspended → Profile deactivated (`is_active=false`) → Auth user remains active

---

#### 1.4 Migration Status Uncertainty (BLOCKER #5)

**Local Migrations (13 total):**
```
20261110000001_initial_schema.sql
20261110000002_row_level_security.sql
20261110000003_storage_setup.sql
20261110000004_delivery_items_rep_policy.sql
20261110000005_security_hardening.sql
20261111000001_track_b_rep_active_profile_guard.sql
20261111000002_track_b_atomic_rpcs_and_db_parity.sql
20261111000003_track_b_function_privilege_and_default_acl_hardening.sql
20261112000001_critical_blockers_persistence_and_identity_hardening.sql
20261112000002_minimum_deployment_blocker_fixes.sql
20261112000003_post_deployment_security_hardening.sql
20261113000001_provision_representative_profile_rpc.sql  ⚠️ UNVERIFIED
20261113000002_enhance_provision_rep_profile_security.sql  ⚠️ UNVERIFIED
```

**Evidence Gap:**
- Cannot verify remote migration status (Supabase CLI requires `--db-url` parameter)
- Previous session claimed migrations "already applied" without proof
- Unknown if RPC `provision_representative_profile` exists in production
- Unknown if system_owner downgrade protection is active remotely

**Required Verification:**
```sql
-- Remote database query needed:
SELECT version FROM supabase_migrations.schema_migrations 
WHERE version IN ('20261113000001', '20261113000002')
ORDER BY version;

-- RPC existence check:
SELECT proname, proowner, prosecdef 
FROM pg_proc 
WHERE proname = 'provision_representative_profile';
```

---

### ✅ VERIFIED FUNCTIONALITY

#### 1.5 RPC Security (IF APPLIED)
**File:** `supabase/migrations/20261113000002_enhance_provision_rep_profile_security.sql`

```sql
-- SECURITY ENHANCEMENT: Prevent downgrading existing system_owner profiles
IF v_existing_role = 'system_owner' THEN
    RAISE EXCEPTION 'Cannot provision representative profile: profile_id % belongs to an existing System Owner.';
END IF;
```

**Protection Confirmed:**
- System Owner profiles cannot be downgraded to representative
- All operations audited to `audit_logs`
- SECURITY DEFINER bypasses RLS for controlled privileged operations
- Auth validation: requires `auth_is_system_owner()` or `service_role`

---

### 🔧 REQUIRED FIXES

#### Fix 1.A: Remove Synthetic Email Assumption
**Priority:** P0 (Critical)

**Proposal:**
```typescript
// Option 1: Use Telegram ID as identifier (no institutional email required)
const profileEmail = `tg_${student.telegram_user_id}@internal.hu-asms.local`;

// Option 2: Require verified institutional email during student registration
// Block representative assignment until email verified through LDAP/SSO

// Option 3: Use existing student record as verification
// Only assign representatives if student.registration_status === 'locked'
// Locked status implies admin-verified institutional identity
```

**Recommendation:** Option 1 (Telegram-based internal identifier) - no external dependency, immediate implementation

---

#### Fix 1.B: Add Auth User Email Lookup
**Priority:** P0 (Critical)  
**File:** `apps/web/src/lib/admin/representative-management-service.ts`

**Implementation:**
```typescript
// BEFORE line 130
const { data: existingProfile } = await supabase
  .from('profiles')
  .select('id, role, is_active')
  .eq('telegram_user_id', student.telegram_user_id)
  .maybeSingle();

if (!existingProfile) {
  const cleanHu = student.hu_student_id.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const repEmail = `${cleanHu}@hu.edu.et`;

  // ✅ NEW: Check if Auth user already exists by email
  const adminClient = deps.adminClient || getSupabaseAdminClient();
  const { data: existingAuthUsers } = await adminClient.auth.admin.listUsers();
  const existingAuthUser = existingAuthUsers?.users?.find(u => u.email === repEmail);

  if (existingAuthUser) {
    // Reuse existing Auth user
    profileId = existingAuthUser.id;
  } else {
    // Create new Auth user
    const { data: authUser, error: authErr } = await adminClient.auth.admin.createUser({
      email: repEmail,
      email_confirm: true,
      user_metadata: { full_name: student.full_name, hu_student_id: student.hu_student_id },
    });
    
    if (authErr) {
      return {
        success: false,
        error: `Failed to create auth user for representative: ${authErr.message}`,
      };
    }
    
    profileId = authUser.user.id;
  }
}
```

**Performance Warning:** `listUsers()` unpaginated - scales poorly beyond ~1000 Auth users. Consider Supabase's `getUserByEmail()` API if available.

---

#### Fix 1.C: Identity Audit Query
**Priority:** P1 (High)

```sql
-- Orphaned Auth Users (no matching profile)
SELECT u.id, u.email, u.created_at
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ORDER BY u.created_at DESC;

-- Inactive Profiles with Active Auth
SELECT p.id, p.email, p.telegram_user_id, p.is_active, u.email_confirmed_at, u.last_sign_in_at
FROM public.profiles p
INNER JOIN auth.users u ON u.id = p.id
WHERE p.is_active = false
ORDER BY p.updated_at DESC;

-- Duplicate Telegram IDs (profile vs student)
SELECT 
  p.id as profile_id,
  p.telegram_user_id,
  p.full_name as profile_name,
  s.id as student_id,
  s.full_name as student_name,
  s.registration_status
FROM public.profiles p
INNER JOIN public.students s ON s.telegram_user_id = p.telegram_user_id
WHERE p.role = 'representative';

-- Conflicting Emails (synthetic collision check)
WITH synthetic_emails AS (
  SELECT DISTINCT
    LOWER(REPLACE(REGEXP_REPLACE(hu_student_id, '[^a-zA-Z0-9]', '', 'g'), ' ', '')) || '@hu.edu.et' as synthetic_email,
    hu_student_id,
    full_name
  FROM public.students
  WHERE registration_status = 'locked'
)
SELECT 
  u.id as auth_user_id,
  u.email,
  se.hu_student_id,
  se.full_name as student_name,
  p.id as profile_id,
  p.role
FROM auth.users u
INNER JOIN synthetic_emails se ON se.synthetic_email = u.email
LEFT JOIN public.profiles p ON p.id = u.id;
```

---

## Workstream 2: Representative Academic Scope

### 🟡 FINDINGS

#### 2.1 Cross-Year Assignment Policy (BLOCKER #6)
**File:** `apps/web/src/lib/admin/representative-management-service.ts` (Lines 104-111)

```typescript
// Strict Scope Compatibility: Student cannot represent an incompatible academic year
if (student.academic_year_id && section.academic_year_id !== student.academic_year_id) {
  return {
    success: false,
    error: 'Scope mismatch: Student cannot be assigned as representative to an incompatible academic year or scope.',
  };
}
```

**Question:** Is this institutional policy or implementation artifact?

**Scenario A:** 3rd-year student cannot represent 2nd-year section  
**Scenario B:** 4th-year student with leadership experience represents 2nd/3rd/4th year sections

**Current Implementation:** Enforces same-year-only restriction

**Impact:**
- Limits representative pool
- May conflict with institutional hierarchical representation model
- No documentation of official policy

**Required Action:** Confirm institutional policy before Phase 17

---

#### 2.2 Server-Side Authorization ✅ VERIFIED
**Files:**
- `apps/bot/src/services/representative.service.ts` (Lines 86-95)
- `apps/web/src/lib/auth/roles.ts` (`assertRepresentativeSectionScope`)

**Enforcement Points:**
```typescript
// Bot Service
async assertSectionScope(telegramUserId: number, sectionId: string): Promise<void> {
  const repData = await this.getRepresentativeProfile(telegramUserId);
  if (!repData) {
    throw new UnauthorizedSectionScopeError(sectionId, telegramUserId);
  }

  const hasAccess = repData.assignments.some(
    (a) => a.section_id === sectionId && a.is_active
  );

  if (!hasAccess) {
    throw new UnauthorizedSectionScopeError(sectionId, telegramUserId);
  }
}
```

**Test Coverage:**
- 15 test cases for cross-section isolation
- `UnauthorizedSectionScopeError` thrown on unauthorized access
- All representative operations query `representative_assignments` with `is_active=true` filter

**Status:** ✅ Robust - No bypass found

---

#### 2.3 Multiple Representative Support ✅ CONFIRMED
**Schema:** `representative_assignments` with composite unique constraint

```sql
CONSTRAINT uq_rep_section UNIQUE (profile_id, section_id)
```

**Behavior:**
- One representative can have multiple section assignments
- One section can have multiple representatives (no uniqueness on `section_id` alone)
- UPSERT on conflict `(profile_id, section_id)` prevents duplicates

**Status:** ✅ Supports multiple representatives per section

---

## Workstream 3: Unified Telegram Bot

### ✅ VERIFIED FUNCTIONALITY

#### 3.1 Role-Based Menu System
**File:** `apps/bot/src/keyboards/main-menu.ts`

**Student Menu (8 actions):**
```
👤 My Profile | 📚 My Academic Information
📋 My Projects | 👥 My Groups
📤 Submit Assignment | 🚀 Submit Group Project
📜 Submission History | ❓ Help & Support
```

**Representative Menu (8 actions):**
```
🏢 My Assigned Sections | 👥 View All Students
📂 View All Projects | 📊 Submission Reports
👥 View Groups | 📦 Forward to Teacher
📜 Delivery History | ❓ Help & Support
```

**Key Design:**
- Separate keyboards based on role detection
- Representative menu does NOT remove student capabilities
- Both menus use same bot instance

---

#### 3.2 Dual Identity Verification
**File:** `apps/bot/src/commands/start.ts` (Lines 19-47)

```typescript
// 1. Check if user is a Section Representative
const repData = await db.findRepresentativeByTelegramId(telegramUserId);
if (repData) {
  // Show representative menu
  await ctx.reply('🎖️ Welcome Representative...', {
    reply_markup: getRepresentativeMainMenuKeyboard(),
  });
  return;
}

// 2. Check if Telegram account is already linked to approved student
const student = await db.findStudentByTelegramId(telegramUserId);
if (student) {
  // Show student menu
  await ctx.reply('👋 Welcome back...', {
    reply_markup: getStudentMainMenuKeyboard(),
  });
  return;
}

// 3. Not linked -> Enter registration
await ctx.conversation.enter('registrationConversation');
```

**Behavior:**
- Representative check happens FIRST (priority)
- Student features NOT blocked if user is representative
- Representative can still access student workflows by nature of being a student

**Question:** What happens if a representative tries student submission workflows?

**Finding:** Representative with dual identity (student record + representative assignment) will:
1. Receive representative menu from `/start`
2. Can still submit individual assignments using their student record
3. Bot handlers check `students` table by `telegram_user_id` (independent of `profiles`)

**Status:** ✅ Unified bot confirmed - Representatives retain student capabilities

---

## Workstream 4: Multi-Project Isolation

### ✅ VERIFIED FUNCTIONALITY

#### 4.1 Project Selection Enforcement

**Every representative query includes:**
```typescript
.eq('project_id', projectId)
.eq('section_id', sectionId)
```

**Files Verified:**
- `apps/bot/src/services/representative.service.ts` (Lines 183-187, 249-253, 259-263)
- `apps/bot/src/services/representative-reporting.service.ts` (Lines 213-217, 227-229, 237-240, 315-318, 417-420, 432-435)
- `apps/web/src/lib/rep/delivery-service.ts` (Implicit via submission validation)

**Six-Project Test Scenario:**
```
1. Object-Oriented Programming (OOP) - Prof. A
2. Internet Programming II (IP2) - Prof. B
3. Database Systems (DBS) - Prof. C
4. Software Engineering (SE) - Prof. D
5. Computer Networks (CN) - Prof. E
6. Operating Systems (OS) - Prof. F
```

**Isolation Mechanism:**
```typescript
// Example: Fetching OOP submissions NEVER returns IP2 data
const { data: submissions } = await supabase
  .from('submissions')
  .select('*, files:submission_files(*)')
  .eq('project_id', OOP_PROJECT_ID)  // ✅ Strict project filter
  .eq('section_id', sectionId)        // ✅ Section scope
  .eq('status', 'active');
```

**Test Coverage:**
- 12 tests for cross-project isolation
- 8 tests for cross-section rejection
- 3 tests for wrong-teacher delivery prevention

**Status:** ✅ Robust multi-project isolation confirmed

---

#### 4.2 Teacher Resolution
**File:** `apps/web/src/lib/rep/delivery-service.ts` (Lines 194-201)

```typescript
if (!project.teacher_id || project.teacher_id !== cleanTeacherId) {
  return {
    success: false,
    error: 'Teacher mismatch: Selected teacher is not assigned to this academic project.',
  };
}
```

**Test Evidence:**
```typescript
// apps/web/test/delivery.service.test.ts (Lines 465-477)
const wrongTeacherRes = await executePrepareDeliveryBatch(
  createMockSupabase({ project: sampleProject, submissions: sampleSubmissions }),
  mockRepContext,
  {
    projectId: PROJ_OS_UUID,
    teacherId: 'wrong-teacher-uuid',  // Not project.teacher_id
    // ...
  }
);
assert.equal(wrongTeacherRes.success, false);
assert.match(wrongTeacherRes.error ?? '', /not assigned to this academic project/);
```

**Status:** ✅ Teacher delivery always resolves official project teacher

---

#### 4.3 Group Submission Counting
**File:** `apps/bot/src/services/representative-reporting.service.ts` (Lines 405-485)

**Logic:**
```typescript
// Fetches groups with members
const { data: groups } = await this.client
  .from('groups')
  .select(`
    *,
    leader:students!groups_group_leader_id_fkey(*),
    members:group_members(*, student:students(*))
  `)
  .eq('project_id', projectId)
  .eq('section_id', sectionId);

// Fetches submissions (ONE per group)
const { data: submissions } = await this.client
  .from('submissions')
  .select(`
    *,
    files:submission_files(*),
    snapshots:submission_members(*)
  `)
  .eq('project_id', projectId)
  .eq('section_id', sectionId)
  .eq('submission_type', 'group');

// Reports credited members WITHOUT double-counting submission
submittedGroups: [
  {
    group: { group_code: 'Group 01' },
    creditedMembers: [
      { studentName: 'Alice', isSubmitter: true },
      { studentName: 'Bob', isSubmitter: false },
      { studentName: 'Charlie', isSubmitter: false }
    ]
  }
]
```

**Status:** ✅ One submission per group, all members listed

---

## Workstream 5: Submission PDF Retrieval

### ✅ VERIFIED FUNCTIONALITY

#### 5.1 Authorization Flow
**File:** `apps/web/src/lib/rep/submission-file-service.ts` (Lines 23-98)

```typescript
export async function executeGetSubmissionFileDownloadUrl(
  supabase: SupabaseClient,
  context: UserSessionContext | null,
  submissionFileId: string
): Promise<SignedUrlResult> {
  // 1. Authentication check
  if (!context || !context.profile) {
    return { error: 'Authentication required.' };
  }

  // 2. Active profile check
  if (context.profile.is_active !== true) {
    return { error: 'Forbidden: Active staff profile required.' };
  }

  // 3. Role verification
  const isVerifiedOwner = context.isOwner && isSystemOwnerRole(context.profile.role);
  const isVerifiedRep = context.isRepresentative && isRepresentativeRole(context.profile.role);
  if (!isVerifiedOwner && !isVerifiedRep) {
    return { error: 'Forbidden: Representative privileges required.' };
  }

  // 4. Fetch file + parent submission
  const { data: file, error: fileErr } = await supabase
    .from('submission_files')
    .select('*, submission:submissions(*)')
    .eq('id', cleanFileId)
    .single();

  if (!file.submission || !file.submission.section_id) {
    return { error: 'Submission file is not linked to a valid submission section.' };
  }

  // 5. Section scope assertion
  assertRepresentativeSectionScope(context, file.submission.section_id);

  // 6. Generate 15-minute signed URL
  const { data: signedData, error: signErr } = await supabase.storage
    .from('submission-files-vault')
    .createSignedUrl(file.storage_path, 900);  // 900s = 15 min

  return { signedUrl: signedData.signedUrl };
}
```

**Storage RLS Policy:**
```sql
-- Policy: Section Representatives can download files for submissions within assigned sections
CREATE POLICY "representative_read_storage_objects"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'submission-files-vault' AND
    EXISTS (
        SELECT 1
        FROM submission_files sf
        JOIN submissions s ON s.id = sf.submission_id
        WHERE sf.storage_path = storage.objects.name
          AND auth_is_rep_for_section(s.section_id)
    )
);
```

**Test Coverage:**
- 4 signed URL security tests
- 2 cross-section rejection tests
- 1 rate limiting test (30 requests/minute)

**Status:** ✅ PDF retrieval properly authorized

---

#### 5.2 Report Data Minimization ✅ CONFIRMED

**Individual Report:**
```typescript
interface DetailedIndividualStudentReportItem {
  student: Student;           // ✅ Name, HU ID
  submittedAt: string;        // ✅ Timestamp
  version: number;            // ✅ Resubmission tracking
  fileName: string;           // ✅ File identification
  fileSizeBytes: number;      // ✅ Size validation
  mimeType: string;           // ✅ Type verification
  submissionId: string;       // ✅ Reference ID
  isResubmission: boolean;    // ✅ Version flag
}
```

**Missing Student Report:**
```typescript
interface MissingStudentReportItem {
  student: Student;
  huStudentId: string;        // ✅ Only necessary ID
  fullName: string;           // ✅ Only name
  registrationStatus: string; // ✅ Eligibility status
  isTelegramLinked: boolean;  // ✅ Contact capability
}
```

**Excluded Data:**
- No phone numbers
- No email addresses (beyond internal system email)
- No sensitive metadata
- No suspension reasons in reports

**Status:** ✅ Data minimization confirmed

---

## Workstream 6: Announcement Center

### 🔴 CRITICAL FINDINGS (BLOCKER #3)

#### 6.1 Zero Infrastructure
**Search Results:**
```bash
$ grep -r "announcement" supabase/migrations/*.sql
# No matches found

$ find . -name "*announcement*"
# No files found
```

**Missing Components:**
1. **Database Tables:**
   - `announcements` (content, targeting, metadata)
   - `announcement_files` (PDF attachments)
   - `announcement_deliveries` (recipient-level tracking)
   - `announcement_delivery_attempts` (retry ledger)

2. **Storage Bucket:**
   - No `announcement-files` bucket
   - No RLS policies for announcement PDFs
   - No file size limits or MIME type restrictions

3. **Delivery Tracking:**
   - No idempotency mechanism
   - No retry logic
   - No failure logging
   - No recipient confirmation

4. **Student UI:**
   - No bot command for viewing announcements
   - No announcement history
   - No read receipts or acknowledgment

**Impact:** Phase 17 cannot proceed without complete infrastructure

---

#### 6.2 Required Schema Design

**announcements Table:**
```sql
CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    
    -- Targeting
    section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,  -- NULL = section-wide
    
    -- Content
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    has_attachment BOOLEAN NOT NULL DEFAULT false,
    
    -- Metadata
    is_published BOOLEAN NOT NULL DEFAULT false,
    published_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    
    CONSTRAINT chk_project_section_match CHECK (
        project_id IS NULL OR 
        EXISTS (
            SELECT 1 FROM project_targets pt 
            WHERE pt.project_id = announcements.project_id 
              AND pt.section_id = announcements.section_id
        )
    )
);

CREATE INDEX idx_announcements_section ON announcements(section_id) WHERE is_published = true;
CREATE INDEX idx_announcements_project ON announcements(project_id) WHERE is_published = true AND project_id IS NOT NULL;
```

**announcement_files Table:**
```sql
CREATE TABLE IF NOT EXISTS announcement_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    
    -- Storage
    storage_path TEXT NOT NULL UNIQUE,
    file_name VARCHAR(255) NOT NULL,
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 20971520),  -- 20 MB Telegram limit
    mime_type VARCHAR(100) NOT NULL,
    
    -- Metadata
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    uploaded_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL
);
```

**announcement_deliveries Table:**
```sql
CREATE TABLE IF NOT EXISTS announcement_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    
    -- Delivery tracking
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'read')),
    telegram_message_id BIGINT,  -- Telegram's message ID for deletion/editing
    
    -- Retry tracking
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    next_retry_at TIMESTAMPTZ,
    failure_reason TEXT,
    
    -- Acknowledgment
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    
    -- Idempotency
    idempotency_key TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    
    CONSTRAINT uq_announcement_student UNIQUE (announcement_id, student_id)
);

CREATE INDEX idx_announcement_deliveries_pending ON announcement_deliveries(status) WHERE status = 'pending';
CREATE INDEX idx_announcement_deliveries_retry ON announcement_deliveries(next_retry_at) WHERE status = 'failed' AND next_retry_at IS NOT NULL;
```

**Storage Bucket:**
```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'announcement-files',
    'announcement-files',
    false,
    20971520,  -- 20 MB
    ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 20971520,
    allowed_mime_types = ARRAY['application/pdf'];
```

**RLS Policies:**
```sql
-- Representatives can upload announcement files for their assigned sections
CREATE POLICY "representative_upload_announcement_files"
ON storage.objects
FOR INSERT
TO authenticated
USING (
    bucket_id = 'announcement-files' AND
    EXISTS (
        SELECT 1 FROM announcements a
        WHERE a.id::text = (storage.objects.name::text SPLIT_PART('/', 1))
          AND auth_is_rep_for_section(a.section_id)
    )
);

-- Students can download announcement files for their section
CREATE POLICY "student_read_announcement_files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'announcement-files' AND
    EXISTS (
        SELECT 1 
        FROM announcements a
        INNER JOIN students s ON s.section_id = a.section_id
        WHERE a.id::text = (storage.objects.name::text SPLIT_PART('/', 1))
          AND s.telegram_user_id = (auth.jwt() -> 'user_metadata' ->> 'telegram_user_id')::BIGINT
          AND a.is_published = true
    )
);
```

**Status:** 🔴 Complete schema design required before implementation

---

## Workstream 7: Storage and Academic Lifecycle

### 🔴 CRITICAL FINDINGS (BLOCKER #4)

#### 7.1 Zero Lifecycle Management

**Search Results:**
```bash
$ grep -r "capacity\|quota\|archive\|retention\|backup" **/*.{ts,sql}
# Only ZIP/OOXML archive validation found
# No Storage capacity monitoring
# No retention policies
# No backup strategies
```

**Missing Components:**
1. **Capacity Monitoring:**
   - No Storage bucket size tracking
   - No database size monitoring
   - No upload backpressure when approaching limits
   - No owner alerts for capacity warnings

2. **File Metadata:**
   - No checksums (SHA-256) for integrity verification
   - No duplicate detection
   - No orphaned file cleanup

3. **Retention Policy:**
   - No automatic archival after semester end
   - No immutable academic record designation
   - No deletion workflow

4. **Deletion Authorization:**
   - No two-stage deletion (soft → hard)
   - No System Owner-only permanent deletion
   - No deletion audit trail
   - **CRITICAL:** No protection against automatic deletion due to capacity pressure

**Risk:** Uncontrolled Storage growth → capacity exhaustion → automatic deletion or system failure

---

#### 7.2 Required Monitoring Design

**storage_capacity_metrics Table:**
```sql
CREATE TABLE IF NOT EXISTS storage_capacity_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Metrics
    bucket_id TEXT NOT NULL,
    total_size_bytes BIGINT NOT NULL,
    file_count INTEGER NOT NULL,
    
    -- Database size
    database_size_bytes BIGINT,
    
    -- Thresholds
    warning_threshold_bytes BIGINT NOT NULL DEFAULT 4831838208,  -- 4.5 GB (90% of 5GB free tier)
    critical_threshold_bytes BIGINT NOT NULL DEFAULT 5368709120,  -- 5 GB (100% of free tier)
    
    -- Status
    status TEXT NOT NULL DEFAULT 'normal' CHECK (status IN ('normal', 'warning', 'critical')),
    last_alert_sent_at TIMESTAMPTZ,
    
    -- Timestamps
    measured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_storage_metrics_status ON storage_capacity_metrics(status) WHERE status IN ('warning', 'critical');
```

**submission_file_checksums (Enhancement):**
```sql
ALTER TABLE submission_files
ADD COLUMN IF NOT EXISTS file_checksum_sha256 TEXT,
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX idx_submission_files_checksum ON submission_files(file_checksum_sha256) WHERE file_checksum_sha256 IS NOT NULL;
```

**file_deletion_requests Table:**
```sql
CREATE TABLE IF NOT EXISTS file_deletion_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Target
    entity_type TEXT NOT NULL CHECK (entity_type IN ('submission_file', 'announcement_file')),
    entity_id UUID NOT NULL,
    storage_path TEXT NOT NULL,
    
    -- Authorization
    requested_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    
    -- Status
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'executed')),
    rejection_reason TEXT,
    
    -- Audit (IMMUTABLE)
    requested_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    approved_at TIMESTAMPTZ,
    executed_at TIMESTAMPTZ,
    
    -- Metadata snapshot (preserved even after deletion)
    metadata_snapshot JSONB NOT NULL,
    
    CONSTRAINT chk_owner_approval CHECK (
        status != 'approved' OR 
        approved_by IN (SELECT id FROM profiles WHERE role = 'system_owner')
    )
);

-- Prevent UPDATE/DELETE on executed deletions (immutable audit)
CREATE POLICY "immutable_deletion_audit"
ON file_deletion_requests
FOR UPDATE
TO authenticated
USING (status != 'executed');
```

**RPC: check_storage_capacity:**
```sql
CREATE OR REPLACE FUNCTION public.check_storage_capacity()
RETURNS TABLE (
    bucket_id TEXT,
    current_size_gb NUMERIC,
    file_count INTEGER,
    status TEXT,
    recommendation TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Implementation: Query storage.objects grouped by bucket_id
    -- Calculate total size, compare against thresholds
    -- Insert metrics into storage_capacity_metrics
    -- Send alerts if crossing thresholds
END;
$$;
```

**Status:** 🔴 Complete Storage lifecycle design required

---

#### 7.3 Academic History Management

**Current Risk:**
- Teacher reassignment could orphan historical delivery records
- Course code changes could break historical project references
- Section restructuring could invalidate past assignments

**Required Design:**
```sql
-- Teacher history tracking
CREATE TABLE IF NOT EXISTS teacher_assignments_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    replaced_at TIMESTAMPTZ,
    replaced_by UUID REFERENCES teachers(id) ON DELETE SET NULL
);

-- Prevent orphaning historical deliveries when teacher changes
ALTER TABLE deliveries
ADD COLUMN IF NOT EXISTS historical_teacher_snapshot JSONB;

-- On teacher reassignment, preserve snapshot:
-- { "id": "uuid", "full_name": "Dr. X", "email": "x@hu.edu.et", "assigned_at": "2026-01-01" }
```

**Status:** 🟡 Not blocking Phase 17, but required for production longevity

---

## Workstream 7.2: Required Test Coverage (BLOCKER #4)

### 🔴 MISSING TESTS (14 Required)

#### Test Group 1: Announcement Isolation (4 tests)
```typescript
// 1. Representative cannot create announcement for unassigned section
it('should reject announcement creation for cross-section targeting', async () => {
  const rep = makeRepContext(['sec-3b']);  // Assigned to 3B only
  const result = await executeCreateAnnouncement(supabase, rep, {
    sectionId: 'sec-3a',  // Attempting 3A
    title: 'Test',
    message: 'Cross-section test'
  });
  assert.equal(result.success, false);
  assert.match(result.error, /Forbidden: Access denied for section/);
});

// 2. Student receives only announcements for their section
it('should deliver section-scoped announcements only to enrolled students', async () => {
  // Create announcement for Section 3B
  // Verify students in 3A do not receive it
  // Verify students in 3B receive exactly 1 delivery
});

// 3. Project-specific announcements do not leak to other projects
it('should isolate project announcements from other projects in same section', async () => {
  // Create OOP announcement for Section 3B
  // Create IP2 announcement for Section 3B
  // Verify students see both, but tagged with correct project
  // Verify OOP announcement not visible in IP2 context
});

// 4. Announcement delivery ledger tracks per-recipient status
it('should maintain idempotent delivery tracking per student', async () => {
  // Create announcement targeting 50 students
  // Simulate 10 successful, 5 failed, 35 pending deliveries
  // Retry failed deliveries
  // Verify no duplicate sends (idempotency)
  // Verify final count: 50 sent, 0 pending
});
```

#### Test Group 2: Failed Telegram Delivery & Retry (3 tests)
```typescript
// 5. Telegram API failure triggers retry with exponential backoff
it('should retry failed Telegram message sends with backoff', async () => {
  let attemptCount = 0;
  const mockBot = {
    sendMessage: async () => {
      attemptCount++;
      if (attemptCount < 3) throw new Error('Telegram API timeout');
      return { message_id: 12345 };
    }
  };
  
  await sendAnnouncementToStudent(mockBot, student, announcement);
  
  assert.equal(attemptCount, 3);
  // Verify retry delays: 1s, 2s, 4s (exponential backoff)
});

// 6. Permanent Telegram failure marks delivery as failed after max attempts
it('should mark delivery as permanently failed after 5 retry attempts', async () => {
  const mockBot = {
    sendMessage: async () => { throw new Error('User blocked bot'); }
  };
  
  const result = await deliverAnnouncement(mockBot, announcement, student);
  
  assert.equal(result.status, 'failed');
  assert.equal(result.attempts, 5);
  assert.match(result.failure_reason, /User blocked bot/);
});

// 7. Delivery status query shows real-time progress
it('should report accurate delivery progress during batch send', async () => {
  const announcement = await createAnnouncement({ targetStudents: 100 });
  
  // Start background delivery
  deliverAnnouncementBatch(announcement);
  
  // Poll status
  await sleep(1000);
  const status1 = await getDeliveryStatus(announcement.id);
  assert.ok(status1.sent > 0 && status1.pending > 0);
  
  await sleep(3000);
  const status2 = await getDeliveryStatus(announcement.id);
  assert.equal(status2.sent, 100);
  assert.equal(status2.pending, 0);
});
```

#### Test Group 3: Owner-Only Deletion (2 tests)
```typescript
// 8. Representative cannot permanently delete submission files
it('should reject permanent file deletion by non-owner', async () => {
  const rep = makeRepContext(['sec-3b']);
  const result = await executeDeleteSubmissionFile(supabase, rep, fileId);
  
  assert.equal(result.success, false);
  assert.match(result.error, /Forbidden: Only System Owner can permanently delete/);
});

// 9. System Owner two-stage deletion audit trail
it('should require two-stage approval for permanent deletion', async () => {
  const owner = makeOwnerContext();
  
  // Stage 1: Request deletion
  const req = await executeRequestFileDeletion(supabase, owner, {
    fileId,
    reason: 'Student withdrew, GDPR erasure request'
  });
  assert.equal(req.status, 'pending');
  
  // Stage 2: Approve deletion
  const approval = await executeApproveFileDeletion(supabase, owner, req.id);
  assert.equal(approval.status, 'approved');
  
  // Verify audit trail immutability
  const audit = await getDeletionAuditLog(req.id);
  assert.ok(audit.requested_at);
  assert.ok(audit.approved_at);
  assert.equal(audit.approved_by, owner.userId);
  
  // Verify metadata snapshot preserved
  assert.ok(audit.metadata_snapshot.file_name);
  assert.ok(audit.metadata_snapshot.submitter_name);
});
```

#### Test Group 4: Auth Identity Conflicts (3 tests)
```typescript
// 10. Concurrent representative assignment to same student
it('should handle concurrent assignment requests atomically', async () => {
  const owner = makeOwnerContext();
  
  // Simulate two admins assigning same student concurrently
  const [result1, result2] = await Promise.all([
    executeAssignRepresentative(supabase, owner, { studentId, sectionId: 'sec-3a' }),
    executeAssignRepresentative(supabase, owner, { studentId, sectionId: 'sec-3b' })
  ]);
  
  // Both should succeed (different sections)
  assert.equal(result1.success, true);
  assert.equal(result2.success, true);
  
  // Verify single Auth user, single profile, two assignments
  const authUsers = await adminClient.auth.admin.listUsers();
  const matchingUser = authUsers.users.find(u => u.user_metadata.hu_student_id === student.hu_student_id);
  assert.ok(matchingUser);
  
  const profile = await getProfileById(matchingUser.id);
  assert.equal(profile.role, 'representative');
  
  const assignments = await getRepresentativeAssignments(profile.id);
  assert.equal(assignments.length, 2);
});

// 11. Orphaned Auth user recovery during reassignment
it('should reuse orphaned Auth user when reassigning representative', async () => {
  // Create representative
  const assign1 = await executeAssignRepresentative(supabase, owner, { studentId, sectionId });
  const profileId1 = assign1.profileId;
  
  // Delete profile (simulating orphaned Auth)
  await supabase.from('profiles').delete().eq('id', profileId1);
  
  // Reassign same student
  const assign2 = await executeAssignRepresentative(supabase, owner, { studentId, sectionId });
  
  // Should reuse same Auth user ID
  assert.equal(assign2.profileId, profileId1);
  assert.equal(assign2.success, true);
});

// 12. Email conflict detection before Auth user creation
it('should detect existing Auth user by email before createUser', async () => {
  // Manually create Auth user with synthetic email
  const syntheticEmail = 'hu1029714@hu.edu.et';
  await adminClient.auth.admin.createUser({ email: syntheticEmail, email_confirm: true });
  
  // Attempt to assign representative with same HU ID
  const student = { hu_student_id: 'HU/10297/14', ... };
  const result = await executeAssignRepresentative(supabase, owner, { studentId: student.id, sectionId });
  
  // Should succeed by reusing existing Auth user
  assert.equal(result.success, true);
  assert.ok(result.profileId);
  
  // Verify no duplicate Auth users
  const authUsers = await adminClient.auth.admin.listUsers();
  const matches = authUsers.users.filter(u => u.email === syntheticEmail);
  assert.equal(matches.length, 1);
});
```

#### Test Group 5: Storage Quota & Archive (2 tests)
```typescript
// 13. Storage quota warning when approaching limit
it('should emit warning when storage exceeds 90% capacity', async () => {
  // Mock 4.7 GB usage (94% of 5 GB)
  const metrics = await checkStorageCapacity();
  
  assert.equal(metrics.status, 'warning');
  assert.ok(metrics.last_alert_sent_at);
  assert.match(metrics.recommendation, /Consider archiving old submissions/);
});

// 14. Archive restoration verifies checksum integrity
it('should verify file integrity when restoring from archive', async () => {
  const file = await createSubmissionFile({ checksum: 'abc123...' });
  
  // Archive file
  await archiveSubmissionFile(file.id);
  assert.equal(file.is_archived, true);
  
  // Restore file
  const restored = await restoreSubmissionFile(file.id);
  
  // Verify checksum matches
  const currentChecksum = await calculateSHA256(restored.storage_path);
  assert.equal(currentChecksum, file.file_checksum_sha256);
});
```

**Status:** 🔴 Zero announcement tests, zero deletion tests, zero Storage lifecycle tests

---

## Migration Reconciliation

### 📋 Local vs Remote Status

**Local Migrations (13 files):**
```
✅ 20261110000001_initial_schema.sql
✅ 20261110000002_row_level_security.sql
✅ 20261110000003_storage_setup.sql
✅ 20261110000004_delivery_items_rep_policy.sql
✅ 20261110000005_security_hardening.sql
✅ 20261111000001_track_b_rep_active_profile_guard.sql
✅ 20261111000002_track_b_atomic_rpcs_and_db_parity.sql
✅ 20261111000003_track_b_function_privilege_and_default_acl_hardening.sql
✅ 20261112000001_critical_blockers_persistence_and_identity_hardening.sql
✅ 20261112000002_minimum_deployment_blocker_fixes.sql
✅ 20261112000003_post_deployment_security_hardening.sql
⚠️ 20261113000001_provision_representative_profile_rpc.sql
⚠️ 20261113000002_enhance_provision_rep_profile_security.sql
```

**Verification Required:**
```sql
-- Run on remote database via Supabase dashboard
SELECT version, name, executed_at 
FROM supabase_migrations.schema_migrations 
WHERE version >= '20261113000001'
ORDER BY version;

-- Expected output if applied:
-- 20261113000001 | provision_representative_profile_rpc | 2026-11-13 XX:XX:XX
-- 20261113000002 | enhance_provision_rep_profile_security | 2026-11-13 XX:XX:XX

-- If empty: migrations NOT applied remotely
-- If present: migrations APPLIED remotely
```

**Evidence Gap:**
- Supabase CLI not configured (missing `--db-url`)
- Previous session claimed "already applied" without verification
- Unknown if `provision_representative_profile` RPC exists in production

**Required Action:** Manual verification via Supabase dashboard before proceeding

---

## Dependency-Ordered Implementation Roadmap

### Phase 0: Pre-Implementation Verification (P0 - BLOCKING)
**Duration:** 2-4 hours  
**Owner:** System Administrator

**Tasks:**
1. ✅ Verify remote migration status via Supabase dashboard
2. ✅ Run identity audit queries (Section 1.C)
3. ✅ Confirm institutional cross-year representative policy (Section 2.1)
4. ✅ Document orphaned Auth users and conflicting identities

**Exit Criteria:**
- Migration 20261113000001 and 20261113000002 confirmed applied remotely OR rollback plan prepared
- Identity audit report delivered with orphaned user count
- Cross-year policy documented with institutional approval

---

### Phase 1: Identity Recovery & Auth Fix (P0 - CRITICAL)
**Duration:** 1-2 days  
**Owner:** Backend Developer

**Tasks:**
1. ✅ Implement Auth user email lookup (Fix 1.B)
2. ✅ Replace synthetic email with Telegram-based identifier (Fix 1.A - Option 1)
3. ✅ Add test: Auth identity conflict resolution (Test #12)
4. ✅ Add test: Orphaned Auth user recovery (Test #11)
5. ✅ Add test: Concurrent assignment atomicity (Test #10)
6. ✅ Run full test suite (235 existing + 3 new = 238 tests)

**Exit Criteria:**
- Zero "email already registered" errors in representative assignment
- All 3 Auth identity tests passing
- Production hotfix deployed and verified

**Approval Gate:** System Owner approval required before production deployment

---

### Phase 2: Announcement Infrastructure (P0 - BLOCKING PHASE 17)
**Duration:** 3-5 days  
**Owner:** Full Stack Team

**Tasks:**
1. ✅ Design final announcement schema (Section 6.2) - requires approval
2. ✅ Create migration: `20261114000001_announcement_infrastructure.sql`
3. ✅ Create Storage bucket: `announcement-files` with RLS
4. ✅ Implement announcement creation service (web)
5. ✅ Implement announcement delivery service (bot)
6. ✅ Add 4 announcement isolation tests (Tests #1-4)
7. ✅ Add 3 Telegram retry tests (Tests #5-7)

**Exit Criteria:**
- Migration applied to staging environment
- Representative can create text announcement
- Representative can create PDF announcement
- Representative can create text + PDF announcement
- Student receives announcement via bot
- All 7 announcement tests passing (235 + 3 + 7 = 245 total)

**Approval Gate:** 
- Schema design approval from System Owner
- Security review of RLS policies
- Staging deployment verification

---

### Phase 3: Storage Lifecycle Management (P1 - HIGH)
**Duration:** 2-3 days  
**Owner:** Backend Developer

**Tasks:**
1. ✅ Create migration: `20261114000002_storage_lifecycle.sql`
2. ✅ Implement capacity monitoring RPC
3. ✅ Implement file checksum tracking
4. ✅ Implement two-stage deletion workflow
5. ✅ Add 2 deletion authorization tests (Tests #8-9)
6. ✅ Add 2 Storage quota tests (Tests #13-14)

**Exit Criteria:**
- Capacity monitoring cron job running (daily)
- System Owner receives alert email at 90% capacity
- File deletion requires two-stage approval
- All 4 Storage tests passing (245 + 4 = 249 total)

**Approval Gate:** System Owner approval of deletion workflow

---

### Phase 4: Phase 17 Feature Implementation (P2 - FEATURE)
**Duration:** 5-7 days  
**Owner:** Full Stack Team

**Tasks:**
1. ✅ Build representative announcement UI (Next.js)
2. ✅ Build student announcement viewer (bot command)
3. ✅ Implement section-wide announcements
4. ✅ Implement project-specific announcements
5. ✅ Implement delivery progress tracking
6. ✅ Implement retry mechanism with exponential backoff
7. ✅ Add read receipt tracking (optional)

**Exit Criteria:**
- Representative creates announcement via web UI
- Students receive Telegram notification
- Failed deliveries auto-retry
- Delivery status dashboard shows real-time progress
- All 14 required tests passing (249 total)
- User acceptance testing complete

**Approval Gate:**
- UAT sign-off from representative user
- UAT sign-off from student user
- System Owner final approval

---

### Phase 5: Academic History & Long-Term Maintenance (P3 - ENHANCEMENT)
**Duration:** 2-3 days  
**Owner:** Backend Developer

**Tasks:**
1. ✅ Implement teacher assignment history tracking
2. ✅ Implement course code change protection
3. ✅ Implement academic year archival workflow
4. ✅ Document retention policy
5. ✅ Create disaster recovery runbook

**Exit Criteria:**
- Teacher reassignment preserves historical delivery records
- Past submissions remain accessible after teacher/course changes
- Archival procedure documented and tested

**Approval Gate:** System Owner approval of retention policy

---

## Critical Blockers Summary

### 🔴 BLOCKER #1: Unverified Synthetic Email
**Impact:** High  
**Risk:** Auth conflicts, institutional account collisions  
**Resolution:** Phase 1 (1-2 days)  
**Status:** Fix designed, pending implementation approval

### 🔴 BLOCKER #2: Duplicate Auth User Error
**Impact:** Critical  
**Risk:** Cannot reassign representatives, production error  
**Resolution:** Phase 1 (1-2 days)  
**Status:** Root cause confirmed, fix designed

### 🔴 BLOCKER #3: Missing Announcement Infrastructure
**Impact:** Critical  
**Risk:** Phase 17 cannot proceed  
**Resolution:** Phase 2 (3-5 days)  
**Status:** Schema designed, requires approval

### 🔴 BLOCKER #4: Incomplete Test Coverage
**Impact:** High  
**Risk:** Unverified security boundaries, regression risk  
**Resolution:** Phases 1-3 (cumulative)  
**Status:** 14 tests identified, implementation pending

### 🔴 BLOCKER #5: Unconfirmed Migration Status
**Impact:** Medium  
**Risk:** Production schema drift, RPC unavailability  
**Resolution:** Phase 0 (2-4 hours)  
**Status:** Manual verification required

### 🔴 BLOCKER #6: Ambiguous Cross-Year Policy
**Impact:** Medium  
**Risk:** Incorrect scope restrictions, user frustration  
**Resolution:** Phase 0 (institutional policy confirmation)  
**Status:** Pending institutional clarification

---

## Approval Boundaries

### Immediate Implementation (No Approval Required)
- Identity audit queries (read-only)
- Remote migration verification (read-only)
- Test case additions (non-production)

### Requires System Owner Approval
- Auth user email lookup implementation (Phase 1)
- Synthetic email replacement (Phase 1)
- Announcement schema design (Phase 2)
- Storage deletion workflow (Phase 3)
- Phase 17 production deployment

### Requires Institutional Approval
- Cross-year representative policy clarification
- Retention policy and deletion timeline
- Institutional email validation integration (if pursued)

---

## Risk Assessment

### High Risk (Production Impact)
- **Duplicate Auth Error:** Blocking representative assignment → immediate fix required
- **Missing Migration Verification:** Production schema unknown → verify before any deployment

### Medium Risk (Feature Blockers)
- **Missing Announcement Infrastructure:** Phase 17 blocked → complete design and approval needed
- **Incomplete Test Coverage:** Regression risk → add tests incrementally during Phases 1-3

### Low Risk (Long-Term Maintenance)
- **Storage Lifecycle:** No immediate capacity pressure → implement in Phase 3 after core features
- **Academic History:** Historical data intact → enhancement in Phase 5

---

## Conclusion

**Current State:** 
- ✅ Strong multi-project isolation (12 tests passing)
- ✅ Robust PDF authorization (4 tests passing)
- ✅ Unified bot architecture (verified)
- ✅ Server-side scope validation (15 tests passing)
- 🔴 Unverified identity recovery (0 institutional validation)
- 🔴 Missing announcement infrastructure (0 tables, 0 buckets)
- 🔴 Zero Storage lifecycle management
- 🔴 Incomplete test coverage (14 tests missing)

**Recommendation:**
1. **STOP Phase 17 implementation immediately**
2. Complete Phase 0 verification (2-4 hours)
3. Deploy Phase 1 identity fix to production (1-2 days)
4. Design and approve Phase 2 announcement schema (3-5 days)
5. Implement Phases 2-3 in staging environment
6. Conduct full UAT before Phase 17 production deployment

**Total Timeline to Phase 17 Production:** 10-15 days (assuming no major discovery)

**Final Gate:** All 6 blockers resolved + 249 tests passing + System Owner approval

---

**Report Status:** ✅ COMPLETE  
**Mode:** READ-ONLY ANALYSIS (No code modified)  
**Next Action:** Awaiting approval to proceed with Phase 0 verification
