# HU-ASMS — Phase 14 Track B Final Deployment Preflight Report

> **Deployment Freeze & Audit Basis:** Strictly **READ-ONLY** verification conducted under an active deployment freeze against branch `phase-14-security-hardening` and linked Supabase project `hu-accadamic assistent` (`mqfbqszvdwhizffdbjnp` · `production`) via Supabase CLI `3.1.0`. No files other than this report were created or modified, and no `git add`, `git commit`, `git push`, branch merge, `supabase db push`, `--include-all`, `--yes`, remote database write, credential/secret inspection, or Vercel deployment was executed.

---

## 1. Verified Git Branch & HEAD

| Check | Verified Value |
|---|---|
| **Current Branch** | `phase-14-security-hardening` |
| **Remote Tracking Branch** | `remotes/origin/phase-14-security-hardening` |
| **Exact `HEAD` Commit** | `6e2c5f8b510718ddcac25f56543535ceead9e860` (`fix(vercel): add vercel.json for monorepo build configuration`) |
| **Parent Commit (`HEAD~1`)** | `5291020` (`Phase 14: Security Hardening & Production Readiness`) |
| **`main` Branch Commit** | `5f97946f206c0598f6fbf9e5cd545fe6ee7392c6` |
| **Git State Cleanliness** | Uncommitted local remediation/staging tree preserved cleanly; zero commits, stages, pushes, resets, or merges executed during preflight |

---

## 2. Exact Local Changes & Migration Filenames

### 2.1 Working Tree Status (`56` Pre-Report Paths / `57` Including This Report)

Measured via `git status --short --untracked-files=all`:

- **Deleted tracked (`1`):**
  - `vercel.json` *(deleted UTF-8 BOM root Vercel config)*
- **Modified tracked (`39`):**
  - **Build & Shared Validation (`2`):** `apps/web/next.config.mjs`, `packages/validation/src/index.ts`
  - **Auth, Middleware & Security Services (`6`):** `apps/web/src/middleware.ts`, `apps/web/src/lib/auth/roles.ts`, `apps/web/src/lib/security/rate-limiter.ts`, `apps/web/src/lib/rep/delivery-service.ts`, `apps/web/src/lib/rep/group-precreation-service.ts`, `apps/web/src/lib/rep/submission-file-service.ts`
  - **Admin, Rep & Login Routes / Server Actions (`21`):**
    - `apps/web/src/app/(auth)/login/page.tsx`
    - `apps/web/src/app/admin/layout.tsx`, `apps/web/src/app/admin/page.tsx`, `apps/web/src/app/admin/academics/page.tsx`, `apps/web/src/app/admin/academics/projects/page.tsx`, `apps/web/src/app/admin/audit-logs/page.tsx`, `apps/web/src/app/admin/representatives/page.tsx`, `apps/web/src/app/admin/structure/page.tsx`, `apps/web/src/app/admin/students/page.tsx`
    - `apps/web/src/app/rep/layout.tsx`, `apps/web/src/app/rep/page.tsx`, `apps/web/src/app/rep/deliveries/actions.ts`, `apps/web/src/app/rep/deliveries/new/page.tsx`, `apps/web/src/app/rep/deliveries/page.tsx`, `apps/web/src/app/rep/groups/actions.ts`, `apps/web/src/app/rep/groups/new/page.tsx`, `apps/web/src/app/rep/groups/page.tsx`, `apps/web/src/app/rep/reports/page.tsx`, `apps/web/src/app/rep/students/page.tsx`, `apps/web/src/app/rep/submissions/actions.ts`, `apps/web/src/app/rep/submissions/page.tsx` *(21 route/action files + 6 auth/lib files = 27 modified `apps/web/src` files total)*
  - **Test Suites (`5`):** `apps/web/test/audit-and-ratelimit-wiring.test.ts`, `apps/web/test/auth-roles.test.ts`, `apps/web/test/delivery.service.test.ts`, `apps/web/test/group-precreation.service.test.ts`, `apps/web/test/security-hardening.test.ts`
  - **Documentation (`3`):** `docs/ADMINISTRATIVE_DASHBOARD.md`, `docs/SECURITY_AND_HARDENING.md`, `docs/SYSTEM_ARCHITECTURE.md`
  - **Preserved Non-Track-B Seed Edit (`1`):** `supabase/seed.sql` *(intentionally left untouched; exclude from security commits unless explicitly approved)*
  - **Generated TypeScript Incremental Cache (`1`):** `apps/web/tsconfig.tsbuildinfo` *(reverted/excluded prior to commits)*
- **Untracked (`16` pre-report / `17` with this report):**
  - **Vercel Monorepo Config (`1`):** `apps/web/vercel.json`
  - **New Security/Validation/UI Modules (`6`):** `apps/web/src/components/rep/scope-access-error.tsx`, `apps/web/src/lib/admin/student-approval-service.ts`, `apps/web/src/lib/auth/middleware-guard.ts`, `apps/web/src/lib/auth/page-guards.ts`, `apps/web/src/lib/auth/role-policy.ts`, `apps/web/src/lib/rep/input-validation.ts`
  - **New Regression Test Files (`2`):** `apps/web/test/track-a1-vercel.test.ts`, `apps/web/test/track-b-security.test.ts`
  - **Track B Engineering & Preflight Docs (`6`):** `docs/INTERRUPTED_WORK_RECOVERY_REPORT.md`, `docs/TRACK_B_LOCAL_CORRECTIONS.md`, `docs/TRACK_B_FINAL_REVIEW.md`, `docs/TRACK_B_CORRECTION_PLAN.md`, `docs/TRACK_B_GIT_STAGING_PLAN.md`, `docs/TRACK_B_FINAL_DEPLOYMENT_PREFLIGHT.md`
  - **Staged Local-Only Database Migrations (`2`):**
    1. `supabase/migrations/20261111000001_track_b_rep_active_profile_guard.sql`
    2. `supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql`

### 2.2 Remote vs. Local Migration Inventory (`supabase migration list --remote`)

| Migration Version | Filename | Remote Applied Status |
|---|---|---|
| `20261110000001` | `01_initial_schema` | Applied (`remote = 20261110000001`) |
| `20261110000002` | `02_rls_policies` | Applied (`remote = 20261110000002`) |
| `20261110000003` | `03_storage_buckets` | Applied (`remote = 20261110000003`) |
| `20261110000004` | `04_seed_initial_admin` / baseline sync | Applied (`remote = 20261110000004`) |
| `20261110000005` | `20261110000005_security_hardening.sql` | Applied (`remote = 20261110000005`) |
| `20261111000001` | `20261111000001_track_b_rep_active_profile_guard.sql` | **Unapplied (Local Only)** |
| `20261111000002` | `20261111000002_track_b_atomic_rpcs_and_db_parity.sql` | **Unapplied (Local Only)** |

---

## 3. RPC Failure-Safety Findings (C1 & C2)

### 3.1 Production vs. Test-Only Client Isolation

A source search across `apps/web/src` verified every caller of C1/C2 service functions:

- **Registration Review Callers ([`apps/web/src/app/admin/students/page.tsx`](../apps/web/src/app/admin/students/page.tsx)):** Server Actions `approveRegistration` and `rejectRegistration` both instantiate clients via `createServerSupabaseClient()` ([`apps/web/src/lib/supabase/server.ts`](../apps/web/src/lib/supabase/server.ts)), which calls `createServerClient` from `@supabase/ssr`.
- **Delivery Dispatch Callers ([`apps/web/src/app/rep/deliveries/actions.ts`](../apps/web/src/app/rep/deliveries/actions.ts)):** `prepareDeliveryBatch`, `dispatchDelivery`, `acknowledgeDelivery`, and `getDeliveryPackageManifest` all instantiate clients via `createServerSupabaseClient()`.
- **Browser Client ([`apps/web/src/lib/supabase/client.ts`](../apps/web/src/lib/supabase/client.ts)):** Uses `createBrowserClient` from `@supabase/ssr`.
- **Conclusion:** Every production Supabase client inherits `SupabaseClient.prototype.rpc`, so `typeof (supabase as any).rpc === 'function'` is unconditionally `true` in production. No non-test code path supplies an `.rpc`-less object; the legacy fallback branches execute strictly under minimal in-memory unit-test doubles that omit `.rpc`.

### 3.2 C1 — Delivery Dispatch (`executeDispatchDelivery` -> `mark_delivery_sent_with_audit`)

Verified in [`apps/web/src/lib/rep/delivery-service.ts`](../apps/web/src/lib/rep/delivery-service.ts) (`L343–452`):

1. **Pre-RPC Validation (`L349–380`):** Fails closed before database mutation if profile is missing or `is_active !== true`, role is neither verified `system_owner` nor verified `representative`, active assignments are empty (for reps), rate limit (`rep-delivery:${userId}`, 20/min) is exceeded, UUID is malformed, delivery does not exist/falls outside section scope, or `delivery.status !== 'prepared'`.
2. **Atomic RPC Execution (`L387–401`):** Invokes `supabase.rpc('mark_delivery_sent_with_audit', { p_delivery_id, p_dispatch_notes })`.
3. **RPC Error Handling (`L393–398`):** Returns `{ success: false, error: rpcErr.message || 'Failed to dispatch delivery.' }` immediately.
   - **No compensating writes executed:** Because TypeScript returns inside the `if (typeof (supabase as any).rpc === 'function')` block, `compensateDeliveryStatusRevert` and the legacy fallback block (`L404–448`) are never reached when `.rpc()` exists.
   - **No false success or `'sent'`-without-audit state:** Inside `mark_delivery_sent_with_audit`, PostgreSQL locks the `deliveries` row (`FOR UPDATE`), re-validates status `'prepared'`, section authorization, and inserts the `TEACHER_DELIVERY_DISPATCHED` `audit_logs` record inside one ACID transaction. Any exception rolls back both writes atomically.
   - **Test-only fallback parity (`L439–445`):** Even in unit-test mocks omitting `.rpc()`, external dispatch audit failure explicitly leaves `'sent'` intact and surfaces an audit reconciliation error rather than reverting `'sent' -> 'prepared'`.
4. **Non-RPC Sibling Scope Clarification:** `executePrepareDeliveryBatch` (`L133–336`) and `executeAcknowledgeDelivery` (`L457–543`) still use multi-step PostgREST operations with compensating cleanup (deleting un-dispatched `'prepared'` batches before external handover on item/audit failure; reverting `'acknowledged' -> 'sent'` on audit failure). Those two operations were intentionally left outside C1 RPC conversion and are accurately documented as such.

### 3.3 C2 — Registration Approval & Rejection (`student-approval-service.ts`)

Verified in [`apps/web/src/lib/admin/student-approval-service.ts`](../apps/web/src/lib/admin/student-approval-service.ts) (`L58–252`):

1. **Pre-RPC Validation (`L20–36`):** `enforceReviewSecurity` enforces per-caller rate limit (`30/min` authenticated, `15/min` unauth), strict `assertSystemOwner(context)` (`profile.is_active === true` and `role === 'system_owner'`), and UUID validity before any database call.
2. **Atomic RPC Execution (`L67–90`, `L188–202`):**
   - `executeApproveRegistration` calls `supabase.rpc('approve_student_registration', { p_request_id: cleanRequestId, p_notes: null })`.
   - `executeRejectRegistration` calls `supabase.rpc('reject_student_registration', { p_request_id: cleanRequestId, p_reason: cleanReason })`.
3. **RPC Error & Partial-Record Safety:**
   - On `rpcErr`, both functions return `{ success: false, error }` immediately — **zero** fallback `.from(...)` writes and **zero** calls to `compensateCreatedStudent`.
   - Inside PostgreSQL, `approve_student_registration` executes `FOR UPDATE` locking on `registration_requests`, verifies `'pending'` status and duplicate conflicts, inserts the locked `students` record, updates `registration_requests` to `'approved'`, and writes `STUDENT_REGISTRATION_APPROVED` to `audit_logs` in a single ACID transaction. Any exception rolls back all three writes atomically (zero orphaned `students` rows).
   - Additionally, `executeApproveRegistration` (`L80–87`) fails closed if `student_id` is absent from the returned RPC payload.

---

## 4. Migration Security Review (`20261111000001` & `20261111000002`)

### 4.1 Function Inventory, `SECURITY DEFINER`, Ownership & `search_path`

| Migration | Function | Security Mode | `search_path` | Internal Auth Guard |
|---|---|---|---|---|
| `20261111000001` | `auth_is_rep_for_section(UUID)` | `SECURITY DEFINER` | `''` (empty) | `ra.profile_id = auth.uid()` + `ra.is_active = true` + `p.is_active = true` + staff role |
| `20261111000001` | `auth_get_assigned_section_ids()` | `SECURITY DEFINER` | `''` (empty) | Same joined `representative_assignments` + active `profiles` filter |
| `20261111000002` | `approve_student_registration(UUID, TEXT)` | `SECURITY DEFINER` | `''` (empty) | Explicit `public.auth_is_system_owner()` gate + `FOR UPDATE` |
| `20261111000002` | `reject_student_registration(UUID, TEXT)` | `SECURITY DEFINER` | `''` (empty) | Explicit `public.auth_is_system_owner()` gate + `FOR UPDATE` |
| `20261111000002` | `mark_delivery_sent_with_audit(UUID, TEXT)` | `SECURITY DEFINER` | `''` (empty) | Active `profiles` check + `auth_is_system_owner()` or `auth_is_rep_for_section()` + `FOR UPDATE` |
| `20261111000002` | `is_project_targeted_to_section(UUID, UUID)` | `SECURITY INVOKER` | `''` (empty) | Caller RLS applies |
| `20261111000002` | `enforce_group_integrity()` | `SECURITY INVOKER` | `''` (empty) | Trigger enforcing section/project/target/teacher rules |
| `20261111000002` | `enforce_group_member_integrity()` | `SECURITY INVOKER` | `''` (empty) | Trigger enforcing same-section + locked student membership |
| `20261111000002` | `enforce_group_member_size_bounds()` | `SECURITY INVOKER` | `''` (empty) | `DEFERRABLE INITIALLY DEFERRED` constraint trigger enforcing `[min_group_size, max_group_size]` |
| `20261111000002` | `check_and_update_group_verification()` | `SECURITY INVOKER` | `''` (empty) | Hardened verification transition trigger |
| `20261111000002` | `enforce_delivery_integrity()` | `SECURITY INVOKER` | `''` (empty) | Trigger enforcing section/project/teacher/non-revert `'sent' -> 'prepared'` |
| `20261111000002` | `enforce_delivery_item_integrity()` | `SECURITY INVOKER` | `''` (empty) | Trigger enforcing same-section & same-project submission binding |

Live `pg_proc` verification confirms all `9` existing remote `public` functions are owned by `postgres` and pin `proconfig = ["search_path=\"\""]`. Staged migrations applied via Supabase CLI will inherit `postgres` ownership and explicitly pin `SET search_path = ''` with schema-qualified references (`public.*`).

### 4.2 CRITICAL PRE-PUSH FINDING — `pg_default_acl` Retains `anon` `EXECUTE` When Only `FROM PUBLIC` Is Revoked

Verified directly against live production PostgreSQL catalogs (`pg_default_acl`, `pg_proc`, and `supabase db advisors --remote --type security --output json`):

1. **Live `pg_default_acl` Configuration:** In schema `public`, default function privileges (`defaclobjtype = 'f'`) for both `postgres` and `supabase_admin` automatically grant `EXECUTE` to `anon` and `authenticated`:
   ```text
   {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
   ```
2. **Observed Live Impact:** Migration `05` (`20261110000005_security_hardening.sql`) only ran `REVOKE ALL ON FUNCTION ... FROM PUBLIC; GRANT EXECUTE ... TO authenticated, service_role;`. As a result, **every single one (`9/9`) of the live `public` functions currently has `has_function_privilege('anon', p.oid, 'EXECUTE') = true`**, producing **`10` Supabase Security Advisor `WARN` alerts** live today:
   - **`5` x `0028_anon_security_definer_function_executable`** (`admin_set_profile_status`, `auth_get_assigned_section_ids`, `auth_is_rep_for_section`, `auth_is_system_owner`, `record_scoped_audit_log`)
   - **`5` x `0029_authenticated_security_definer_function_executable`** (same 5 functions)
3. **Staged Migration Finding:** Both `20261111000001` (`L43–47`) and `20261111000002` (`L158–159, 250–251, 378–379, ...`) follow the same `REVOKE ALL ON FUNCTION ... FROM PUBLIC;` pattern **without revoking from `anon`**. Pushing them as written would expose the new RPCs (`approve_student_registration`, `reject_student_registration`, `mark_delivery_sent_with_audit`) to PostgREST `/rest/v1/rpc/...` calls under the `anon` role and add additional `0028` warnings.
4. **Runtime Exploitability vs. Hardening:** Because every `SECURITY DEFINER` function validates `auth.uid()` / `public.auth_is_system_owner()` / `public.auth_is_rep_for_section()` internally before touching data, `anon` callers (`auth.uid() IS NULL`) are rejected at runtime with authorization errors or empty sets. Nevertheless, **least privilege requires `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon;`** before `db push` (plus revoking `anon` on live Migration `05` functions in a controlled hardening pass). *(Note: Advisor `0029` for `authenticated` is expected/by-design for `auth_*` RLS helpers and RBAC-gated RPCs.)*

### 4.3 RLS Parity, Atomicity, `01–05` Compatibility & Rollback Plan

- **RLS Parity (`20261111000002`):** Replaces permissive `rep_access_assigned_section_groups`, `rep_access_assigned_section_group_members`, and `rep_manage_section_delivery_items` policies with explicit `WITH CHECK` parity (e.g., matching section scoping across referenced `projects`, `students`, `submissions`, and `deliveries`). Existing `owner_full_access_*` policies and private `submission-files-vault` storage policies remain intact.
- **Partial Unique Indexes (`uq_pending_registration_request_hu_id`, `uq_pending_registration_request_telegram_id`):** Fully compatible with `01–05`; live `registration_requests` has `0` rows (no creation failure risk).
- **Transaction Atomicity:** Both staged migrations execute as atomic SQL DDL scripts; any DDL error aborts and leaves the schema at `20261110000005`.
- **Forward Recovery / Rollback Strategy:** Do not delete applied migration history entries. If post-push rollback is ever required, deploy a forward remediation migration that restores Migration `05` `auth_is_rep_for_section` / `auth_get_assigned_section_ids` definitions, drops the `20261111000002` triggers/RPCs/indexes (`DROP TRIGGER IF EXISTS ...`, `DROP FUNCTION IF EXISTS ...`, `DROP INDEX IF EXISTS ...`), and restores the previous policies — coordinated strictly with rolling back web deployments that invoke those RPCs.

---

## 5. Duplicate Registration Preflight Results

Executed read-only against linked production database via `supabase db query --remote --read-only --output json` (no personally identifiable values accessed or printed):

| Metric | Live Count | Migration Impact |
|---|---:|---|
| `registration_requests` (total) | `0` | Clean |
| `registration_requests` (`status = 'pending'`) | `0` | Clean |
| `registration_requests` (`status = 'approved'`) | `0` | Clean |
| `registration_requests` (`status = 'rejected'`) | `0` | Clean |
| Duplicate pending `hu_student_id` groups | `0` (`[]`) | Safe for `uq_pending_registration_request_hu_id` |
| Duplicate pending `telegram_user_id` groups | `0` (`[]`) | Safe for `uq_pending_registration_request_telegram_id` |
| Pending requests colliding with existing `students` | `0` | Clean |
| `students` (total) | `0` | Clean |
| `profiles` (total) | `0` | Needs post-migration owner bootstrap |
| `auth.users` (total) | `0` | Needs post-migration owner bootstrap |

---

## 6. Representative Authorization Findings (Database vs. Application Layer)

| Control Surface | Live Remote DB Status (`01–05` Today) | Staged Local Parity (`20261111000001` + `002` + Web Track B) |
|---|---|---|
| **DB RLS `is_active` & role check (`auth_is_rep_for_section`, `auth_get_assigned_section_ids`)** | **GAP LIVE:** Checks only `representative_assignments.is_active = true`; ignores `profiles.is_active` and `profiles.role` | **FIXED IN STAGED `20261111000001`:** Joins `profiles` and requires `p.is_active = true` and `p.role IN ('representative', 'system_owner')` |
| **DB `groups` / `group_members` / `deliveries` / `delivery_items` integrity & non-revert** | **GAP LIVE:** Section-only RLS `WITH CHECK`; no capacity/cross-section/non-revert `'sent' -> 'prepared'` DB triggers | **FIXED IN STAGED `20261111000002`:** `WITH CHECK` parity + 5 triggers + `mark_delivery_sent_with_audit` RPC |
| **Table RLS & Private Storage Vault (`23` public tables + `storage.objects`)** | Active (`rowsecurity = true` on `23/23` tables; `47` RLS policies; private `submission-files-vault` `50 MiB` PDF/ZIP/DOC/DOCX limit) | Preserved; additionally note extra private bucket `development` exists remotely without MIME/size limits (`public: false`) |
| **`audit_logs` immutability** | `anon_select: false`, `auth_select: true`, zero direct `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` grants to `authenticated`; writes only via `SECURITY DEFINER` `record_scoped_audit_log` | Extended atomically inside `20261111000002` RPCs (`approve_student_registration`, `reject_student_registration`, `mark_delivery_sent_with_audit`) |
| **Edge Middleware & Portal UI / Server Actions** | N/A in live repo (un-deployed) | Local web code (`middleware.ts`, `middleware-guard.ts`, `page-guards.ts`, `roles.ts`) fails closed on missing/inactive profiles, empty assignments, cross-section targets, and legacy `'owner'` alias |
| **Live Production Assignments Count** | `0` rows in `representative_assignments`, `departments`, `academic_years`, `sections`, `courses`, `teachers`, `projects` | Ready for clean controlled bootstrap after migrations |

---

## 7. Vercel Deployment Requirements

Verified in [`apps/web/vercel.json`](../apps/web/vercel.json) and [`apps/web/next.config.mjs`](../apps/web/next.config.mjs):

- **Deleted BOM Artifact:** Root `vercel.json` (which had UTF-8 BOM and conflicting root monorepo settings) is deleted locally (`D vercel.json`).
- **New UTF-8 BOM-Free Web Config (`apps/web/vercel.json`):**
  ```json
  {
    "framework": "nextjs",
    "installCommand": "cd ../.. && npm install",
    "buildCommand": "cd ../.. && npm run build"
  }
  ```
- **Next.js Monorepo Tracing (`apps/web/next.config.mjs`):** Configured with `reactStrictMode: true`, `outputFileTracingRoot: path.resolve(__dirname, '../..')`, and `transpilePackages` for `@hu-asms/types`, `@hu-asms/validation`, `@hu-asms/shared`, `@hu-asms/database`, and `@hu-asms/bot`.
- **Mandatory Vercel Project Dashboard Settings (Verified Only — Not Modified Remotely):**
  1. **Root Directory:** Must be set to `apps/web`.
  2. **Root/Monorepo Access:** Enable **"Include files outside the root directory in the Build Step"** so `cd ../..` and workspace packages resolve during Vercel install/build.
  3. **Required Environment Variables:** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (middleware fails closed with HTTP `503` if absent), plus required runtime env vars (never exposing server/service-role secrets under `NEXT_PUBLIC_*`).
- **Strict Deployment Sequence Rule:** Do **NOT** deploy updated `apps/web` to Vercel before applying Migrations `20261111000001` and `20261111000002` to Supabase, because production clients expose `.rpc()` and depend on `approve_student_registration`, `reject_student_registration`, and `mark_delivery_sent_with_audit`.

---

## 8. Remaining Risks, Unresolved Questions & Honest Test-Quality Assessment

### 8.1 Fresh Preflight Check Results & Honest Tooling Scope

Executed freshly during this preflight session (`npm run typecheck; npm run lint; npm test`, all exit `0`):

- **`npm run typecheck` (all `6` workspaces):** `tsc --noEmit` exited `0` across `@hu-asms/bot`, `@hu-asms/web`, `@hu-asms/database`, `@hu-asms/shared`, `@hu-asms/types`, and `@hu-asms/validation`.
- **`npm run lint` (ESLint vs. `tsc --noEmit`):** **ESLint is NOT configured.** All `6` workspace `package.json` files define `"lint": "tsc --noEmit"`. Although [`apps/web/package.json`](../apps/web/package.json) declares `"eslint": "^9.39.5"` and `"eslint-config-next": "^16.4.6"` in `devDependencies`, a recursive workspace search found **zero** `.eslintrc*` or `eslint.config.*` configuration files. Therefore, `npm run lint` currently re-runs TypeScript type checking rather than ESLint static/React/Next security rules.
- **`npm test`:** Exited `0` across `203` tests in `62` suites (`0` failed, `0` cancelled, `0` skipped):
  - `@hu-asms/bot`: `88/88` tests (`27` suites)
  - `@hu-asms/web`: `100/100` tests (`25` suites)
  - `@hu-asms/database`: `15/15` tests (`10` suites)
  - `@hu-asms/shared`, `@hu-asms/types`, `@hu-asms/validation`: `"test": "node --version"` (`v26.13.0` — **0 assertions**)
- **Coverage & Production Build Currency:** `npm run test:coverage` (`203/203`, `76.21%` line / `74.96%` branch / `72.29%` func) and `npm run build` (`next build`, `21/21` static routes, middleware `95 kB`) passed at C1–C5 completion prior to this preflight turn and were intentionally not re-run here to keep `apps/web/tsconfig.tsbuildinfo` untouched.

### 8.2 Test Evidence Quality Classification

| Category | Workspace Scope Covered | What It Proves (And Does Not Prove) |
|---|---|---|
| **1. Real Application Unit Tests (Pure Logic)** | `role-policy.ts`, `middleware-guard.ts`, `roles.ts` guards, `MemoryRateLimiter` (LRU + capacity), `packages/validation` UUIDs, ID sanitization, secret hygiene | Directly exercises deterministic TS logic with no DB dependency. |
| **2. In-Memory Mock Tests** | `delivery.service.test.ts`, `group-precreation.service.test.ts`, `audit-and-ratelimit-wiring.test.ts`, `track-b-security.test.ts` (RPC wrappers & reconciliation), `apps/bot/test/*`, `packages/database/test/*` | Proves JS control flow, error propagation, and RPC argument construction against hand-written test doubles; **does not execute PostgreSQL SQL, RLS, or triggers**. |
| **3. Static SQL / Config Contract Tests** | `track-a1-vercel.test.ts`, `migration-security.test.ts`, `track-b-security.test.ts` SQL regex assertions | Verifies presence/spelling of staged DDL/JSON constructs; **cannot detect PostgreSQL catalog behaviors such as `pg_default_acl` retaining `anon` `EXECUTE` when `FROM PUBLIC` omits `FROM anon`**. |
| **4. Live PostgreSQL / RLS / Trigger / Concurrency Tests** | **None (`0` executed)** | **Not yet exercised live.** Live DB still runs `01–05`, holds `0` auth users/profiles, and remains under write freeze. Real `FOR UPDATE` locking races, `DEFERRABLE INITIALLY DEFERRED` size bounds, and `authenticated` RLS enforcement remain untested in live PostgreSQL. |

### 8.3 Remaining Open Risks & Unresolved Items

1. **`anon` `EXECUTE` on `public` Functions (`Advisor 0028`):** Staged migrations `20261111000001` and `20261111000002` omit `FROM anon` in `REVOKE ALL ON FUNCTION ... FROM PUBLIC;`. Adding `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon;` before push (plus revoking `anon` on Migration `05` functions) is strongly recommended so least-privilege PostgREST permissions and Supabase Advisor `0028` pass cleanly.
2. **In-Memory Rate Limiter & Bot Session Scope:** `MemoryRateLimiter` ([`apps/web/src/lib/security/rate-limiter.ts`](../apps/web/src/lib/security/rate-limiter.ts)) and grammY's default `session()` ([`apps/bot/src/bot.ts`](../apps/bot/src/bot.ts)) are process-local/in-memory only and do not synchronize across concurrent serverless instances or survive cold restarts.
3. **Unapplied Schema Dependency:** Production web code must not go live before `20261111000001` and `20261111000002` succeed remotely.
4. **Live RBAC & Concurrency Gap:** Post-migration smoke verification with real `authenticated` (`system_owner`, active `representative`, deactivated `representative`, and unauthorized student/anon) tokens is still required after push.
5. **Unexplained Remote Bucket (`development`):** Live storage contains both `submission-files-vault` (`public: false`, `50 MiB`, strict MIME whitelist) and an unrestricted private `development` bucket (`file_size_limit: null`, `allowed_mime_types: null`). Confirm whether `development` should be removed before production launch.
6. **Git Hygiene Before PR/Deploy:** Unstaged `supabase/seed.sql` local identity change and `apps/web/tsconfig.tsbuildinfo` must be handled per [`docs/TRACK_B_GIT_STAGING_PLAN.md`](TRACK_B_GIT_STAGING_PLAN.md) prior to clean commits/merge.

---

## 9. Deployment Readiness Classification

### **Preflight Classification: `READY FOR CONTROLLED MIGRATION REVIEW`**

> **Live Production Launch Status: `NOT READY / BLOCKED`** under the active deployment freeze. The codebase is ready **only to enter controlled migration review** (zero duplicate registration conflicts, fail-closed C1/C2 RPC wiring verified, Track A1 config verified locally, all 203 local tests passing).

**Mandatory Sequential Gates Before Production Go-Live:**
1. **Optional Pre-Push Security Refinement (Recommended):** With explicit user authorization, amend `20261111000001` and `20261111000002` (and Migration `05` live functions) to `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon;` to eliminate `anon` `EXECUTE` exposure (`Advisor 0028`).
2. **Controlled Migration Push:** Obtain explicit authorization to run controlled `supabase db push` for `20261111000001` and `20261111000002` (never `--include-all` without explicit migration reconciliation).
3. **Post-Push Live DB Verification:** Re-query `pg_proc`, `pg_policies`, `pg_trigger`, and `supabase db advisors --remote --type security`; verify real `authenticated` RBAC boundaries, `FOR UPDATE` RPCs, and deferred constraint triggers with test transactions.
4. **Clean Git Commits & System Owner Provisioning:** Stage/commit Track A1 & Track B changes cleanly (excluding `supabase/seed.sql` and `apps/web/tsconfig.tsbuildinfo`), bootstrap the initial `system_owner` account, and confirm `development` storage bucket disposition.
5. **Vercel Monorepo Deployment:** Verify Vercel Root Directory = `apps/web`, "Include files outside the root directory in the Build Step" enabled, and required Supabase environment variables set before deploying.
