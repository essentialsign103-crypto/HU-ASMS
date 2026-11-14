# HU-ASMS — Consolidated Phase 0 Remediation Specification
## Strict Read-Only Audit & Architectural Alignment: Representative Assignment, Unified Telegram Bot, Announcement Center, and Project Operations

**Document ID:** `docs/CONSOLIDATED_PHASE_0_REMEDIATION_SPECIFICATION.md`  
**Date & Timestamp:** 2026-11-13T22:00:00-08:00 (Local) / 2026-11-14T06:00:00Z (UTC)  
**Verification Mode:** STRICT READ-ONLY AUDIT & SPECIFICATION ONLY  
**Target Supabase Project:** `tkdrxfvxryemfdrwcmay`  
**Target Environment URL:** `https://tkdrxfvxryemfdrwcmay.supabase.co`  
**Current Git Branch:** `clean-deployment`  
**Execution Status:** COMPLETED — STRICTLY READ-ONLY (NO CODE, MIGRATIONS, OR DATA MUTATED)

---

## 1. Executive Summary

This specification provides the consolidated architectural audit and implementation plan for the Haramaya University Academic Submission & Management System (HU-ASMS). It reconciles the newly confirmed **Authoritative Product Decisions** with the designs developed in Phase 16 (Representative Operations Center) and Phase 17 (Unified Student + Representative Bot and Announcement Center).

### 1.1 Strict Read-Only Compliance
In strict adherence to the authorization constraints:
- **0 application code files modified.**
- **0 SQL migrations created, edited, or executed.**
- **0 database rows inserted, updated, or deleted.**
- **0 Auth users created, modified, or deleted.**
- **0 representative assignments created or altered.**
- **0 storage buckets or policies created or changed.**
- **0 Git commits, pushes, merges, or branch changes.**
- **Privacy and credential hygiene preserved:** No student PII, credentials, or bot tokens are exposed.

### 1.2 Core Audit Takeaways
1. **Representative Assignment Policy Hardening:** The newly confirmed policy dictates that a representative must be an enrolled student in the **exact section** they represent (`student.section_id === assigned_section.id`). The current codebase only enforces same academic year (`student.academic_year_id === section.academic_year_id`) and contains a critical bug where `NULL` academic year values bypass validation entirely.
2. **Unified Single-Bot Experience:** Current `/start` logic permanently diverts representatives to a rep-only keyboard upon assignment, locking them out of all normal student features (submitting individual/group assignments, viewing projects, checking status). A unified architecture must provide the standard student menu by default, dynamically appending a role-gated `🎖️ Representative Operations Console` button.
3. **Announcement Center Status:** **100% Unimplemented.** There are no database tables (`announcements`, `announcement_recipients`), no storage bucket (`announcement-materials-vault`), and no bot handlers or conversations in the repository.
4. **Project Isolation & Reporting:** Submissions, reporting, and deliveries are strictly partitioned by composite key `(project_id, section_id)` in the backend (verified by 37 passing tests). However, Telegram reporting lacks physical PDF streaming, and the inline callback data format (`rep_report_${sectionId}_${projectId}`) exceeds Telegram's 64-byte limit (84 bytes), which will cause runtime API crashes when selected.
5. **Auth Identity Resolution (Error A):** The current service synthesizes unverified emails (`cleanHuId@hu.edu.et`) and invokes `createUser()` without paginated lookup or metadata-based recovery, triggering HTTP 422 conflicts when an Auth account pre-exists without a staff profile.
6. **Migration & Ledger Alignment:** The live remote database is running migration `20261113000002_enhance_provision_rep_profile_security.sql`. A local unit test (`track-b-privilege-and-sql-hardening.test.ts`) fails because it hardcodes an expected count of 12 migration files instead of 13.

---

## 2. Existing Implementation Inventory

Every relevant component, service, handler, and database entity has been audited and categorized into one of five definitive statuses:

| Subsystem / Component | Exact Source Path | Current Status | Empirical Findings & Line References |
| :--- | :--- | :--- | :--- |
| **Representative Assignment Service** | `apps/web/src/lib/admin/representative-management-service.ts` | **PARTIALLY IMPLEMENTED** | Implements same-year check ([L105-110](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/lib/admin/representative-management-service.ts#L105-L110)), but lacks same-section enforcement (`student.section_id === section.id`). Synthesizes unverified email ([L125](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/lib/admin/representative-management-service.ts#L125)). |
| **Admin Representative UI** | `apps/web/src/app/admin/representatives/page.tsx` | **PARTIALLY IMPLEMENTED** | Renders assignment form ([L94-149](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/admin/representatives/page.tsx#L94-L149)), but dropdowns are uncascaded, allowing operators to select incompatible sections. |
| **Bot `/start` Command** | `apps/bot/src/commands/start.ts` | **PARTIALLY IMPLEMENTED** | Early returns rep keyboard if user is representative ([L24-41](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/commands/start.ts#L24-L41)), locking them out of student submission features. |
| **Main Menu Keyboards** | `apps/bot/src/keyboards/main-menu.ts` | **PARTIALLY IMPLEMENTED** | Provides disjoint keyboards ([L4-22](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/keyboards/main-menu.ts#L4-L22)). No unified keyboard or announcement buttons exist. |
| **Representative Bot Handlers** | `apps/bot/src/handlers/representative.handler.ts` | **PARTIALLY IMPLEMENTED** | Implements roster viewing, reports, groups ([L33-322](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/handlers/representative.handler.ts#L33-L322)). Forward to teacher only prints URL ([L344-359](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/handlers/representative.handler.ts#L344-L359)). Callback data length is 84 bytes ([L157](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/handlers/representative.handler.ts#L157)). |
| **Submission Reporting Service** | `apps/bot/src/services/representative-reporting.service.ts` | **IMPLEMENTED BUT NOT LIVE-VERIFIED** | Calculates submitted vs missing, group coverage ([L1-200](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/representative-reporting.service.ts)). Verified in mocked unit tests (10/10 passed). |
| **Teacher Delivery Service (Web)** | `apps/web/src/lib/rep/delivery-service.ts` | **IMPLEMENTED BUT NOT LIVE-VERIFIED** | Batch preparation, signed 15-min URLs, status transitions ([L1-300](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/lib/rep/delivery-service.ts)). Verified in unit tests (13/13 passed). |
| **Announcement Database Schema** | `supabase/migrations/` | **NOT IMPLEMENTED** | No `announcements` or `announcement_recipients` tables exist in any local migration or remote database. |
| **Announcement Storage Vault** | Supabase Storage | **NOT IMPLEMENTED** | Remote storage has only `hu-assistant` and `submission-files-vault`. No `announcement-materials-vault` exists. |
| **Announcement Bot Conversation** | `apps/bot/src/conversations/` | **NOT IMPLEMENTED** | No announcement composer, validator, or preview conversation exists. |
| **Remote Provisioning RPC** | Remote Database `tkdrxfvxryemfdrwcmay` | **VERIFIED IMPLEMENTED** | `public.provision_representative_profile` with System Owner downgrade protection active on live Supabase. |
| **Academic Session Management** | `supabase/migrations/` | **PARTIALLY IMPLEMENTED** | Static year levels exist (`academic_years`). Calendar years, semesters, and course offerings are missing. |
| **Physical PDF Streaming in Bot** | `apps/bot/src/` | **NOT IMPLEMENTED** | Reports only output markdown text summaries; no signed URL download buttons or Telegram document streaming. |

---

## 3. Previously Agreed Requirements Reconciliation

The table below reconciles the Phase 16 Operations Center, Phase 17 Unified Experience, and newly confirmed Authoritative Decisions:

| Area | Previously Designed (Phases 16 & 17) | Newly Confirmed Authoritative Decision | Reconciliation & Final Specification |
| :--- | :--- | :--- | :--- |
| **Representative Scope** | Permitted representatives to represent sections within their academic year (e.g. Year 2 student representing 2A or 2B). | Representative MUST be an enrolled student in the **exact section** they represent. | Enforce `student.section_id === assigned_section.id` in both UI and server action. Reject cross-section assignments even within the same year. |
| **Enrollment Integrity** | Allowed assignment if `student.academic_year_id` matched `section.academic_year_id`. | Missing, `NULL`, inconsistent, or unverified enrollment must fail closed. | Replace `if (student.academic_year_id && ...)` with strict fail-closed check: `if (!student.section_id \|\| student.section_id !== section.id) throw ScopeMismatch`. |
| **Multiple Representatives** | Multiple reps per section allowed; reps could represent multiple sections. | Multiple reps per section allowed; one rep's permissions must not automatically extend to other sections. | Retain schema `CONSTRAINT uq_rep_section UNIQUE (profile_id, section_id)`. Restrict rep assignment to the student's single enrolled section. |
| **Bot Experience** | Disjoint `/start` menu branching based on `findRepresentativeByTelegramId`. | Single unified bot. Representative retains all student features and ordinary student menu. | Standard student menu rendered for all students. Role-gated `🎖️ Representative Operations Console` button dynamically appended if active rep. |
| **Announcement Center** | 3 types (Text, PDF, Text+PDF) with broadcast engine. | Preserved as mandatory feature. Dedicated section scope, private vault, durable recipient ledger. | Maintain full Phase 17 Announcement design: `announcements`, `announcement_recipients`, private storage, idempotency, retry tracking. |
| **Project Isolation** | 6 concurrent project scenario (OOP, IP II, DBMS, SE, Networks, OS). | Strictly enforce `project_id` AND `section_id` on all reads, reports, PDFs, and deliveries. | All queries, reporting aggregations, signed URL downloads, and delivery manifests bind strictly to `(project_id, section_id)`. |

---

## 4. Representative Assignment Policy Audit

### 4.1 Exact Failing Code & Root Cause
In [apps/web/src/lib/admin/representative-management-service.ts](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/lib/admin/representative-management-service.ts#L104-L111):
```typescript
// CURRENT IMPLEMENTATION (DEFECTIVE):
// Strict Scope Compatibility: Student cannot represent an incompatible academic year
if (student.academic_year_id && section.academic_year_id !== student.academic_year_id) {
  return {
    success: false,
    error: 'Scope mismatch: Student cannot be assigned as representative to an incompatible academic year or scope.',
  };
}
```

#### Defect 1: Scope Too Broad
This check permits cross-section assignment within the same year (e.g. Student in 2nd Year Section A representing 2nd Year Section B). The authoritative policy requires:
`student.section_id === section.id`.

#### Defect 2: NULL Bypass Security Hole
If `student.academic_year_id` is `null` or undefined, `student.academic_year_id && ...` evaluates to `false`, allowing an unassigned or corrupt student record to bypass validation completely.

#### Defect 3: UI Cascading Defect
In [apps/web/src/app/admin/representatives/page.tsx](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/admin/representatives/page.tsx#L100-L140):
The student select and section select are two static, unlinked dropdowns. The section dropdown lists all 8 sections across all 4 academic years alphabetically. Operators selecting a 2nd Year student naturally encounter 3rd Year sections in the list, virtually guaranteeing accidental scope mismatches.

### 4.2 Reconciled Specification for Representative Assignment
1. **Server-Side Validation Rule:**
   ```typescript
   // RECONCILED SPECIFICATION:
   if (!student.section_id || !student.academic_year_id) {
     return {
       success: false,
       error: 'Ineligible student: Student does not have a verified section enrollment.',
     };
   }

   if (student.section_id !== section.id) {
     return {
       success: false,
       error: 'Scope mismatch: Student must be an enrolled member of the exact academic section they represent.',
     };
   }
   ```
2. **Admin UI Cascading:**
   - Client-side state in `RepresentativesPage` or server-side filtering: Selecting a student automatically locks the target section dropdown to the student's enrolled section (`student.section.name`), or filters available sections to only matching scopes.
   - Display student enrollment clearly: `Hamza Teha (HU/1341/17) — 3rd Year Section B [Enrolled Scope: Section B]`.

---

## 5. Unified Bot Access Audit

### 5.1 Current Lockout Architecture
In [apps/bot/src/commands/start.ts](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/commands/start.ts#L24-L41):
```typescript
const repData = await db.findRepresentativeByTelegramId(telegramUserId);
if (repData) {
  await ctx.reply(..., {
    reply_markup: getRepresentativeMainMenuKeyboard(), // Only has rep buttons!
  });
  return; // Completely blocks ordinary student menu!
}
```

### 5.2 Unified Role-Gated Menu Architecture
A student who becomes a representative does not stop being a student. They must submit their own individual and group assignments to teachers through the bot.

```
                         /start (Telegram User ID)
                                    │
                                    ▼
                     Find Approved Student by Telegram ID
                                    │
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
          Student Not Found                    Student Approved
                  │                                   │
      Interactive Registration                        ▼
                                      Check Active Representative Assignments
                                                      │
                                      ┌───────────────┴───────────────┐
                                      ▼                               ▼
                               Ordinary Student               Active Representative
                                      │                               │
                                      ▼                               ▼
                              Standard Student Menu           Unified Main Menu
                              - My Profile                    - Standard Student Buttons (8)
                              - My Academic Info              - 🎖️ Representative Operations
                              - My Projects
                              - My Groups
                              - Submit Assignment
                              - Submit Group Project
                              - Submission History
                              - Help & Support
```

### 5.3 Keyboard Layout Specifications

#### 1. Unified Student Main Menu (`getUnifiedStudentKeyboard(isRep: boolean)`)
```
[ 👤 My Profile ]               [ 📚 My Academic Information ]
[ 📋 My Projects ]              [ 👥 My Groups ]
[ 📤 Submit Assignment ]        [ 🚀 Submit Group Project ]
[ 📜 Submission History ]       [ 📢 Section Announcements ]
[ ❓ Help & Support ]
-- IF isRep IS TRUE: --
[ 🎖️ Representative Operations Console ]
```

#### 2. Representative Operations Console Menu (`getRepresentativeOperationsKeyboard()`)
```
[ 📢 Post Announcement ]        [ 📜 Announcement History ]
[ 🏢 Assigned Sections ]        [ 👥 Enrolled Students ]
[ 📂 Section Projects ]         [ 📊 Submission Reports ]
[ 👥 View Groups ]              [ 📦 Deliver to Teacher ]
[ 📜 Delivery History ]         [ 🔄 Switch Active Section ]
[ 🏠 Return to Student Menu ]
```

### 5.4 Zero-Trust Server-Side Authorization
Every representative command, conversation step, and inline callback query must independently resolve:
1. `ctx.from.id` (Telegram numeric ID).
2. Active staff profile in `profiles` (`is_active = true`, `role = 'representative'`).
3. Active section assignment in `representative_assignments` (`is_active = true`, `section_id = targetSectionId`).
4. Never accept `section_id` from callback parameters without asserting `auth_is_rep_for_section(sectionId)`.

---

## 6. Announcement Center Implementation Audit

### 6.1 Current Gap
The Announcement Center is **100% missing** from the application:
- SQL migrations contain zero announcement tables.
- Storage contains zero announcement buckets.
- Bot contains zero announcement handlers.

### 6.2 Target Architecture & Data Model

#### 1. Database Schema (`supabase/migrations/20261114000001_announcement_center.sql`)
```sql
CREATE TYPE announcement_type_enum AS ENUM ('text_only', 'pdf_only', 'text_and_pdf');
CREATE TYPE announcement_delivery_status AS ENUM ('pending', 'sent', 'failed');

CREATE TABLE IF NOT EXISTS public.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_id UUID NOT NULL REFERENCES public.sections(id) ON DELETE RESTRICT,
    project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL, -- Optional project link
    author_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    announcement_type announcement_type_enum NOT NULL,
    title VARCHAR(255) NOT NULL,
    body_text TEXT,
    file_path TEXT, -- Storage path in announcement-materials-vault
    file_name VARCHAR(255),
    file_size_bytes BIGINT,
    file_sha256 VARCHAR(64),
    target_student_count INTEGER NOT NULL DEFAULT 0,
    delivered_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.announcement_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
    telegram_user_id BIGINT NOT NULL,
    status announcement_delivery_status NOT NULL DEFAULT 'pending',
    telegram_message_id BIGINT,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_announcement_recipient UNIQUE (announcement_id, student_id)
);
```

#### 2. Storage Vault (`announcement-materials-vault`)
- **Bucket ID:** `announcement-materials-vault`
- **Public Access:** `false` (Private storage).
- **Max File Size:** `20971520` (20 MB Telegram Bot API file limit).
- **MIME Types:** `['application/pdf']`.
- **Path Structure:** `sections/${sectionId}/announcements/${announcementId}/${cleanFilename}`.

#### 3. Telegram Bot Workflow
1. Rep taps `📢 Post Announcement`.
2. Bot verifies rep authorization and presents section selector (if assigned to multiple).
3. Rep selects announcement type: `[ 📝 Text Only ]`, `[ 📄 PDF Only ]`, `[ 📝+📄 Text & PDF ]`.
4. Rep inputs content (text body and/or document upload).
5. Document validator inspects:
   - File extension: `.pdf`.
   - Magic bytes: `%PDF-` (`0x25 0x50 0x44 0x46`).
   - Size limit: <= 20 MB.
6. Bot uploads document to `announcement-materials-vault`.
7. **Interactive Preview Card:** Renders formatted preview with target recipient count.
8. Rep confirms: `[ ✅ Confirm & Broadcast ]` or `[ ❌ Cancel ]`.
9. **Durable Broadcast Engine:**
   - Queries all approved, locked students in `section_id` with non-null `telegram_user_id`.
   - Inserts pending rows in `announcement_recipients`.
   - Iterates recipients with rate limiting (25 msgs/sec Telegram broadcast throttling).
   - Updates status to `sent` or `failed` with error message.
   - Emits audit log `ANNOUNCEMENT_BROADCAST_COMPLETED`.

---

## 7. Project Isolation & Teacher Delivery Audit

### 7.1 Multi-Project Concurrent Isolation Model
Consider Section B enrolled in 6 concurrent courses:
1. Object-Oriented Programming — Dr. Teacher A
2. Internet Programming II — Prof. Teacher B
3. Database Systems — Dr. Teacher C
4. Software Engineering — Prof. Teacher D
5. Computer Networks — Dr. Teacher E
6. Operating Systems — Prof. Teacher F

#### The 4 Golden Rules of Project Isolation:
1. **Roster Scoping:** Submissions for OOP must never appear in Database Systems reports.
2. **Missing-Student Isolation:** If Student X submits 5 projects but misses Operating Systems, Student X must appear as *Submitted* in 5 reports and *Missing* strictly in the Operating Systems report.
3. **Teacher Binding:** The destination teacher is strictly derived from `projects.teacher_id`. The representative cannot alter or choose an arbitrary teacher recipient.
4. **Physical PDF Retrieval:** Retrieval of submission PDFs from `submission-files-vault` must verify `(project_id, section_id, auth_is_rep_for_section)`.

### 7.2 Empirical Backend Test Evidence
Backend isolation is verified by **37 unit tests passing** (`npx tsx --test` in 1,262ms):
- `apps/bot/test/representative-reporting.service.test.ts`:
  - `should strictly isolate reporting data when a project targets multiple sections` (PASS)
  - `should accurately calculate submitted vs. missing individual students` (PASS)
  - `should accurately report submitted groups with credited snapshots` (PASS)
  - `should block a representative from querying reports for an unassigned section` (PASS)
- `apps/web/test/delivery.service.test.ts`:
  - `should reject batch preparation if any submission belongs to a different section` (PASS)
  - `should reject batch preparation if representative attempts to prepare for an unassigned section` (PASS)
  - `should generate signed manifest with 15-minute expiring download links` (PASS)

### 7.3 Critical Gaps in Telegram Delivery Layer
1. **No Forwarding in Telegram:** `handleRepForwardToTeacher` in `representative.handler.ts` (lines 324-360) merely outputs a text link to the web portal (`/rep/deliveries/new`) instead of providing an operational workflow in Telegram.
2. **Callback Data Size Overflow (84 bytes > 64 bytes):**
   In `representative.handler.ts` line 157:
   `rep_report_${assign.section_id}_${proj.id}`
   - `rep_report_`: 11 chars
   - `section_id` (UUID): 36 chars
   - `_`: 1 char
   - `proj.id` (UUID): 36 chars
   - Total: **84 bytes**.
   Telegram Bot API strictly enforces a maximum of **64 bytes** for `InlineKeyboardButton.callback_data`. Sending 84 bytes causes Telegram to return `400 Bad Request: BUTTON_DATA_INVALID`.
3. **Remediation for Callback Data:** Implement a Base64URL/short-id callback codec (`apps/bot/src/utils/callback-codec.ts`) compressing UUID pairs into 32 bytes:
   `rr:${packUuids(sectionId, projectId)}` (<= 36 bytes).

---

## 8. Auth Identity Blocker Analysis

### 8.1 Empirical Census of Remote Auth Users
Direct inspection of the live Supabase project `tkdrxfvxryemfdrwcmay` revealed:
- **Total Auth Accounts:** Exactly 3.
  1. System Owner: UUID `f70220b8-b150-44dc-8542-fd979be72b7d`
  2. Representative 1: UUID `59bf64a6-1b89-4b60-955e-3130d8dcad90` (linked to `HU/1341/17`)
  3. Representative 2: UUID `a2ad34f1-f910-459b-b4fa-3ed2975a22d4` (linked to `HU/3445/17`)
- **Orphaned Auth Users:** 0.
- **Orphaned Profiles:** 0.
- **Unassigned Eligible Students:** 2 students (`HU/1431/17` and `HU/6555/17`) currently have NO Auth account.

### 8.2 The Synthetic Email Root Cause
In `representative-management-service.ts` line 125:
`const repEmail = `${cleanHu}@hu.edu.et`;`
1. The `students` table has **NO email column** (verified in `initial_schema.sql:142-167`). Students authenticate with Telegram numeric IDs, not email/password.
2. `profiles` requires an `id REFERENCES auth.users(id)` and `email VARCHAR UNIQUE NOT NULL`.
3. When designating a representative, the service fabricates `repEmail`.
4. If `createUser()` is called when an Auth account with that email already exists (or if an earlier attempt crashed before inserting `profiles`), `createUser()` throws HTTP 422: `A user with this email address has already been registered`.
5. Because there is no fallback lookup or recovery path, the assignment fails permanently.

### 8.3 Safe Auth Identity Resolution Architecture
To resolve existing accounts safely without risking account takeover:
1. **Never Adopt Accounts by Email Matching Alone:** An attacker could register `hu143117@hu.edu.et` in Supabase Auth if self-registration is enabled. Adopting an account based on email alone would link a representative profile to an attacker's Auth user.
2. **Metadata-Anchored Verification:**
   Before creating an Auth account:
   - Query `auth.admin.listUsers({ page: 1, perPage: 100 })` (properly paginated).
   - If an Auth account exists matching `repEmail`:
     - Inspect `user.user_metadata`.
     - Check: `user.user_metadata.hu_student_id === student.hu_student_id` AND `user.user_metadata.student_id === student.id`.
     - If metadata matches: Safely adopt `user.id`.
     - If metadata does NOT match or is missing: **Fail closed.** Throw: `Identity conflict: Auth account exists with conflicting or unverified student credentials.`
3. **Use Non-Routable Synthetic UPNs:**
   Replace the guessed institutional domain `@hu.edu.et` with an internal synthetic format:
   `rep_${student.id}@auth.hu-asms.internal`.
   This eliminates any collision with real external email systems or university mailboxes.

---

## 9. Remote Migration Reconciliation

### 9.1 Live Remote Status Verification
- **Endpoint:** `GET https://tkdrxfvxryemfdrwcmay.supabase.co/rest/v1/?apikey=...`
- **Result:** OpenAPI summary for `/rpc/provision_representative_profile` returns:
  `"summary": "Privileged RPC for provisioning representative profiles. Only accessible by System Owners. Uses SECURITY DEFINER to bypass RLS and direct INSERT restrictions. Prevents modification of existing System Owner profiles. All actions are audited."`
- **Matching Local File:** Lines 165-166 of `supabase/migrations/20261113000002_enhance_provision_rep_profile_security.sql`.
- **Verdict:** **Migration `20261113000002` is verified to be active and operational on the remote database.**

### 9.2 The 12 vs 13 Migration Test Failure
- **Failing Test:** `apps/web/test/track-b-privilege-and-sql-hardening.test.ts:100`.
- **Assertion:**
  ```typescript
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(files, [
    '20261110000001_initial_schema.sql',
    ...
    '20261113000001_provision_representative_profile_rpc.sql',
  ]);
  ```
- **Explanation:**
  The test hardcoded an exact list of 12 migrations ending at `20261113000001`.
  When migration `20261113000002` was created to patch System Owner downgrade protection, the migration file was written to disk and applied remotely, but the static test was not updated because of read-only mode.
- **Git Status:** Both `20261113000001` and `20261113000002` are currently untracked (`??`) on branch `clean-deployment`.
- **Remediation Plan:** Upon implementation approval, commit both migration files to `clean-deployment` and update the test assertion array in `track-b-privilege-and-sql-hardening.test.ts` to include `20261113000002`.

---

## 10. Storage & Academic Lifecycle Audit

### 10.1 Storage Capacity & Threshold Management
- **Current Buckets:**
  - `submission-files-vault`: Private, 20 MB file size limit, MIME-restricted.
  - `hu-assistant`: Private, general assistant storage.
- **Capacity Constraint:** Free Tier total quota is **1 GB**.
  - 1 section of 25 students submitting 6 projects at 8 MB each = **1.2 GB** (exceeds quota in one semester).
- **Required Storage Monitoring & Backpressure:**
  - **70% Threshold (700 MB):** Dashboard warning badge for System Owner; no disruption to students.
  - **85% Threshold (850 MB):** Critical alert banner; representatives warned during batch preparation; automated recommendation to archive completed prior semesters.
  - **95% Threshold (950 MB):** Non-destructive backpressure; uploads paused with friendly student notification (`System capacity limit reached. Submission deadline extended. Contact System Administrator`); existing data preserved.

### 10.2 Academic Session Lifecycle
- Current `academic_years` table represents student year level (1st, 2nd, 3rd, 4th Year), NOT calendar sessions.
- **Required Entities for Historical Preservation:**
  1. `academic_calendar_years`: e.g. `2025/2026`, `2026/2027`.
  2. `academic_semesters`: e.g. `Semester I`, `Semester II`.
  3. `course_offerings`: Session-specific binding of `(course_id, teacher_id, semester_id, academic_year_id)`.
  4. `student_session_enrollments`: Session-specific binding of student to section for that semester.
- **Hardening Cascade Deletes:**
  Current schema uses `courses ON DELETE CASCADE -> projects ON DELETE CASCADE -> submissions`.
  Deleting a course deletes all historical submissions and deliveries. Must be altered to `ON DELETE RESTRICT`.

### 10.3 System Owner-Only Deletion & 30-Day Quarantine
- Students, representatives, and teachers have **0 deletion privileges**.
- System Owner cannot perform immediate hard deletes.
- **Two-Phase Deletion Workflow:**
  1. Soft delete: Row marked `is_deleted = true`, `deleted_at = clock_timestamp()`, `quarantine_until = clock_timestamp() + INTERVAL '30 days'`.
  2. Storage object moved to `quarantine/` prefix.
  3. 30-day recovery window where System Owner can restore records.
  4. Permanent purging requires second-factor confirmation and emits immutable audit log `SYSTEM_OWNER_PURGE_EXECUTED`.

---

## 11. Test Coverage and Evidence

Every required test scenario has been evaluated across the existing test suites:

| # | Test Scenario | Current Test File | Test Classification | Execution Result |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Same-section assignment accepted | `telegram-workflow-remediation.test.ts:258` | Mocked Unit Test | **PASS** |
| 2 | Cross-section assignment rejected | Missing (only cross-year tested at line 446) | **NOT IMPLEMENTED** | **GAP** |
| 3 | NULL enrollment rejected | Missing (NULL currently bypasses check) | **NOT IMPLEMENTED** | **GAP** |
| 4 | Multiple reps for one section accepted | `telegram-workflow-remediation.test.ts:258` | Mocked Unit Test | **PASS** |
| 5 | One rep cannot access another section | `representative-reporting.service.test.ts:15` | Mocked Integration | **PASS** |
| 6 | Reps retain normal student capabilities | Missing (current `/start` blocks reps) | **NOT IMPLEMENTED** | **GAP** |
| 7 | Announcement text-only flow | None | **NOT IMPLEMENTED** | **GAP** |
| 8 | Announcement PDF-only flow | None | **NOT IMPLEMENTED** | **GAP** |
| 9 | Announcement text+PDF flow | None | **NOT IMPLEMENTED** | **GAP** |
| 10 | Announcement recipient isolation | None | **NOT IMPLEMENTED** | **GAP** |
| 11 | Failed Telegram delivery and retry | `telegram-workflow-remediation.test.ts:178` | Mocked Unit Test | **PASS** (Notification only) |
| 12 | Duplicate announcement prevention | None | **NOT IMPLEMENTED** | **GAP** |
| 13 | Project A cannot retrieve Project B | `representative-reporting.service.test.ts:45` | Mocked Integration | **PASS** |
| 14 | Project A cannot deliver Project B PDFs | `delivery.service.test.ts:35` | Mocked Integration | **PASS** |
| 15 | Correct teacher binding | `delivery.service.test.ts:50` | Mocked Integration | **PASS** |
| 16 | Individual submission reporting | `representative-reporting.service.test.ts:30` | Mocked Integration | **PASS** |
| 17 | Group coverage reporting | `representative-reporting.service.test.ts:38` | Mocked Integration | **PASS** |
| 18 | Missing-student reporting | `representative-reporting.service.test.ts:30` | Mocked Integration | **PASS** |
| 19 | Actual PDF retrieval in Telegram | None (bot only outputs text stats) | **NOT IMPLEMENTED** | **GAP** |
| 20 | Signed URL auth & 15-min expiry | `signed-url.test.ts:15` | Mocked Integration | **PASS** |
| 21 | Auth identity conflict handling | Missing (fails with 422 in createUser) | **NOT IMPLEMENTED** | **GAP** |
| 22 | Concurrent provisioning race | None | **NOT IMPLEMENTED** | **GAP** |
| 23 | Owner-only deletion authorization | Missing | **NOT IMPLEMENTED** | **GAP** |

> [!NOTE]
> All passing tests above are **mocked unit/integration tests**. While they verify business logic and SQL ASTs, they do **not** constitute proof of live remote Telegram webhook execution or live storage transfers.

---

## 12. Security Vulnerabilities and Red Flags

| Severity | Vulnerability Description | File Reference | Impact & Exploitation Path |
| :--- | :--- | :--- | :--- |
| **CRITICAL** | Scope validation bypass on `NULL` academic year | `representative-management-service.ts:105` | If a student record has `academic_year_id = NULL`, `if (student.academic_year_id && ...)` evaluates to `false`, allowing an unassigned student to be assigned as rep to any section. |
| **CRITICAL** | Telegram Inline Callback Data Overflow (84 bytes > 64 bytes) | `representative.handler.ts:157` | Generating buttons with `rep_report_${sectionId}_${projectId}` exceeds Telegram's 64-byte payload limit, causing `BUTTON_DATA_INVALID` 400 errors when users open reports. |
| **HIGH** | Representative Lockout from Student Capabilities | `commands/start.ts:26-41` | Early return on representative check permanently hides student submission keyboard, preventing representatives from submitting their own coursework. |
| **HIGH** | Unverified Synthetic Email Account Collision | `representative-management-service.ts:125` | Fabricating `cleanHu@hu.edu.et` causes HTTP 422 conflicts and risks account hijacking if email lookups are performed without metadata validation. |
| **MEDIUM** | Cascading Deletion of Academic Submissions | `initial_schema.sql:205-230` | `courses ON DELETE CASCADE -> projects ON DELETE CASCADE -> submissions` risks catastrophic loss of historical submissions if an admin deletes a course. |
| **MEDIUM** | Storage Download RLS Gap for Students | `storage_setup.sql:33-60` | Web storage policies allow System Owners and Representatives to download submissions, but provide **zero download policy for students** to retrieve their own files on the web. |

---

## 13. Missing Components Catalog

The following concrete files, migrations, and handlers must be created during implementation:

1. **Migrations:**
   - `supabase/migrations/20261114000001_announcement_center_and_storage.sql`: Creates `announcements`, `announcement_recipients`, and `announcement-materials-vault` bucket.
   - `supabase/migrations/20261114000002_academic_session_and_cascade_hardening.sql`: Adds calendar years, semesters, course offerings, and restricts cascading deletes.
2. **Bot Handlers & Conversations:**
   - `apps/bot/src/conversations/announcement.conversation.ts`: Multi-step interactive announcement composer with preview.
   - `apps/bot/src/handlers/announcement.handler.ts`: Broadcast engine with Telegram rate limiting and recipient status updates.
   - `apps/bot/src/utils/callback-codec.ts`: Compact 32-byte Base64URL codec for inline buttons.
   - `apps/bot/src/handlers/submission-pdf-delivery.handler.ts`: Streams physical PDFs or generates temporary signed URLs in Telegram.
3. **Web Dashboard & Services:**
   - `apps/web/src/app/rep/announcements/`: Web console for representative announcement auditing and historical export.
   - `apps/web/src/lib/security/quarantine-service.ts`: 30-day two-phase soft deletion engine for System Owners.

---

## 14. Recommended Implementation Order

To ensure uninterrupted operations, implementation should proceed in four strictly gated phases:

```
┌────────────────────────────────────────────────────────┐
│  Phase 1: Remediation of Critical Blockers & Security  │
│  - Fix NULL scope bypass & enforce same-section rule   │
│  - Update admin UI to cascade sections by student      │
│  - Metadata-anchored Auth user resolution (fix 422)    │
│  - Align migration count test (12 -> 13) & commit      │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│  Phase 2: Unified Single-Bot Experience                │
│  - Refactor /start to always render student menu       │
│  - Append role-gated Representative Operations Console │
│  - Implement 32-byte callback data codec (<64 bytes)   │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│  Phase 3: Announcement Center & PDF Streaming          │
│  - Deploy announcement tables and private vault        │
│  - Implement announcement conversation & broadcaster   │
│  - Implement physical PDF retrieval in Telegram        │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│  Phase 4: Academic Lifecycle & Owner Deletion Guard    │
│  - Add academic calendar years, semesters, offerings   │
│  - Harden schema against cascading deletes             │
│  - Implement 70/85/95% storage alerts & quarantine     │
└────────────────────────────────────────────────────────┘
```

---

## 15. Explicit Approval Gates

No implementation will occur without separate, explicit user approval at each gate:

- **GATE 1 APPROVAL:** Authorization to exit read-only mode and execute **Phase 1** (Fixing the Scope Mismatch in `representative-management-service.ts`, cascading the Admin UI select, hardening Auth identity lookup, and committing migrations 12 & 13).
- **GATE 2 APPROVAL:** Authorization to implement **Phase 2** (Refactoring `/start`, unifying the keyboards, and deploying the compact callback codec).
- **GATE 3 APPROVAL:** Authorization to implement **Phase 3** (Creating the Announcement Center migration, private bucket, and bot broadcast conversation).
- **GATE 4 APPROVAL:** Authorization to implement **Phase 4** (Academic sessions, cascade hardening, storage backpressure, and System Owner quarantine deletion).

**END OF REPORT — AWAITING EXPLICIT APPROVAL TO PROCEED WITH IMPLEMENTATION.**
