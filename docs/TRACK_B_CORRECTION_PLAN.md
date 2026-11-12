# Track B Controlled Correction Plan (C1–C5) & Verification Matrix

> **Authorization State:** Local engineering implementation, staged forward SQL preparation, regression testing, and documentation ONLY. The deployment freeze remains active: **NO** commits, pushes, remote migrations (`supabase db push`), remote DB/storage changes, or Vercel deployments have been executed.

---

## 1. Executive Summary

Following [`docs/TRACK_B_FINAL_REVIEW.md`](TRACK_B_FINAL_REVIEW.md), local corrections C1–C5 have been implemented across PostgreSQL staged migration [`supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql`](../supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql), web services, and regression test suites:

- **C1 (Delivery Dispatch Atomicity & No Post-Handover Revert):** `executeDispatchDelivery` calls `public.mark_delivery_sent_with_audit(UUID, TEXT)` inside a single PostgreSQL transaction and never reverts `'sent'` back to `'prepared'`.
- **C2 (Registration Approval/Rejection Atomicity & Duplicate Protection):** Partial unique indexes on pending `registration_requests` plus `public.approve_student_registration(UUID, TEXT)` and `public.reject_student_registration(UUID, TEXT)` with `SELECT ... FOR UPDATE` row locking and transactional `audit_logs` emission.
- **C3 (Database Authorization & Integrity Parity):** Database triggers and tightened RLS `WITH CHECK` policies now mirror application-tier checks on `groups`, `group_members`, `deliveries`, and `delivery_items`, while preserving Telegram bot `service_role` workflows and `'active'` submission visibility.
- **C4 (`20261111000001` Active-Profile Guard Review):** Confirmed forward-compatible with Migrations `01–05`, isolated from Track C1 objects, and safe to pair cleanly before `20261111000002` when remote deployment resumes.
- **C5 (Rate Limiting Operational Scope):** Bounded per-process `MemoryRateLimiter` (`10,000` LRU capacity) documented alongside shared Redis REST / PostgreSQL distributed alternatives.

---

## 2. Correction C1 — Delivery Dispatch Consistency & State Integrity

### 2.1 Root Defect Addressed
Previously, `executeDispatchDelivery` updated `deliveries.status = 'sent'` first and then called `writeScopedAuditLog(...)` separately. On audit failure, `compensateDeliveryStatusRevert` attempted to revert `'sent' -> 'prepared'`. If external handover had already occurred, reverting `'sent'` created duplicate-dispatch risk and masked committed handovers.

### 2.2 Implemented Design
1. **PostgreSQL RPC `public.mark_delivery_sent_with_audit(p_delivery_id UUID, p_dispatch_notes TEXT DEFAULT NULL)`** ([`20261111000002`](../supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql)):
   - `SECURITY DEFINER SET search_path = ''`, explicit `REVOKE ALL FROM PUBLIC`, granted only to `authenticated, service_role`.
   - Enforces active staff profile (`profiles.is_active = true` and `role IN ('representative', 'system_owner')`) and section scope (`auth_is_system_owner()` or `auth_is_rep_for_section(v_delivery.section_id)`).
   - Locks target `deliveries` row with `SELECT ... FOR UPDATE`.
   - Verifies `status = 'prepared'` and positive item parity (`v_item_count > 0 AND v_item_count = v_delivery.batch_count`).
   - Updates `deliveries` (`status = 'sent'`, `sent_at`, sanitized notes) and inserts `TEACHER_DELIVERY_DISPATCHED` into `public.audit_logs` (capturing `prepared_by`, `dispatched_by`, `section_id`, `project_id`, `batch_count`) in the **same database transaction**.
2. **TypeScript Caller [`executeDispatchDelivery`](../apps/web/src/lib/rep/delivery-service.ts):**
   - Validates active actor, rate limit (`rep-delivery:<userId>`), UUID format, section scope, and `'prepared'` state before invoking `.rpc('mark_delivery_sent_with_audit', ...)`.
   - If the client lacks `.rpc()` (lightweight test mocks only), the sequential fallback writes `'sent'` and **never invokes `compensateDeliveryStatusRevert` on audit failure**, returning an explicit reconciliation-required error while leaving `'sent'` intact.
3. **Zero Automated External Transmission & Monotonic DB Guard:**
   - HU-ASMS performs **no** automated Telegram Bot API or SMTP/email dispatch during preparation or dispatch; teacher handover remains manual using 15-minute signed download manifests (`executeGetDeliveryPackageManifest`).
   - `public.enforce_delivery_integrity()` blocks `'sent' -> 'prepared'` and other backward transitions at the database level (`pending -> prepared|failed`, `prepared -> sent|failed`, `sent -> acknowledged|failed`).
   - **Submission Lifecycle Preservation:** Delivering a submission does **not** alter `submissions.status` away from `'active'`, preserving queries in `apps/web/src/app/rep/deliveries/new/page.tsx` and `apps/web/src/app/rep/reports/page.tsx`.

---

## 3. Correction C2 — Student Registration Approval & Rejection Atomicity

### 3.1 Implemented Database Safeguards (`20261111000002`)
1. **Partial Unique Indexes on Pending Requests:**
   - `uq_pending_registration_request_hu_id ON public.registration_requests (hu_student_id) WHERE status = 'pending'`
   - `uq_pending_registration_request_telegram_id ON public.registration_requests (telegram_user_id) WHERE status = 'pending'`
   - Prevents duplicate concurrent pending queue rows from the bot/registration flow. *(Pre-deployment gate: before applying to production, verify zero duplicate pending `hu_student_id` or `telegram_user_id` rows exist.)*
2. **Atomic RPCs:**
   - `public.approve_student_registration(p_request_id UUID, p_notes TEXT DEFAULT NULL) RETURNS JSONB`:
     - Enforces `public.auth_is_system_owner()` (or trusted `service_role` / DBA session).
     - Locks `registration_requests` row (`FOR UPDATE`), requires `status = 'pending'`, locks/checks `public.students` for existing `hu_student_id` or `telegram_user_id` (`23505` conflict rejection), inserts locked `students` row (`registration_status = 'locked'`, `is_locked = true`), updates `registration_requests` (`status = 'approved'`, `reviewed_by`, `reviewed_at`), and inserts `STUDENT_REGISTRATION_APPROVED` into `public.audit_logs` atomically.
   - `public.reject_student_registration(p_request_id UUID, p_reason TEXT DEFAULT NULL) RETURNS JSONB`:
     - Same authorization and `FOR UPDATE` row lock, normalizes reason (default `'Identity verification mismatch'`), transitions `'pending' -> 'rejected'`, and writes `STUDENT_REGISTRATION_REJECTED` into `public.audit_logs` atomically.

### 3.2 TypeScript Caller [`student-approval-service.ts`](../apps/web/src/lib/admin/student-approval-service.ts)
- `executeApproveRegistration` and `executeRejectRegistration` enforce `assertSystemOwner`, rate limits, and UUID validation, then call `.rpc('approve_student_registration', ...)` / `.rpc('reject_student_registration', ...)` whenever `.rpc` exists.
- The compensating two-step PostgREST path remains strictly for mock test doubles without `.rpc()`, surfacing clear `'orphaned student <id> requires reconciliation'` errors if rollback delete fails (e.g., `23503` FK error).

---

## 4. Correction C3 — Application vs. Database Parity Matrix

| Control Area | Application / Service Check | PostgreSQL Trigger / RLS Parity (`20261111000002`) | Bot (`service_role`) & Legacy Compatibility |
|---|---|---|---|
| Project active & section targeting | `delivery-service.ts`, `group-precreation-service.ts` | `is_project_targeted_to_section()` + `enforce_group_integrity()` + `enforce_delivery_integrity()` require `projects.is_active = true` and matching `project_targets` (`section_id = s.id` OR `section_id IS NULL` for matching `academic_year_id`) on `INSERT` | Bot uses `service_role` and checks identical targeting (`group.service.ts`). Updating existing deliveries (e.g., acknowledgment after course end) remains allowed when `project_id`/`section_id` do not change. |
| Individual-only project guard | `group-precreation-service.ts` rejects `submission_type === 'individual'` | `enforce_group_integrity()` enforces `submission_type IN ('group', 'both')` | Matches bot `group.service.ts`. |
| Rep group self-verification bypass | `group-precreation-service.ts` inserts `'pending'` only | `rep_access_assigned_section_groups` `WITH CHECK (status NOT IN ('verified', 'submitted'))` + `rep_access_assigned_section_group_members` `WITH CHECK (confirmation_status <> 'confirmed' AND confirmed_at IS NULL)` + trigger guards | Trusted `service_role` (bot confirmation) and `system_owner` can mark `'confirmed'` and advance `'verified'` via consensus trigger. |
| Student section, approval & single-group membership | `group-precreation-service.ts` verifies `section_id`, `approved`/`locked`, no conflicting membership | `enforce_group_member_integrity()` + RLS check verify `students.section_id = groups.section_id` and `registration_status IN ('approved', 'locked')`; `enforce_single_group_per_project()` already enforced | Blocks cross-section and suspended/pending student group insertion even via raw authenticated PostgREST calls. |
| Group min/max bounds & consensus verification | `group-precreation-service.ts` aligns missing rules to `min = 2`, `max = 10` (matching `group.service.ts`) | `CONSTRAINT TRIGGER trg_enforce_group_member_size_bounds DEFERRABLE INITIALLY DEFERRED` checks `[COALESCE(min_group_size, 2), COALESCE(max_group_size, 10)]` on commit; `check_and_update_group_verification()` requires confirmed count within `[min, max]` | Deferrable commit trigger supports single-request multi-row `.insert(members)` in both web and bot flows while rejecting undersized or oversized groups at transaction commit. |
| Delivery header & teacher/course integrity | `delivery-service.ts` sets `course_id`/`teacher_id` from `projects`, active teacher, positive `batch_count` | `enforce_delivery_integrity()` checks `NEW.course_id = project.course_id`, `NEW.teacher_id = project.teacher_id`, active `teachers.is_active`, `representative_id = auth.uid()` on non-owner `INSERT`, positive `batch_count`, and item count parity when `'sent'`/`'acknowledged'` | Monotonic transitions enforced in PostgreSQL; `'sent' -> 'prepared'` rollback blocked globally. |
| Delivery item binding (`delivery_items`) | `delivery-service.ts` validates active submissions match delivery section & project | Tightened `"rep_manage_section_delivery_items"` RLS `WITH CHECK` + `enforce_delivery_item_integrity()` verify parent `deliveries.status = 'prepared'`, `submissions.section_id = d.section_id`, `submissions.project_id = d.project_id`, and `submissions.status = 'active'` | Blocks cross-section, cross-project, superseded/inactive attachment and post-dispatch `delivery_items` tampering while allowing `prepared` rollback deletion (`compensateCreatedDelivery`). |

---

## 5. Correction C4 — Compatibility Audit of `20261111000001_track_b_rep_active_profile_guard.sql`

- **Reviewed against Migrations `01–05` and local schema:** Compatible with zero Track C1 objects (`batch_operations`, bot rate-limit tables, etc.).
- **Effect:** Replaces `public.auth_is_rep_for_section(UUID)` and `public.auth_get_assigned_section_ids()` (`SECURITY DEFINER`, `SET search_path = ''`) to join `public.profiles p` and require `p.is_active = true` and `p.role IN ('representative'::public.user_role, 'system_owner'::public.user_role)`.
- **Security Impact:** Closes the RLS gap where a deactivated representative (`profiles.is_active = false`) retaining `representative_assignments.is_active = true` could pass section-scoped RLS policies using a non-expired JWT.
- **Deployment Order:** Pair in order `20261111000001` then `20261111000002` when the deployment freeze is lifted; **both remain UNAPPLIED remotely**.

---

## 6. Correction C5 — Rate Limiting Operational Assessment & Serverless Architecture

### 6.1 Current State ([`apps/web/src/lib/security/rate-limiter.ts`](../apps/web/src/lib/security/rate-limiter.ts))
- **`MemoryRateLimiter` guarantees:** Bounded bucket map (`DEFAULT_MAX_ENTRIES = 10,000`), automatic `O(n)` expiry pruning (`pruneIntervalMs = 60,000` or when full), and LRU `Map` eviction of oldest keys when saturated under burst distinct-key traffic.
- **Known Operational Limitations:**
  1. Counters reside strictly in local Node.js heap (`Map`), so concurrent Vercel serverless lambdas track separate limits and cold starts reset all buckets.
  2. `pruneExpired()` performs an `O(n)` linear scan up to `10,000` keys inside hot request paths when triggered.
  3. Unauthenticated admin approval attempts (`!context || !context.profile`) collapse into one shared bucket (`admin-reg-review:unauth`, `15 req/min`) without IP extraction.

### 6.2 Recommended Production Architecture (No Third-Party Provisioning Performed)
- **Primary Option (Vercel Multi-Instance):** Managed Redis over HTTPS REST (e.g., Upstash) implementing an async `RateLimitStore` using atomic `INCR`/`PEXPIRE` or Lua sliding-window scripts (`RATE_LIMIT_REDIS_REST_URL`, `RATE_LIMIT_REDIS_REST_TOKEN` server-only).
- **Zero-New-Vendor Alternative:** Supabase/PostgreSQL bucket table + `SECURITY DEFINER` upsert RPC (~5–20 ms DB overhead per sensitive admin/rep mutation).
- **Middleware Edge Limiting:** Key unauthenticated `/login` and action abuse by trusted proxy headers (`x-forwarded-for` first hop / platform IP) once a shared store is provisioned.

---

## 7. Verification Scope & Workspace Tooling Notes (Honesty Statement)

- **Workspace `"test": "node --version"` placeholders:** Packages `packages/shared`, `packages/types`, and `packages/validation` have zero `test/` suites; their `package.json` `"test"` scripts echo Node.js version (`v26.13.0`) solely so `npm test --workspaces` exits cleanly without failing on missing tests.
- **Lint vs. Typecheck Clarification:** All six workspace `package.json` files define `"lint": "tsc --noEmit"`. Although `apps/web/package.json` lists `"eslint"` and `"eslint-config-next"` in `devDependencies`, **no `.eslintrc*` or `eslint.config.*` configuration exists** in the repository; therefore TypeScript compilation checks pass, while ESLint rule enforcement is currently unconfigured/not active.
- **Mock vs. Real Database Scope:** Zero test files instantiate a live Supabase client or execute SQL against a running PostgreSQL instance (`20261111000001` and `20261111000002` are verified by static SQL contract tests and TypeScript/mock unit suites; live remote verification remains **UNVERIFIED / blocked by deployment freeze**).
