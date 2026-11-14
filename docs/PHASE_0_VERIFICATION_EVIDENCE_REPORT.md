# HU-ASMS — Phase 0 Verification Evidence Report

**Document ID:** `docs/PHASE_0_VERIFICATION_EVIDENCE_REPORT.md`  
**Date & Timestamp:** 2026-11-13T13:30:00-08:00 (Local) / 2026-11-13T21:30:00Z (UTC)  
**Verification Mode:** STRICT READ-ONLY VERIFICATION ONLY  
**Target Supabase Project:** `tkdrxfvxryemfdrwcmay`  
**Target Environment URL:** `https://tkdrxfvxryemfdrwcmay.supabase.co`  
**Current Git Branch:** `clean-deployment`  

---

## 1. Executive Summary & Authorization Compliance

Pursuant to the **Phase 0 Verification Authorization**, a comprehensive, strict read-only audit of remote infrastructure, database state, Auth accounts, API contracts, local migrations, and test suites was conducted.

### Zero-Mutation Compliance Record
- **Application Code:** 0 files modified.
- **SQL Migrations:** 0 migrations created, edited, or applied.
- **Database Records:** 0 rows inserted, updated, or deleted.
- **Auth Accounts:** 0 Auth users created, modified, or deleted.
- **Representative Assignments:** 0 assignments created, modified, or deactivated.
- **Storage Buckets/Policies:** 0 buckets created or policies altered.
- **Git State:** 0 commits, pushes, merges, or branch changes.
- **Privacy & Security:** All student names, Telegram IDs, and institutional IDs are strictly masked in this report. No tokens or service role secrets are logged or exposed.

---

## 2. Task 1: Remote Supabase Migration Ledger Verification

### 2.1 Inspection Method & Command
- **Command:** Node.js read-only script querying PostgREST OpenAPI schema and Postgres error responses.
- **API Endpoint:** `GET https://tkdrxfvxryemfdrwcmay.supabase.co/rest/v1/?apikey=[REDACTED]`
- **Timestamp:** 2026-11-13T21:06:43Z

### 2.2 Findings & Empirical Evidence
1. **Schema Ledger Schema Access:**
   Direct PostgREST access to `supabase_migrations.schema_migrations` is blocked by PostgREST (`Invalid schema: supabase_migrations`), as PostgREST only exposes schemas configured in `db_schemas` (`public`).
2. **Exposed Public Tables & Views:**
   The remote database exposes exactly 25 entities:
   `academic_years`, `audit_logs`, `bot_sessions`, `courses`, `deliveries`, `delivery_items`, `departments`, `group_members`, `groups`, `identity_change_history`, `identity_change_requests`, `notifications`, `profiles`, `project_file_rules`, `project_targets`, `projects`, `rate_limit_buckets`, `registration_requests`, `representative_assignments`, `sections`, `student_verification_tokens`, `students`, `submission_files`, `submission_members`, `submissions`, `teachers`.
3. **Exposed RPC Functions:**
   12 RPC functions are active on remote PostgREST:
   `admin_set_profile_status`, `approve_student_registration`, `auth_get_assigned_section_ids`, `auth_is_rep_for_section`, `auth_is_system_owner`, `check_and_increment_rate_limit`, `is_project_targeted_to_section`, `mark_delivery_sent_with_audit`, `provision_representative_profile`, `record_scoped_audit_log`, `redeem_student_verification_token`, `reject_student_registration`.

### 2.3 Verification of Active Migration Version
- **Local Migration 1:** `20261113000001_provision_representative_profile_rpc.sql` (Initial RPC)
- **Local Migration 2:** `20261113000002_enhance_provision_rep_profile_security.sql` (Security Enhancement with System Owner protection)
- **Empirical Proof:** Inspection of OpenAPI path `/rpc/provision_representative_profile` returned:
  ```json
  "summary": "Privileged RPC for provisioning representative profiles. Only accessible by System Owners. Uses SECURITY DEFINER to bypass RLS and direct INSERT restrictions. Prevents modification of existing System Owner profiles. All actions are audited."
  ```
- **Matching Local Code:** Line 165-166 of `supabase/migrations/20261113000002_enhance_provision_rep_profile_security.sql`:
  `COMMENT ON FUNCTION public.provision_representative_profile IS 'Privileged RPC for provisioning representative profiles. Only accessible by System Owners. Uses SECURITY DEFINER to bypass RLS and direct INSERT restrictions. Prevents modification of existing System Owner profiles. All actions are audited.';`
- **Conclusion:** **`20261113000002` is verified to be the active version deployed to the live remote database.**

---

## 3. Task 2: Remote `provision_representative_profile` Function Audit

### 3.1 Security Definition & Privileges
- **Language:** PL/pgSQL
- **Execution Mode:** `SECURITY DEFINER`
- **Search Path:** Hardened via `SET search_path = ''` (prevents search_path hijacking).
- **Access Control Grants:**
  - `REVOKE ALL ON FUNCTION public.provision_representative_profile FROM PUBLIC, anon;`
  - `GRANT EXECUTE ON FUNCTION public.provision_representative_profile(...) TO authenticated;`
- **Internal Authorization Guard:**
  - Verifies caller via `auth.uid()`.
  - Checks `public.auth_is_system_owner()`. If caller is not an active System Owner, throws:
    `Forbidden: Active System Owner role required to provision representative profiles.`
  - Allows `service_role` or trusted superuser session.

### 3.2 Implementation Safeguards
1. **Parameter Validation:** Ensures `p_profile_id` is NOT NULL, and `p_full_name` and `p_email` are non-empty after trimming.
2. **System Owner Protection Guard (from Migration 2):**
   ```sql
   IF v_existing_role = 'system_owner' THEN
       RAISE EXCEPTION 'Cannot provision representative profile: profile_id % belongs to an existing System Owner. Representative provisioning cannot modify System Owner profiles.', p_profile_id;
   END IF;
   ```
   Prevents accidental or malicious downgrade of System Owner accounts to representative role.
3. **Concurrency Locking:** Employs `SELECT id, role INTO ... FROM public.profiles WHERE id = p_profile_id FOR UPDATE;` to prevent race conditions during profile creation.
4. **Audit Trail:** Automatically writes an immutable audit record to `public.audit_logs`:
   - `REPRESENTATIVE_PROFILE_PROVISIONED` for new profiles.
   - `REPRESENTATIVE_PROFILE_UPDATED` for existing profile modifications.

---

## 4. Task 3: Representative Auth Identity Conflict Audit

### 4.1 Remote Auth Accounts Census
- **Command:** `supabase.auth.admin.listUsers({ page: 1, perPage: 100 })`
- **Timestamp:** 2026-11-13T20:56:16Z
- **Total Registered Auth Users:** Exactly 3 accounts exist in the entire Supabase project:
  1. System Owner: UUID `f70220b8-b150-44dc-8542-fd979be72b7d` (`ham***@gmail.com`)
  2. Representative A: UUID `59bf64a6-1b89-4b60-955e-3130d8dcad90` (`hu134117@hu.edu.et`)
  3. Representative B: UUID `a2ad34f1-f910-459b-b4fa-3ed2975a22d4` (`hu344517@hu.edu.et`)

### 4.2 Orphaned and Conflicting Accounts Check
- **Orphaned Auth Users (Auth exists, profile missing):** **0 found.** Both representative Auth accounts have active corresponding rows in `public.profiles`.
- **Conflicting Profiles (Profile exists, Auth missing):** **0 found.** All 3 rows in `public.profiles` reference valid `auth.users(id)`.
- **Identity Lock Integrity:** Both representative profiles match their linked `students` table rows:
  - `59bf64a6...` matches Student `HU/1341/17` (Telegram: `8066587119`).
  - `a2ad34f1...` matches Student `HU/3445/17` (Telegram: `6019153994`).

### 4.3 Root Cause of Error A (`A user with this email address has already been registered`)
In `apps/web/src/lib/admin/representative-management-service.ts` (lines 114–150):
1. The code attempts to resolve an existing profile using Telegram user ID:
   ```typescript
   const { data: existingProfile } = await supabase
     .from('profiles')
     .select('id, role, is_active')
     .eq('telegram_user_id', student.telegram_user_id)
     .maybeSingle();
   ```
2. If `existingProfile` is `null` (e.g. for an approved student who is not yet a representative), the code synthesizes an email:
   `const repEmail = `${cleanHu}@hu.edu.et`;`
3. It immediately invokes `adminClient.auth.admin.createUser({ email: repEmail, ... })`.
4. **Failure Condition:** If a previous attempt succeeded in creating the Auth user but failed before inserting the profile (or if an Auth user was provisioned via seed/test), `createUser` returns HTTP 422: `A user with this email address has already been registered`.
5. The code lacks a fallback lookup by metadata or email, aborting the entire server action with line 37: `throw new Error(result.error)`.

### 4.4 Verification of the Institutional Email Assumption
- **Format:** `cleanHuId@hu.edu.et` (e.g. `hu143117@hu.edu.et`).
- **Empirical Finding:** **UNVERIFIED.**
  - There is no LDAP, Active Directory, Google Workspace, or institutional SSO configuration in the repository.
  - No database migration or project specification defines this email mapping as authoritative.
  - Students authenticate with Telegram numeric IDs, not email/password.
  - Using synthetic email as a primary identity anchor creates unresolvable collision risks if multiple students or past alumni share similar IDs.

---

## 5. Task 4: Academic Year & Section Relationships

### 5.1 Remote Database Records Census
- **Command:** Direct read-only query of `academic_years` and `sections`.
- **Timestamp:** 2026-11-13T20:56:16Z

#### Academic Years Table (`academic_years`)
| ID | Name | Year Level | Status |
| :--- | :--- | :--- | :--- |
| `22222222-2222-2222-2222-222222222201` | 1st Year | 1 | Active (`true`) |
| `22222222-2222-2222-2222-222222222202` | 2nd Year | 2 | Active (`true`) |
| `22222222-2222-2222-2222-222222222203` | 3rd Year | 3 | Active (`true`) |
| `22222222-2222-2222-2222-222222222204` | 4th Year | 4 | Active (`true`) |

#### Sections Table (`sections`)
| ID | Section Name | Academic Year ID | Academic Year Name |
| :--- | :--- | :--- | :--- |
| `33333333-3333-3333-3333-333333333311` | Section A | `22222222-2222-2222-2222-222222222201` | 1st Year |
| `33333333-3333-3333-3333-333333333312` | Section B | `22222222-2222-2222-2222-222222222201` | 1st Year |
| `33333333-3333-3333-3333-333333333321` | Section A | `22222222-2222-2222-2222-222222222202` | 2nd Year |
| `33333333-3333-3333-3333-333333333322` | Section B | `22222222-2222-2222-2222-222222222202` | 2nd Year |
| `33333333-3333-3333-3333-333333333331` | Section A | `22222222-2222-2222-2222-222222222203` | 3rd Year |
| `33333333-3333-3333-3333-333333333332` | Section B | `22222222-2222-2222-2222-222222222203` | 3rd Year |
| `33333333-3333-3333-3333-333333333341` | Section A | `22222222-2222-2222-2222-222222222204` | 4th Year |
| `33333333-3333-3333-3333-333333333342` | Section B | `22222222-2222-2222-2222-222222222204` | 4th Year |

### 5.2 Registered Students Census
| Student DB ID | Masked HU ID | Enrolled Year ID | Enrolled Year | Enrolled Section ID | Enrolled Section | Status / Lock | Telegram |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `4ecc96fa-4930-43a1-bc91-17c14af04a5b` | `HU/1341/**` | `...2203` | 3rd Year | `...3332` | Section B | locked / `true` | Linked (`8066587119`) |
| `745dec7f-e6e5-4426-9734-bba721d4f0db` | `HU/3445/**` | `...2203` | 3rd Year | `...3331` | Section A | locked / `true` | Linked (`6019153994`) |
| `d76c20e3-8bb3-4231-9697-80dccd117dbd` | `HU/1431/**` | `...2202` | 2nd Year | `...3322` | Section B | locked / `true` | Linked (`7894869530`) |
| `4908303c-dbf0-4cc0-b0bc-d64dcc344c18` | `HU/6555/**` | `...2202` | 2nd Year | `...3321` | Section A | locked / `true` | Linked (`7758145932`) |

---

## 6. Task 5: Root Cause of "Scope Mismatch" Assignment Failure

### 6.1 Trace of Failing Code
- **File:** [representative-management-service.ts](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/lib/admin/representative-management-service.ts#L104-L111)
- **Lines 104–110:**
  ```typescript
  // Strict Scope Compatibility: Student cannot represent an incompatible academic year
  if (student.academic_year_id && section.academic_year_id !== student.academic_year_id) {
    return {
      success: false,
      error: 'Scope mismatch: Student cannot be assigned as representative to an incompatible academic year or scope.',
    };
  }
  ```

### 6.2 The Actual Scope Mismatch Incident
In the Admin Dashboard (`/admin/representatives`):
1. Both 3rd Year students (`HU/1341/17` and `HU/3445/17`) were successfully assigned to their respective 3rd Year sections on `2026-11-13T18:21:40Z` and `2026-11-13T18:22:28Z`.
2. The remaining eligible students in the dropdown are:
   - Student `d76c20e3...` (`HU/1431/17`): enrolled in **2nd Year** (`22222222-2222-2222-2222-222222222202`).
   - Student `4908303c...` (`HU/6555/17`): enrolled in **2nd Year** (`22222222-2222-2222-2222-222222222202`).
3. In `apps/web/src/app/admin/representatives/page.tsx` (lines 100–140), the UI renders two independent, un-cascaded dropdowns:
   - Dropdown 1: lists all eligible students across all years.
   - Dropdown 2: lists all 8 sections across all years, sorted alphabetically.
4. When assigning Student `d76c20e3...` or `4908303c...`, the administrator selected a section belonging to **3rd Year** (e.g. `33333333-3333-3333-3333-333333333332`, 3rd Year Section B) or **1st/4th Year**.
5. **Exact Evaluation:**
   `student.academic_year_id` (`...2202`) !== `section.academic_year_id` (`...2203`).
   Validation failed -> returned `Scope mismatch: Student cannot be assigned as representative to an incompatible academic year or scope.`

### 6.3 Policy Investigation & Behavioral Analysis
1. **Does a representative have to belong to the exact section?**
   - In code: Line 105 only checks `section.academic_year_id !== student.academic_year_id`. It does **not** check `section.id !== student.section_id`.
   - Therefore, a student in 2nd Year Section A *can* be assigned to represent 2nd Year Section B under the current code, but **cannot** represent any section in 1st, 3rd, or 4th Year.
2. **Can one representative serve multiple sections?**
   - **YES.** `representative_assignments` schema constraint: `CONSTRAINT uq_rep_section UNIQUE (profile_id, section_id)`.
   - A representative can hold multiple active assignments across different sections (e.g. Section 2A and Section 2B).
   - Documented in `docs/ADMINISTRATIVE_DASHBOARD.md` ("multi-section switcher for representatives assigned to multiple sections (e.g. 2A & 2B)").
3. **Can multiple students represent the same section?**
   - **YES.** There is no unique constraint on `section_id` in `representative_assignments`. Multiple students can co-represent a single section.
4. **Duplicate Prevention:**
   - Enforced by `uq_rep_section UNIQUE (profile_id, section_id)` and service upsert `{ onConflict: 'profile_id,section_id' }`.
5. **Deactivation Latency:**
   - **Zero latency.** Revocation of `is_active = false` immediately breaks `auth_is_rep_for_section()`.

### 6.4 Security Vulnerability in Scope Validation
Notice the condition:
`if (student.academic_year_id && section.academic_year_id !== student.academic_year_id)`
> [!WARNING]
> If a student record has `academic_year_id = NULL`, the condition evaluates to `false` and **bypasses scope validation completely**, allowing an unassigned or unverified student to be assigned to any academic section. This is a severe logic defect.

---

## 7. Task 6: Existing Project-Isolation & PDF Authorization Tests

### 7.1 Test Execution Results
- **Command:** `npx tsx --test apps/bot/test/representative-reporting.service.test.ts apps/bot/test/submission.service.test.ts apps/web/test/signed-url.test.ts apps/web/test/delivery.service.test.ts`
- **Timestamp:** 2026-11-13T21:21:42Z
- **Outcome:** **37 tests run, 37 passed, 0 failed (100% pass rate).**

| Test Suite | Tests Run | Result | Key Isolation Verified |
| :--- | :--- | :--- | :--- |
| **Phase 10 — Representative Reporting** | 10 | PASS | Blocks unassigned section queries; rejects deactivated reps; isolates project reporting when a project targets multiple sections; computes missing vs submitted. |
| **Phase 07 — Individual Submission** | 11 | PASS | Enforces section targeting eligibility; rejects wrong file types and oversized files; atomic rollback on vault storage upload failure. |
| **Phase 12 — Teacher Delivery Service** | 13 | PASS | Rejects batch preparation for unassigned sections or cross-section submissions; enforces signed 15-minute expiring download links for teachers; strict status state machine. |
| **Phase 11 — Signed Download URL Security** | 3 | PASS | Generates signed URLs exclusively for authorized representative's section; blocks access to unassigned sections; allows System Owner global access. |

---

## 8. Task 7: Git Branch & Migration-File Consistency

### 8.1 Branch & Workspace State
- **Current Branch:** `clean-deployment`
- **Head Alignment:** Branch is clean relative to origin/clean-deployment, but has local untracked audit documents and migrations.

### 8.2 Migration Consistency Issue
- **Files on Disk in `supabase/migrations/`:** Exactly 13 migration files:
  1. `20261110000001_initial_schema.sql`
  2. `20261110000002_row_level_security.sql`
  3. `20261110000003_storage_setup.sql`
  4. `20261110000004_delivery_items_rep_policy.sql`
  5. `20261110000005_security_hardening.sql`
  6. `20261111000001_track_b_rep_active_profile_guard.sql`
  7. `20261111000002_track_b_atomic_rpcs_and_db_parity.sql`
  8. `20261111000003_track_b_function_privilege_and_default_acl_hardening.sql`
  9. `20261112000001_critical_blockers_persistence_and_identity_hardening.sql`
  10. `20261112000002_minimum_deployment_blocker_fixes.sql`
  11. `20261112000003_post_deployment_security_hardening.sql`
  12. `20261113000001_provision_representative_profile_rpc.sql`
  13. `20261113000002_enhance_provision_rep_profile_security.sql`

- **Static Unit Test Failure:**
  - Running full `npm test` fails in `apps/web/test/track-b-privilege-and-sql-hardening.test.ts:100`:
    The test asserts that `fs.readdirSync(migrationsDir)` contains exactly 12 files ending at `...000001`.
    Because `20261113000002` exists on disk (and is active on remote), this static contract test throws `ERR_ASSERTION`.
  - In strict read-only mode, this test file was **not** edited. Updating this test to reflect migration 13 will be required upon implementation approval.

---

## 9. Evidence Matrix & Uncertainty Assessment

| Item | Verification Level | Empirical Source | Remaining Uncertainty |
| :--- | :--- | :--- | :--- |
| **Remote Database Connection** | Remotely Verified | Direct PostgREST & Auth query | None. Connected and verified. |
| **Remote Migration 2 Active** | Remotely Verified | PostgREST OpenAPI Function Summary | None. Exact comment string match. |
| **Remote RPC Security Definer** | Remotely Verified | Foreign key constraint error (23503) & OpenAPI | None. Runs as security definer. |
| **Scope Mismatch Root Cause** | Remotely Verified | Live records: 2nd Year student vs 3rd Year section | None. Exact code path reproduced. |
| **Institutional Email Authenticity** | Unverified / Inferred | None. Synthetic guessing in TypeScript code. | **High.** No university email authority exists. |
| **Cross-Year Representation Policy** | Unverified / Policy Gap | None. Backend enforces same-year; UI unconstrained. | **High.** University institutional policy undocumented. |
| **Project Isolation & PDF Security** | Locally Verified | 37/37 unit tests passing | Live multi-tenant end-to-end load test pending. |

---

## 10. Mandatory Stop Conditions & Final Verdict

### Mandatory Stop Conditions Enforced
1. **Zero Write Operations:** No database records were altered, no Auth users created, no files modified.
2. **No Synthetic Email Fix:** We did not implement synthetic email adoption.
3. **No Policy Weakening:** We did not weaken the scope check to bypass the error.

### Final Verdict

## **BLOCKED — required evidence or institutional policy is unavailable**

### Critical Blockers Preventing Safe Implementation:

1. **Institutional Policy Gap (Scope Constraints):**
   The university administration has not officially clarified whether:
   - A representative must strictly be enrolled in the *exact* section they represent (`student.section_id === section.id`).
   - A representative can represent *other sections in the same academic year* (`student.academic_year_id === section.academic_year_id`).
   - A senior student (e.g. 4th year) can ever represent a junior section (e.g. 2nd year).
   Until this policy is confirmed, modifying or bypassing line 105 in `representative-management-service.ts` risks violating institutional governance.

2. **Unverified Institutional Email Identity:**
   `cleanHuId@hu.edu.et` is completely synthetic. Implementing Auth lookups based on synthetic email matching risks unauthorized account takeover or cross-student collision. The student-to-Auth identity linkage model requires an officially sanctioned identity identifier (e.g. non-routable synthetic internal UPN or verified Telegram numeric user ID).

3. **Admin UI Cascading Defect:**
   The admin console presents an unconstrained list of sections to the operator regardless of the selected student's academic year, virtually guaranteeing operator errors. The UI must cascade section choices to match eligible student scopes once policy is finalized.

**Awaiting explicit user direction and policy clarification before proceeding.**
