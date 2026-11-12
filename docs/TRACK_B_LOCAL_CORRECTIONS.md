# HU-ASMS — Track B Local Security & Workflow Corrections Report

**Date:** 2026-11-11  
**Branch:** `phase-14-security-hardening` (local working tree only — uncommitted, unpushed)  
**Scope:** Authorized local code, focused regression tests, and technical documentation only  

---

## 1. Confirmed Defects Addressed & Corrections Implemented

### A. Student Registration Approval & Rejection (`apps/web/src/lib/admin/student-approval-service.ts`)
- **Confirmed Defect:** Conditional updates against `registration_requests` (`.eq('id', cleanRequestId).eq('status', 'pending')`) previously ignored affected row counts (`count`/`data`), allowing concurrent updates that matched 0 rows to still return `{ success: true }` and potentially leaving an orphaned `students` row inserted prior to the status update.
- **Correction Implemented:**
  - Added `.select('id')` to the conditional `.eq('id', cleanRequestId).eq('status', 'pending')` update in both `executeApproveRegistration` and `executeRejectRegistration`.
  - Both flows now reject 0-row updates explicitly (`Registration request is no longer pending or was concurrently processed.`).
  - Added best-effort compensating cleanup (`compensateCreatedStudent`, deleting the newly inserted `students` row by `id`) inside `executeApproveRegistration` whenever `registration_requests` update fails or affects 0 rows.
  - Updated the file header comment to document that true ACID transaction atomicity (`SELECT ... FOR UPDATE`, atomic `students` creation + status transition + `audit_logs` write) still requires a dedicated PostgreSQL RPC in a future approved migration.

### B. Delivery Preparation & Lifecycle Integrity (`apps/web/src/lib/rep/delivery-service.ts`)
- **Confirmed Defects:**
  1. Inactive/unassigned actor profiles were not rejected explicitly prior to rate limiting and DB queries.
  2. Service-layer functions did not validate canonical UUID inputs (`sectionId`, `projectId`, `teacherId`, `submissionIds`, `deliveryId`) independently of Server Action wrappers.
  3. `executePrepareDeliveryBatch` allowed invalid channels, duplicate `submissionIds`, inactive projects, projects not targeted to `(academic_year_id, section_id)`, mismatched `teacherId`, inactive/missing `teachers`, and non-active `submissions` (`superseded` / `delivered`).
  4. `executeDispatchDelivery` and `executeAcknowledgeDelivery` lacked strict state transitions (`prepared -> sent -> acknowledged`) and 0-row concurrent update detection.
  5. Sequential PostgREST steps (`deliveries` -> `delivery_items` -> `writeScopedAuditLog`) could leave orphaned or un-audited records on failure.
- **Corrections Implemented:**
  - Added `validateActiveDeliveryActor` to enforce active staff profile (`is_active === true`), verified owner/representative role, and non-empty active section assignment before rate limiting or DB reads.
  - Enforced service-layer UUID validation (`validateDeliveryBatchUuids`, `isValidUuid(deliveryId)`) before DB reads, plus channel allowlist (`telegram`, `email`, `in_person`) and duplicate `submissionIds` rejection.
  - Added `sections`, `projects` (`is_active === true`, `isProjectTargetedToSection`, `project.teacher_id === cleanTeacherId`), `teachers` (`is_active === true`), and `submissions` (`section_id`, `project_id`, `status === 'active'`) checks.
  - Enforced strict state transitions (`prepared` before dispatch, `sent` before acknowledgment) with conditional `.eq('status', ...).select('id')` 0-row concurrency detection.
  - Added best-effort compensating cleanup (`compensateCreatedDelivery` deleting the created `deliveries` header on `delivery_items` or audit failure; `compensateDeliveryStatusRevert` restoring prior status/notes on dispatch/acknowledge audit failure).

### C. Delivery Manifest & Submission Download Authorization (`apps/web/src/lib/rep/delivery-service.ts`, `apps/web/src/lib/rep/submission-file-service.ts`)
- **Confirmed Defects:**
  - `executeGetSubmissionFileDownloadUrl` did not enforce active profile, role, non-empty section assignments, or valid UUID before querying `submission_files`, nor guard against blank `file.storage_path`.
  - `executeGetDeliveryPackageManifest` did not validate `deliveryId` UUID, empty `delivery.items`, `batch_count` mismatch, missing/mismatched `sub.section_id`, or `sub.project_id` mismatch against `delivery.project_id`, and picked `sub.files[0]` without deterministic sorting.
- **Corrections Implemented:**
  - Hardened `executeGetSubmissionFileDownloadUrl` to run pre-query actor, active profile, non-empty assignment, rate-limit, and UUID checks prior to querying `submission_files`, plus non-empty `file.storage_path` validation before signing.
  - Hardened `executeGetDeliveryPackageManifest` to validate actor and `deliveryId` UUID pre-query, enforce non-empty `delivery.items` and `batch_count` parity, require strict `!sub.section_id || sub.section_id !== delivery.section_id` and `delivery.project_id` alignment, and sort `sub.files` deterministically by `created_at` before signing.

### D. Representative Group Pre-Creation Alignment (`apps/web/src/lib/rep/group-precreation-service.ts`)
- **Confirmed Defects:**
  - Previously filtered `group_members` with `.neq('confirmation_status', 'removed')`, blocking students whose prior invitation was `'declined'` (diverging from PostgreSQL trigger `enforce_single_group_per_project`, which conflicts only on `'pending'` and `'confirmed'`).
  - Lacked pre-query actor/UUID/group-code-length/duplicate-member checks, `project.is_active` and `project_targets` checks, `'approved'`/`'locked'` registration status enforcement, query error handling on `group_members`, and compensating rollback on `group_members` or audit failures.
- **Corrections Implemented:**
  - Enforced pre-query active/role/assignment checks, `validateGroupCreationUuids`, trimmed `groupCode <= 50` chars, and duplicate `memberStudentIds` rejection.
  - Verified `sections` + `project_targets` (`isProjectTargetedToSection`), `project.is_active !== false`, `'approved'`/`'locked'` student registration status, and `.in('confirmation_status', ['pending', 'confirmed'])` conflict matching with explicit error fail-closed handling.
  - Added best-effort `compensateCreatedGroup` (`groups.delete().eq('id', group.id)`) if `group_members` insertion or `writeScopedAuditLog` fails.

### E. Memory Rate Limiter Bounding & Expiration Sweep (`apps/web/src/lib/security/rate-limiter.ts`)
- **Confirmed Defect:** In-memory request map could accumulate inactive/expired keys indefinitely in long-lived worker processes, and its process-local deployment limitation needed explicit documentation.
- **Correction Implemented:**
  - Exported `MemoryRateLimiter` storing `{ timestamps, expiresAt }` buckets, added `pruneExpired(now)` and `size()`, enabled periodic automatic pruning (`pruneIntervalMs = 60_000`), and enforced bounded capacity (`maxEntries = 10_000`) with expired-first and LRU eviction while preserving `globalWebRateLimiter` and `assertRateLimit`.
  - Documented clearly in file comments and Section 3 below that this limiter is process-local only (not shared across Vercel serverless instances).

---

## 2. Modified Files Inventory (Current Local Pass)

### Authorized Application Modules (5 files)
- `apps/web/src/lib/admin/student-approval-service.ts`
- `apps/web/src/lib/rep/delivery-service.ts`
- `apps/web/src/lib/rep/submission-file-service.ts`
- `apps/web/src/lib/rep/group-precreation-service.ts`
- `apps/web/src/lib/security/rate-limiter.ts`

### Focused Regression Tests (5 files)
- `apps/web/test/track-b-security.test.ts`
- `apps/web/test/delivery.service.test.ts`
- `apps/web/test/group-precreation.service.test.ts`
- `apps/web/test/audit-and-ratelimit-wiring.test.ts`
- `apps/web/test/security-hardening.test.ts`

### Documentation (1 file)
- `docs/TRACK_B_LOCAL_CORRECTIONS.md`

---

## 3. Local Verification Results (Observed After Final Code & Test Edits)

All local checks passed after the final edits across every workspace:

| Check | Command | Exit Code | Result Summary |
| :--- | :--- | :---: | :--- |
| **TypeScript Check** | `npm run typecheck` | `0` | Passed across `@hu-asms/bot`, `@hu-asms/web`, `@hu-asms/database`, `@hu-asms/shared`, `@hu-asms/types`, `@hu-asms/validation`. (`npm run lint` scripts in workspace packages also alias `tsc --noEmit`; standalone ESLint was not separately configured or run.) |
| **Workspace Tests** | `npm test` | `0` | `@hu-asms/bot`: `88/88` pass (`27` suites); `@hu-asms/web`: `96/96` pass (`24` suites); `@hu-asms/database`: `15/15` pass (`10` suites); total `199/199` tests passing across `61` suites (`0` fail, `0` skipped). |
| **Coverage Run** | `npm run test:coverage` | `0` | `199/199` tests pass across `61` suites (`0` fail, `0` skipped); overall `76.05%` lines, `74.67%` branches, `72.29%` functions. Modified services: `rate-limiter.ts` (`100.00%` line), `delivery-service.ts` (`96.29%` line), `group-precreation-service.ts` (`94.21%` line), `student-approval-service.ts` (`92.86%` line), `submission-file-service.ts` (`90.72%` line). |
| **Production Build** | `npm run build` | `0` | `tsc` built `@hu-asms/types`, `@hu-asms/shared`, `@hu-asms/validation`, `@hu-asms/database`, `@hu-asms/bot`; `next build` (Next.js `15.5.29`) compiled `@hu-asms/web` cleanly and generated all `21` routes + `95 kB` Middleware bundle. |
| **Whitespace Check** | `git diff --check` | `0` | Clean (LF/CRLF line-ending warnings only; zero trailing-whitespace/conflict markers). |

> **Verification Boundary:** Unit and regression suites run against mocked Supabase, Storage, and Telegram clients. Live PostgreSQL RLS policies, triggers (`enforce_single_group_per_project`), Storage signed-URL issuance, and multi-instance Vercel runtime behavior were **not** executed against remote infrastructure during this local pass.

---

## 4. Remaining Limitations & Outstanding Deployment Requirements

### Local / Architectural Limitations Deferred by Design
1. **No Multi-Step SQL Transaction Atomicity (PostgREST Compensating Rollback Only):**
   - `executeApproveRegistration`, `executePrepareDeliveryBatch`, `executeDispatchDelivery`, `executeAcknowledgeDelivery`, and `executeCreateProjectGroup` execute sequential PostgREST queries with best-effort compensating cleanup on failure. True ACID transaction atomicity (`SELECT ... FOR UPDATE`, atomic multi-table writes + transactional audit logging) still requires dedicated PostgreSQL RPCs in a future approved migration.
2. **Process-Local Rate Limiter:**
   - `MemoryRateLimiter` prevents unbounded memory growth inside a single Node.js instance, but counters are **not** shared across concurrent Vercel serverless/Edge instances and reset on cold starts. Production multi-instance protection requires an external shared store (e.g., Upstash Redis / Vercel KV).
3. **Database & Runtime Items Outside This Pass Scope:**
   - `/rep/*` UI experience for `system_owner` when unassigned, `audit_helper.ts` mock-fallback behavior vs live RPC, and `auth_read_*` active-profile RLS checks require separate schema/UI authorization if prioritized.

### Outstanding Live Deployment Requirements (Deployment Freeze Remains Active)
1. **Review & Approval:** Owner review of local working-tree changes prior to staging/committing on `phase-14-security-hardening`.
2. **Pending Supabase Migration:** Apply `supabase/migrations/20261111000001_track_b_rep_active_profile_guard.sql` after explicit remote authorization.
3. **Production Verification:** Run post-deploy checks against live Supabase RLS policies, `submission-files-vault` signed URLs, Vercel Root Directory (`apps/web`), and Telegram webhook delivery.
