# HU-ASMS — Track B Final Pre-Deployment Security & Architecture Review

- **Date:** 2026-11-11
- **Branch:** `phase-14-security-hardening`
- **HEAD Commit:** `6e2c5f8` *(Read-only review; zero commits, pushes, merges, migration pushes, or Vercel deployments executed)*
- **Freeze Status:** **Deployment Freeze Active**
- **Scope:** Strictly read-only final review across five mandated areas following Track A1, Track B security hardening, interrupted-work recovery, and Track B local corrections.

---

## Executive Verdict

Track A1, Track B, and the Track B local corrections substantively resolved the critical Phase 14 security and configuration blockers in the Next.js web application (`apps/web`): fail-open middleware behavior was removed, `system_owner` role naming and `is_active === true` profile enforcement were unified, representative section-scope and input validation guards were added across pages and Server Actions, registration approval/rejection handlers detect zero-row race updates, delivery status updates invoke scoped audit logging and rollback helpers, `rate-limiter.ts` avoids open background timer handles via bounded inline cleanup, and the root UTF-8 BOM `vercel.json` was replaced with `apps/web/vercel.json`.

**Remaining Findings:** All remaining issues fall into **(a) pre-deployment operational steps** (staging/committing the working tree selectively, pushing pending local migration `20261111000001_track_b_rep_active_profile_guard.sql` to Supabase, setting Vercel Root Directory = `apps/web`) and **(b) non-atomic multi-step application writes & database-level defense-in-depth gaps** that should be understood explicitly before lifting the freeze or connecting automated external dispatch:

1. **External Delivery & Compensation (`delivery-service.ts`):** Today, `apps/web` performs **no automated Telegram/SMTP dispatch**; representatives mint 15-minute signed URLs via `Manifest` and forward manually before clicking `Mark Sent`. Reverting `deliveries.status` from `'sent'` back to `'prepared'` on an audit failure misrepresents an already-completed external handover, and would cause **duplicate sends on retry** if automated external dispatch is later wired in without a monotonic state machine (`dispatching`) and idempotency key.
2. **Student Approval Concurrency (`student-approval-service.ts`):** Sequential SSR `authenticated` PostgREST calls (`students.insert` with `'locked'` followed by conditional `registration_requests.update`) remain vulnerable to transient orphaned students, raw `23505` duplicate violations on concurrent approve, zero `audit_logs` attribution, and **FK `23503` rollback failure** in `compensateCreatedStudent` (`ON DELETE RESTRICT` on `submissions.student_id` and `submission_members.student_id`) if an approved student submits via the Telegram bot during the window between those two requests.
3. **Database RLS & Constraint Parity:** Several workflow invariants enforced in TypeScript services (`project_targets`, `projects.is_active`, `deliveries.teacher_id`/`course_id`/`batch_count`, `delivery_items` matching `submissions.section_id`/`project_id`/`status`, `group_members` confirmation/section/size bounds) are **not enforced by PostgreSQL constraints or RLS policies** against direct PostgREST mutations with a valid representative JWT, and migration `20261111000001` is not yet applied remotely.
4. **Rate Limiter (`rate-limiter.ts`):** Request-driven inline pruning eliminates background timer leaks, but state remains isolate-local across serverless instances, unauthenticated `:unauth` fallback keys share a per-instance bucket, and saturation at `DEFAULT_MAX_ENTRIES = 10_000` unexpired keys triggers an `O(N)` map scan per new key.
5. **Working-Tree Hygiene:** Full `git status` contains **52 pre-existing dirty entries** (`1` deleted, `39` modified, `12` untracked — including preserved `supabase/seed.sql` and `apps/web/tsconfig.tsbuildinfo`), reconciling the **8 tracked files** isolated in `docs/TRACK_B_LOCAL_CORRECTIONS.md`.

> Throughout this document, **Verified Facts** reflect code, schemas, git state, and tool outputs directly inspected in the workspace; **Recommendations / Future Work** identify proposed remediations and hypothetical failure modes under future changes (such as automated dispatch).

---

## 1. Confirmed Baseline Improvements (Track A1 + Track B + Local Corrections)

### Verified Facts
- **Track A1 (Vercel Monorepo Configuration):** Deleted BOM-corrupted root `vercel.json`, added `apps/web/vercel.json`, updated `apps/web/next.config.mjs`, added regression suite `apps/web/test/track-a1-vercel.test.ts`, and documented Vercel Root Directory = `apps/web` in `docs/SYSTEM_ARCHITECTURE.md`.
- **Auth, Middleware & Role Consistency:**
  - Eliminated fail-open behavior via `apps/web/src/middleware.ts` and `apps/web/src/lib/auth/middleware-guard.ts`.
  - Standardized `system_owner` (removing `owner` mismatch) across `apps/web/src/lib/auth/roles.ts`, `role-policy.ts`, `page-guards.ts`, `apps/web/test/auth-roles.test.ts`, and `docs/ADMINISTRATIVE_DASHBOARD.md`.
  - Enforced explicit `profile.is_active === true` checks in `assertSystemOwner`, `assertRepresentativeSectionScope`, and `resolveAuthorizedSectionScope`.
  - Protected all `/admin/*` pages, Server Actions (`approveRegistration`, `rejectRegistration`), and `/rep/*` pages (including UUID validation and `project_targets` scope checks in `apps/web/src/app/rep/reports/page.tsx` lines `24-69` rendered via `ScopeAccessError`).
- **Track B Security Hardening & Local Corrections:**
  - Added UUID/batch validation helpers (`apps/web/src/lib/rep/input-validation.ts`), rate limiting (`rate-limiter.ts`), null narrowing in `submission-file-service.ts`, empty-row concurrent detection and rollback helper in `student-approval-service.ts`, representative scope guards in `group-precreation-service.ts` and `delivery-service.ts`, and scoped audit logging (`apps/web/src/lib/rep/audit-helper.ts` -> `record_scoped_audit_log`).
  - Created local database migration `supabase/migrations/20261111000001_track_b_rep_active_profile_guard.sql` adding `profiles.is_active = true` + role checks to `auth_is_rep_for_section` and `auth_get_assigned_section_ids`.

---

## 2. Review Area 1 — External Delivery & Compensation Safety

### Verified Execution & Dispatch Order
Inspected across `apps/web/src/lib/rep/delivery-service.ts`, `apps/web/src/app/rep/deliveries/actions.ts`, `apps/web/src/app/rep/deliveries/page.tsx`, `apps/web/src/app/rep/deliveries/delivery-actions-client.tsx`, `apps/web/src/app/rep/deliveries/new/page.tsx`, `apps/web/src/app/rep/deliveries/new/delivery-form.tsx`, and `apps/bot/src/services/notification.service.ts`:

1. **Batch Creation (`executePrepareDeliveryBatch`):**
   - Validates actor (`assertRepresentativeSectionScope`), rate limits, UUIDs (`validateDeliveryBatchUuids`), project/teacher/course alignment, and active submissions.
   - Inserts `deliveries` with `status: 'prepared'` and inserts linked rows into `delivery_items`.
   - Calls `writeScopedAuditLog`. If `delivery_items` insertion or audit logging fails, invokes `compensateCreatedDelivery` to delete the newly created batch.
   - **Observed gaps in batch tracking:** Neither `executePrepareDeliveryBatch` nor `executeDispatchDelivery` transitions `submissions.status` to `'delivered'`, and multiple `'prepared'` batches can include overlapping `submission_id` values.
2. **External Handover (Manual Out-of-Band UI Flow in `DeliveryActionsClient`):**
   - Representative clicks **`Manifest`** -> calls `executeGetDeliveryPackageManifest` to mint **15-minute signed URLs** for submission files.
   - Representative manually uses **`Copy Formatted Manifest for Telegram`** (`copyTelegramText`) or `Test Link` to transmit packages externally to the instructor via Telegram, email, or in-person handover.
   - Representative **subsequently** clicks **`Mark Sent`** (rendered in `delivery-actions-client.tsx` when `delivery.status === 'prepared'`).
3. **Dispatch Confirmation (`executeDispatchDelivery`) & Compensation:**
   - Verifies rate limit, scope, and current `'prepared'` status.
   - Updates `deliveries.status` from `'prepared'` -> `'sent'`.
   - Calls `writeScopedAuditLog` (`record_scoped_audit_log` RPC).
   - **No automated external Telegram Bot API or SMTP/email dispatch runs inside `apps/web`** during `executePrepareDeliveryBatch`, `executeDispatchDelivery`, or `executeAcknowledgeDelivery`. (`apps/bot/src/services/notification.service.ts` is separate bot notification code and is not invoked by web delivery actions.)
   - If `writeScopedAuditLog` throws or returns an error after the DB status update succeeds, `executeDispatchDelivery` invokes `compensateDeliveryStatusRevert`, issuing an update reverting `deliveries.status` back to `'prepared'`.

### Safety & Duplicate-Send Analysis
- **Confirmed Defect in Current Manual Flow (False State Revert):** Because external file handover to the instructor has *already happened* out-of-band before the representative clicks `Mark Sent`, a failed `writeScopedAuditLog` call causes `compensateDeliveryStatusRevert` to reset `deliveries.status` to `'prepared'`. The database state then falsely indicates the delivery was never sent, even though the signed-URL manifest/package has already left the system and cannot be recalled. Moreover, if the audit failure stemmed from transient network/DB loss, the compensating revert itself can also fail, leaving inconsistent state.
- **Confirmed Duplicate-Send Risk Under Future Automated Dispatch (Recommendation Context):** If automated Telegram or email delivery is later introduced inside or before `executeDispatchDelivery`'s DB status update + audit step, calling `compensateDeliveryStatusRevert` to restore `status = 'prepared'` after external transport succeeds leaves the **`Mark Sent`** button active in `DeliveryActionsClient` (`delivery.status === 'prepared'`). Retrying `Mark Sent` would re-dispatch identical files to the instructor.

### Recommended Safe State Model & Idempotency Design (Not Implemented)
1. **Current Manual Confirmation Flow:** Replace the two-request status update + `compensateDeliveryStatusRevert` pattern with a single atomic PostgreSQL `SECURITY DEFINER` RPC (`mark_delivery_sent_with_audit`) that transitions `deliveries` (`WHERE id = p_delivery_id AND status = 'prepared'`) and writes `audit_logs` in one transaction — removing any need to revert `'sent'` back to `'prepared'`.
2. **Future Automated External Dispatch (Telegram/Email):**
   - Introduce explicit monotonic states: `prepared` -> `dispatching` -> `sent` | `failed` | `reconciliation_required` -> `acknowledged`.
   - Persist a deterministic `idempotency_key` (e.g., `delivery:{delivery_id}:v{attempt}`) and transition `prepared -> dispatching` in the database *before* executing any external API/SMTP I/O.
   - Never revert automatically from `dispatching` or `sent` back to `prepared` after an external send begins. If DB persistence or audit recording fails *after* external transmission succeeds, mark `reconciliation_required` rather than allowing blind re-dispatch.
   - Transition `submissions.status = 'delivered'` and enforce an exclusion/unique rule preventing multiple active/`sent` `delivery_items` rows from re-delivering the same `submission_id` concurrently unless explicitly allowed for re-delivery.

---

## 3. Review Area 2 — Student Approval Transaction Integrity

### Verified Implementation
Inspected across `apps/web/src/lib/admin/student-approval-service.ts`, `apps/web/src/app/admin/students/page.tsx`, `apps/web/src/lib/supabase/server.ts`, `apps/bot/src/services/submission.service.ts` (`L63-87`), and `supabase/migrations/20261110000001_initial_schema.sql`:

1. **Execution Context:** `approveRegistration` and `rejectRegistration` in `apps/web/src/app/admin/students/page.tsx` create an SSR Supabase client (`createServerSupabaseClient`) using `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, executing as `authenticated` under RLS.
2. **Two-Step Write Sequence in `executeApproveRegistration`:**
   - Reads `registration_requests` by ID (confirming `'pending'`).
   - Line `85`: Inserts a row into `public.students` with `registration_status: 'locked'` and `is_locked: true`.
   - Line `108`: Conditionally updates `public.registration_requests` (`SET status = 'approved' ... WHERE id = ... AND status = 'pending'`) with `.select('id')` to detect zero-row concurrent modification.
   - If the conditional update affects zero rows, `compensateCreatedStudent` calls `students.delete().eq('id', studentId)`.
   - Neither `executeApproveRegistration` nor `executeRejectRegistration` writes to `public.audit_logs` (because `INSERT` on `public.audit_logs` is revoked from `authenticated` in Migration `05`, and `record_scoped_audit_log` does not support registration actions).

### Confirmed Concurrency & Rollback Risks
1. **FK Constraint `23503` Can Block `compensateCreatedStudent`:**
   - Schema inspection (`20261110000001_initial_schema.sql`): `submissions.student_id` (`L429`) and `submission_members.student_id` (`L482`) use **`ON DELETE RESTRICT`** (whereas `groups.group_leader_id` uses `ON DELETE SET NULL` and `group_members` / `identity_change_*` use `ON DELETE CASCADE`).
   - Bot eligibility inspection (`apps/bot/src/services/submission.service.ts` `L69-87`): `submitIndividualAssignment` looks up `students` by `telegram_user_id` and blocks `student.registration_status === 'suspended'`, allowing `'locked'` students to submit immediately.
   - **Result:** If a student invokes the Telegram bot submission flow inside the race window after `students.insert` (`L85`, `'locked'`) succeeds and creates a `submissions` / `submission_members` row before `registration_requests.update` (`L108`) finds zero `'pending'` rows (e.g., due to a parallel rejection), `compensateCreatedStudent` (`students.delete()`) fails with PostgreSQL `23503` FK violation, leaving both an active student+submission and an inconsistent registration request state.
2. **Process Crash / Transient Network Disconnect Window:** Any crash or network timeout between `students.insert` (`L85`) and `registration_requests.update` (`L108`) leaves a committed locked `students` row alongside an unreviewed `'pending'` `registration_requests` row.
3. **Concurrent Double-Approve Unique Violation & Missing Pending Index:** Two simultaneous `approveRegistration` calls that both read `'pending'` race into `students.insert`; the second hits a raw PostgreSQL `23505` unique constraint violation (`hu_student_id` / `telegram_user_id`). Additionally, `registration_requests` has no partial unique index constraining multiple `'pending'` requests for the same identity.
4. **Missing Immutable Audit Record:** Registration approvals and rejections produce no immutable entry in `public.audit_logs`.

### Recommended Transactional RPC Solution (Existing Draft Verified in `docs/SECURITY_AND_HARDENING.md`)
- `docs/SECURITY_AND_HARDENING.md` (`L142-276`) already defines the recommended PostgreSQL transactional RPC **`public.approve_student_registration(p_request_id UUID, p_notes TEXT DEFAULT NULL)`** (`SECURITY DEFINER`, `SET search_path = ''`, owner `postgres`):
  - Derives actor exclusively from `auth.uid()` and enforces `public.auth_is_system_owner()`.
  - Locks the request row via `SELECT * INTO v_req FROM public.registration_requests rr WHERE rr.id = p_request_id FOR UPDATE;` to serialize concurrent reviewers.
  - Verifies `v_req.status = 'pending'` and checks `public.students` for existing `hu_student_id` or `telegram_user_id`.
  - Atomically executes `INSERT INTO public.students (...)`, `UPDATE public.registration_requests ... WHERE id = p_request_id AND status = 'pending'`, and `INSERT INTO public.audit_logs (... action = 'STUDENT_REGISTRATION_APPROVED' ...)` within a single transaction, eliminating application-level `compensateCreatedStudent` rollback completely.
- **Additional Recommendations:** Add a companion `public.reject_student_registration(p_request_id UUID, p_notes TEXT)` `SECURITY DEFINER` RPC (with `FOR UPDATE` row locking and `audit_logs` write) plus a partial unique index on `registration_requests` covering `status = 'pending'`.

---

## 4. Review Area 3 — Group & Delivery Authorization: Service Layer vs Database RLS

All application routes use cookie-authenticated SSR clients (`authenticated` role under RLS) backed by service-layer authorization checks. The comparison below documents where database RLS, triggers, and schema constraints back up those service checks versus where direct PostgREST access with a representative JWT would bypass service-only rules:

| Invariant / Control | Service & UI Layer (Verified) | PostgreSQL RLS / Schema / Migration State (Verified) | Risk Under Direct PostgREST Call |
|---|---|---|---|
| **Active profile on rep RLS helpers** | `roles.ts` enforces `profile.is_active === true` & staff role | Staged locally in `20261111000001_track_b_rep_active_profile_guard.sql`; **NOT YET PUSHED remotely** | Remote DB still reflects pre-Track-B helper definitions until `20261111000001` is applied |
| **Catalog `SELECT` policies (`auth_read_*`)** | Pages validate active session/profile before rendering | `departments`, `academic_years`, `sections`, `courses`, `teachers`, `projects`, `project_targets`, `project_file_rules` use `USING (true)` for `authenticated` | Any authenticated JWT can read academic catalog metadata directly |
| **`groups` & `deliveries` project targeting & `projects.is_active`** | Enforced in `group-precreation-service.ts`, `delivery-service.ts`, `/rep/reports/page.tsx` (`L58-69`) | RLS checks only `auth_is_rep_for_section(section_id)`; no DB constraint or trigger enforces `project_targets` membership or `projects.is_active = true` | Active rep can insert a group/delivery for an untargeted or inactive project directly via PostgREST |
| **`deliveries` teacher/course parity & `batch_count`** | Enforced in `delivery-service.ts` | No DB FK/trigger verifies `deliveries.teacher_id = projects.teacher_id`, `deliveries.course_id = projects.course_id`, `teachers.is_active`, or `batch_count` parity | Mismatched teacher/course or `batch_count` can be persisted directly via PostgREST |
| **`delivery_items` section/project/status binding** | Enforced in `delivery-service.ts` | Migration `04` (`rep_manage_section_delivery_items` in `20261110000004_delivery_items_rep_policy.sql`) checks **only** `deliveries.section_id` (`auth_is_rep_for_section`); no check binds `submissions.section_id`, `submissions.project_id`, or `submissions.status = 'active'` | Active rep could insert `delivery_items` pointing at foreign-section/inactive `submission_id` UUIDs (note: `submissions`, `submission_files`, and `storage.objects` SELECT RLS still block cross-section file reads) |
| **Single group per project / code / member uniqueness** | Enforced in `group-precreation-service.ts` | **Backed by DB:** `trg_enforce_single_group_per_project`, `uq_group_code_project_section`, `uq_member_per_group` exist in Migration `01` | Protected at database level |
| **`group_members` student section, status, group size, confirmation** | Enforced in `group-precreation-service.ts` | No DB check enforces `students.section_id = groups.section_id`, approved/locked status, `min_group_size`/`max_group_size`, or prevents reps with `FOR ALL` RLS on `group_members` from setting `confirmation_status = 'confirmed'` directly | Active rep could bypass member confirmation/size/section bounds via PostgREST |

---

## 5. Review Area 4 — Rate Limiter Lifecycle & Vercel Serverless Risks

Inspected line-by-line in `apps/web/src/lib/security/rate-limiter.ts` (`L1-138`):

### Verified Mechanics
- **Lifecycle:** Uses **request-driven inline cleanup** via `pruneExpired(now)` invoked during checks (every `60_000ms` or when map size reaches `DEFAULT_MAX_ENTRIES = 10_000`), plus oldest-key (LRU) eviction if capacity remains full after pruning expired entries.
- **No Timer Leak:** Allocates **no `setInterval` handle**, avoiding open-handle hangs in Node/test runners and frozen background timers in serverless runtimes.
- **Coverage:** Reported at `100.00%` line coverage in the preceding coverage run (`apps/web/test/audit-and-ratelimit-wiring.test.ts` & `security-hardening.test.ts`).

### Confirmed Operational Risks on Vercel / Serverless
1. **Isolate-Local State (Horizontal & Cold-Start Bypass):** Counters live solely inside per-instance JS `Map` memory (`globalWebRateLimiter`, matching the limitation already documented in `docs/SECURITY_AND_HARDENING.md` `L128-129`). Across `$N$` concurrent serverless/Edge instances or container recycles, burst limits multiply by up to `$N$` and reset on cold starts.
2. **Shared `:unauth` Bucket Collision:** Callers invoking `assertRateLimit` on unauthenticated fallback keys (`rep-delivery:unauth`, `admin-reg-review:unauth`, `rep-group:unauth`, `signed-url:unauth`, `rep-delivery-manifest:unauth`) share a single per-instance counter per prefix. Unauthenticated floods on one instance can exhaust the `:unauth` bucket for other unauthenticated callers landing on that same warm instance.
3. **`O(N)` Synchronous Scan at Saturated Capacity:** If 10,000 distinct unexpired keys accumulate in a single long-lived container, every subsequent distinct key hits capacity, triggers `pruneExpired(now)` across the 10,000 entries synchronously, and then evicts the oldest entry. Warm idle instances also retain populated entries until recycled or hit by another request.

### Recommendations
- Keep the current bounded inline limiter for baseline single-instance protection, and split unauthenticated throttling keys by trusted client IP (`x-forwarded-for` / Vercel header) + action instead of sharing a single `:unauth` key.
- Before multi-instance production scaling, implement the shared `RateLimitStore` adapter documented in `docs/SECURITY_AND_HARDENING.md` (`L131-138`: Upstash Redis REST API or PostgreSQL `SECURITY DEFINER` fixed/sliding-window bucket table).

---

## 6. Local Verification Status & Honest Scope

### Executed During This Read-Only Review Turn
- `npm test`: executed after writing this review file (results recorded in final verification summary and run ledger).
- `git diff --check`: verified zero whitespace/conflict-marker errors.
- `git status --short --untracked-files=all`: verified no source, test, config, seed, or migration files were modified during this review.

### Preceding Remediation Baseline *(From Pre-Freeze Local Validation; Re-check Skipped for Build/Typecheck to Avoid Writing `tsconfig.tsbuildinfo` / `.next`)*
- `npm run typecheck`: exit `0` across all 6 workspaces (`@hu-asms/bot`, `@hu-asms/web`, `@hu-asms/database`, `@hu-asms/shared`, `@hu-asms/types`, `@hu-asms/validation`). *(Note: root/workspace `lint` also runs `tsc --noEmit`, not standalone ESLint.)*
- `npm run test:coverage`: exit `0`, `199/199` tests passing across `61` suites (`@hu-asms/bot`: `88`/`27`, `@hu-asms/web`: `96`/`24`, `@hu-asms/database`: `15`/`10`; `0` failed, `0` skipped); `76.05%` line / `74.67%` branch / `72.29%` function overall (`rate-limiter.ts`: `100.00%` line; `delivery-service.ts`: `96.29%` line; `group-precreation-service.ts`: `94.21%` line; `student-approval-service.ts`: `92.86%` line; `submission-file-service.ts`: `90.72%` line). Tests run against mocked Supabase/Next.js dependencies rather than live Supabase/Vercel instances.
- `npm run build`: exit `0`; `tsc` built `types`, `shared`, `validation`, `database`, `bot`, and `next build` (`Next.js 15.5.29`) built `21/21` routes + `95 kB` Middleware in `7.8s`.

---

## 7. Reconciled Git Working-Tree Inventory

### Why Earlier Notes Cited `8` Modified Files vs `52` Pre-Existing `git status` Entries
- `docs/TRACK_B_LOCAL_CORRECTIONS.md` scoped its tracked `git diff --stat` report strictly to the **8 tracked files edited in the local-corrections pass** (`4` service/security files + `4` test files, `+1697/-375` at the time), alongside `3` untracked files touched/added in that pass (`student-approval-service.ts`, `track-b-security.test.ts`, `TRACK_B_LOCAL_CORRECTIONS.md`).
- The full working tree on `phase-14-security-hardening` (`6e2c5f8`) retained **all accumulated uncommitted changes** from Track A1, Track B security hardening, interrupted-work recovery, pre-existing preserved files, and Track B local corrections: **`40` tracked changes** (`1` deleted, `39` modified; `git diff --shortstat`: `40 files changed, 2391 insertions(+), 562 deletions(-)`) + **`12` untracked files** = **`52` entries** prior to creating `docs/TRACK_B_FINAL_REVIEW.md` (**`53` total after adding this report**).

### Complete Breakdown of All `52` Pre-Existing Entries (`+ 1` New Review Report = `53`)

1. **Deleted Tracked (`1`):**
   - `vercel.json` *(root UTF-8 BOM config removed in Track A1; replaced by `apps/web/vercel.json`)*

2. **Preserved Pre-Existing User / Build Cache Modified (`2`):**
   - `supabase/seed.sql` *(line `136`: local seed contact/representative adjustment `'1341/17'`, `'Hamza Teha(Representative)'`, `'+251965614501'`)*
   - `apps/web/tsconfig.tsbuildinfo` *(2-line incremental TS build-cache delta from prior `npm run build`/`typecheck`)*

3. **Track A1 — Vercel & Monorepo Configuration (`2` modified tracked + `2` untracked = `4`):**
   - Modified: `apps/web/next.config.mjs`, `docs/SYSTEM_ARCHITECTURE.md`
   - Untracked: `apps/web/vercel.json`, `apps/web/test/track-a1-vercel.test.ts`

4. **Track B Local Corrections Pass (`8` modified tracked + `3` untracked = `11`):**
   - Modified Source (`4`): `apps/web/src/lib/rep/delivery-service.ts`, `apps/web/src/lib/rep/group-precreation-service.ts`, `apps/web/src/lib/rep/submission-file-service.ts`, `apps/web/src/lib/security/rate-limiter.ts`
   - Modified Tests (`4`): `apps/web/test/audit-and-ratelimit-wiring.test.ts`, `apps/web/test/delivery.service.test.ts`, `apps/web/test/group-precreation.service.test.ts`, `apps/web/test/security-hardening.test.ts`
   - Untracked (`3`): `apps/web/src/lib/admin/student-approval-service.ts`, `apps/web/test/track-b-security.test.ts`, `docs/TRACK_B_LOCAL_CORRECTIONS.md`

5. **Prior Track B Hardening, Recovery & Audit Remediation (`27` modified tracked + `7` untracked = `34`):**
   - Modified Validation & Auth (`3`): `packages/validation/src/index.ts`, `apps/web/src/lib/auth/roles.ts`, `apps/web/src/middleware.ts`
   - Modified Auth/Admin Pages (`9`): `apps/web/src/app/(auth)/login/page.tsx`, `apps/web/src/app/admin/layout.tsx`, `apps/web/src/app/admin/page.tsx`, `apps/web/src/app/admin/academics/page.tsx`, `apps/web/src/app/admin/academics/projects/page.tsx`, `apps/web/src/app/admin/audit-logs/page.tsx`, `apps/web/src/app/admin/representatives/page.tsx`, `apps/web/src/app/admin/structure/page.tsx`, `apps/web/src/app/admin/students/page.tsx`
   - Modified Representative Pages & Actions (`12`): `apps/web/src/app/rep/layout.tsx`, `apps/web/src/app/rep/page.tsx`, `apps/web/src/app/rep/deliveries/actions.ts`, `apps/web/src/app/rep/deliveries/new/page.tsx`, `apps/web/src/app/rep/deliveries/page.tsx`, `apps/web/src/app/rep/groups/actions.ts`, `apps/web/src/app/rep/groups/new/page.tsx`, `apps/web/src/app/rep/groups/page.tsx`, `apps/web/src/app/rep/reports/page.tsx`, `apps/web/src/app/rep/students/page.tsx`, `apps/web/src/app/rep/submissions/actions.ts`, `apps/web/src/app/rep/submissions/page.tsx`
   - Modified Tests & Docs (`3`): `apps/web/test/auth-roles.test.ts`, `docs/ADMINISTRATIVE_DASHBOARD.md`, `docs/SECURITY_AND_HARDENING.md`
   - Untracked (`7`): `apps/web/src/components/rep/scope-access-error.tsx`, `apps/web/src/lib/auth/middleware-guard.ts`, `apps/web/src/lib/auth/page-guards.ts`, `apps/web/src/lib/auth/role-policy.ts`, `apps/web/src/lib/rep/input-validation.ts`, `docs/INTERRUPTED_WORK_RECOVERY_REPORT.md`, `supabase/migrations/20261111000001_track_b_rep_active_profile_guard.sql`

6. **Created During This Final Read-Only Review (`1` untracked):**
   - `docs/TRACK_B_FINAL_REVIEW.md`

---

## 8. Prioritized Recommended Next Actions (Require Explicit Authorization)

### Immediate — Before Lifting Deployment Freeze
1. **Selective Git Staging & Commit Boundary:** Confirm whether `supabase/seed.sql` (`L136`) and `apps/web/tsconfig.tsbuildinfo` belong in their own separate housekeeping/seed commit or stay unstaged; then commit Track A1 (`vercel.json` deletion + `apps/web/vercel.json`, `next.config.mjs`, `track-a1-vercel.test.ts`, `SYSTEM_ARCHITECTURE.md`) and Track B hardening/migration/docs cleanly on `phase-14-security-hardening`.
2. **Apply Pending Supabase Migration `20261111000001`:** Authorize and run Supabase migration push so live `auth_is_rep_for_section` and `auth_get_assigned_section_ids` enforce `profiles.is_active = true` and staff roles consistently with application services, then re-verify remote `supabase_migrations.schema_migrations`.
3. **Configure Vercel Monorepo Root Directory:** Set Vercel Project **Root Directory** to **`apps/web`** before deploying `phase-14-security-hardening`.

### Next Hardening Milestone — Architectural & DB Parity Improvements
4. **Deploy Transactional `SECURITY DEFINER` RPCs for Approvals & Manual Delivery Confirmation:**
   - Implement `public.approve_student_registration` (drafted in `docs/SECURITY_AND_HARDENING.md` `L168-276`), `public.reject_student_registration`, and a partial unique index for `'pending'` rows in `registration_requests`.
   - Implement `public.mark_delivery_sent_with_audit` so manual delivery confirmation and `audit_logs` insertion commit atomically without reverting `'sent'` -> `'prepared'`.
5. **Close Direct-PostgREST Schema / RLS Gaps:** Add DB triggers/constraints enforcing `delivery_items` section/project/`active` binding, `deliveries` project-target/teacher/course/`batch_count` parity, and `group_members` section/status/size/confirmation constraints (plus evaluate `is_active` gating on `auth_read_*` if required).
6. **Before Connecting Automated External Delivery Dispatch:** Add `dispatching` / `failed` / `reconciliation_required` states and a persistent `idempotency_key` before any external Telegram/email call executes.
7. **Before Multi-Instance Load Scaling:** Move `rate-limiter.ts` from process-local `Map` storage to shared Upstash Redis REST or Supabase DB rate-limit RPC, and replace `:unauth` fallback buckets with IP-scoped keys.
