# HU-ASMS — Track B Security Remediation Report (Local-Only Verification)

> **DEPLOYMENT FREEZE ACTIVE:** All security remediation SQL, privilege hardening, and verification tests documented in this report were performed **strictly locally**. No remote database migration (`supabase db push`, `supabase migration up`), no remote SQL modification, no Vercel deployment, and no Git staging, commit, push, merge, or reset was executed.

---

## 1. Original Findings (Preflight & Read-Only Live Catalog Audit)

Prior to local remediation, read-only inspection against linked production Supabase project `hu-accadamic assistent` (`mqfbqszvdwhizffdbjnp`, Supabase CLI `3.1.0`) established the following verified security posture:

1. **All `9` Live `public` Functions Exposed `EXECUTE` to `anon`:**
   - **Six functions (`5` `SECURITY DEFINER` + `1` `SECURITY INVOKER` trigger)** had `public_exec = false` (`=X` revoked from `PUBLIC` by Migration `05`), yet still evaluated to `anon_exec = true` (`has_function_privilege('anon', ..., 'EXECUTE') = true`):
     - `public.auth_is_system_owner()` (`prosecdef = true`)
     - `public.auth_is_rep_for_section(uuid)` (`prosecdef = true`)
     - `public.auth_get_assigned_section_ids()` (`prosecdef = true`)
     - `public.admin_set_profile_status(uuid, public.user_role, boolean)` (`prosecdef = true`)
     - `public.record_scoped_audit_log(text, text, uuid, jsonb)` (`prosecdef = true`)
     - `public.protect_profile_privileged_columns()` (`prosecdef = false`, `used_by_trigger = true`)
   - **Three `SECURITY INVOKER` trigger functions** lacked any `REVOKE` or `GRANT` statements in Migrations `01`/`05` and retained **both** `public_exec = true` (`=X`) and `anon_exec = true` (`anon=X`):
     - `public.update_timestamp_column()`
     - `public.enforce_single_group_per_project()`
     - `public.check_and_update_group_verification()`
2. **Root Cause in Supabase Default ACLs (`pg_default_acl`):**
   - Supabase configures `pg_default_acl` in schema `public` to automatically grant `EXECUTE` to `anon` for functions created by `postgres` and `supabase_admin`.
   - [`supabase/migrations/20261110000005_security_hardening.sql`](../supabase/migrations/20261110000005_security_hardening.sql) ran `REVOKE ALL ON FUNCTION ... FROM PUBLIC;` without naming `anon`, leaving explicit `anon=X` ACL entries intact.
   - Migration `05` hardened `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public REVOKE ALL ON TABLES/SEQUENCES`, omitting `FUNCTIONS`.
   - Exposing `SECURITY DEFINER` functions to `anon` triggers Supabase Security Advisor `0028` warnings, whereas authenticated-only `SECURITY DEFINER` helpers/RPCs intentionally raise informational Advisor `0029` notices.
3. **Host Role Constraints Affecting Future Default ACL Hardening:**
   - On hosted Supabase, `postgres` has `rolsuper = false` and `pg_has_role('postgres', 'supabase_admin', 'MEMBER') = false`, while `cli_login_postgres` is a member of `postgres`. Unconditional `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ...` inside a CLI migration would fail during remote push unless dynamically guarded.
4. **Verified Positive Baselines Preserved:**
   - Live `public` table/sequence privileges for `anon` are empty (`table_privs_anon = []`).
   - Live `public` RLS policies targeting `anon` or `PUBLIC` are empty (`anon_or_public_policies = []`).
   - Live `storage.objects` policies (`owner_full_storage_access`, `representative_read_storage_objects`) target `authenticated` only.
   - Zero custom triggers exist in `auth`, and `storage` triggers are platform-managed only.
   - Unapplied Track B migrations `20261111000001` and `20261111000002` had likewise inherited the `FROM PUBLIC;` pattern before remediation (and `20261111000002` omitted explicit `REVOKE`/`GRANT` on its updated `check_and_update_group_verification()`).
5. **Local Tooling Constraints Recorded Honestly:**
   - ESLint is **not configured** in this repository: all `6` workspace `package.json` `"lint"` scripts run `tsc --noEmit`, and no project `.eslintrc*` or `eslint.config.*` files exist outside `node_modules`.
   - Neither `docker` nor `psql` is installed locally, so `0` live PostgreSQL integration tests can execute in the local environment.

---

## 2. Exact Local Security Changes Implemented

Previously applied migrations [`20261110000001_initial_schema.sql`](../supabase/migrations/20261110000001_initial_schema.sql) through [`20261110000005_security_hardening.sql`](../supabase/migrations/20261110000005_security_hardening.sql) remain **100% unmodified** (`git diff` across all five returns empty output).

All remediation changes were applied strictly locally:

1. **Updated Unapplied Migration [`supabase/migrations/20261111000001_track_b_rep_active_profile_guard.sql`](../supabase/migrations/20261111000001_track_b_rep_active_profile_guard.sql) (`L43–47`):**
   - Changed `REVOKE ALL ON FUNCTION ... FROM PUBLIC;` to `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon;` for `public.auth_is_rep_for_section(UUID)` and `public.auth_get_assigned_section_ids()`, while preserving `GRANT EXECUTE ... TO authenticated, service_role;`.
2. **Updated Unapplied Migration [`supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql`](../supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql):**
   - Updated all `9` existing `REVOKE ALL ON FUNCTION ... FROM PUBLIC;` statements (`approve_student_registration`, `reject_student_registration`, `mark_delivery_sent_with_audit`, `is_project_targeted_to_section`, `enforce_group_integrity`, `enforce_group_member_integrity`, `enforce_group_member_size_bounds`, `enforce_delivery_integrity`, `enforce_delivery_item_integrity`) to `FROM PUBLIC, anon;`.
   - Added explicit privilege lockdown after the recreated trigger function `public.check_and_update_group_verification()` (`REVOKE ALL ON FUNCTION public.check_and_update_group_verification() FROM PUBLIC, anon;` and `GRANT EXECUTE ON FUNCTION public.check_and_update_group_verification() TO authenticated, service_role;`).
3. **Created New Corrective Forward Migration [`supabase/migrations/20261111000003_track_b_function_privilege_and_default_acl_hardening.sql`](../supabase/migrations/20261111000003_track_b_function_privilege_and_default_acl_hardening.sql):**
   - Remediates live production functions without altering applied Migration `05`, idempotently locks down all `18` `public` functions (`PUBLIC` + `anon` revoked; `authenticated` + `service_role` granted), hardens default function ACLs safely for hosted Supabase roles, and runs an in-transaction `DO $$` verification block.
4. **Hardened Existing Track B Test Contract [`apps/web/test/track-b-security.test.ts`](../apps/web/test/track-b-security.test.ts):**
   - Updated SQL contract assertions (`L805–808`, `L1542–1562`) to enforce `FROM PUBLIC, anon;` (plus `check_and_update_group_verification()`) and assert that no `GRANT EXECUTE ... TO anon` exists in unapplied Track B migrations.
5. **Added Focused Privilege & Negative End-to-End Contract Suite [`apps/web/test/track-b-privilege-and-sql-hardening.test.ts`](../apps/web/test/track-b-privilege-and-sql-hardening.test.ts):**
   - Added `9` new tests across `2` suites verifying monotonic migration sequence, untouched Migration `05`, explicit `PUBLIC, anon` revokes across all `18` functions, guarded `supabase_admin` default ACLs, self-verification block assertions, and negative mocked end-to-end rejection/no-compensation behavior across anonymous, inactive, foreign-section, cross-section member, and RPC failure scenarios.

---

## 3. New Migration Details & Sequence Compatibility

- **Filename:** `supabase/migrations/20261111000003_track_b_function_privilege_and_default_acl_hardening.sql`
- **Status:** Local-only (`"remote":""` confirmed by `npx supabase migration list --remote`).

### SQL Summary (`148` lines)
1. **Explicit `PUBLIC` + `anon` Revoke & Scoped Grant on All `9` Previously Deployed Functions (`L23–49`):**
   - `REVOKE ALL ON FUNCTION <sig> FROM PUBLIC, anon;` and `GRANT EXECUTE ON FUNCTION <sig> TO authenticated, service_role;` for the `5` `SECURITY DEFINER` helpers/RPCs (`auth_is_system_owner`, `auth_is_rep_for_section`, `auth_get_assigned_section_ids`, `admin_set_profile_status`, `record_scoped_audit_log`) and `4` `SECURITY INVOKER` trigger functions (`update_timestamp_column`, `enforce_single_group_per_project`, `check_and_update_group_verification`, `protect_profile_privileged_columns`).
2. **Idempotent Re-Enforcement on All `9` Track B Functions from `20261111000002` (`L55–80`):**
   - Re-applies `REVOKE ALL ... FROM PUBLIC, anon;` + `GRANT EXECUTE ... TO authenticated, service_role;` for `approve_student_registration`, `reject_student_registration`, `mark_delivery_sent_with_audit`, `is_project_targeted_to_section`, `enforce_group_integrity`, `enforce_group_member_integrity`, `enforce_group_member_size_bounds`, `enforce_delivery_integrity`, and `enforce_delivery_item_integrity`.
3. **Default Function Privilege Hardening (`L86–95`):**
   - Unconditionally executes `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon;`.
   - Wraps `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon;` in `IF EXISTS (...) AND pg_has_role(current_user, 'supabase_admin', 'MEMBER')` so hosted Supabase pushes running as `postgres`/`cli_login_postgres` succeed without role-escalation failures.
4. **Post-Apply Catalog Self-Verification Assertions (`L101–148`):**
   - Iterates over all `18` `regprocedure` signatures in a `DO $$` block, raising an exception if any signature is missing (`to_regprocedure(v_sig) IS NULL`), if `has_function_privilege('anon', ...)` or `has_function_privilege('public', ...)` is `true`, or if `has_function_privilege('authenticated', ...)` or `has_function_privilege('service_role', ...)` is `false`.

### Verified Migration Sequence (`npx supabase migration list --remote`)

| Version | Migration Filename | Remote Status | Local Status | Action Needed When Freeze Lifts |
|---|---|---|---|---|
| `20261110000001` | `20261110000001_initial_schema.sql` | Applied | Unmodified | None |
| `20261110000002` | `20261110000002_row_level_security.sql` | Applied | Unmodified | None |
| `20261110000003` | `20261110000003_storage_setup.sql` | Applied | Unmodified | None |
| `20261110000004` | `20261110000004_delivery_items_rep_policy.sql` | Applied | Unmodified | None |
| `20261110000005` | `20261110000005_security_hardening.sql` | Applied | Unmodified | None |
| `20261111000001` | `20261111000001_track_b_rep_active_profile_guard.sql` | Pending (`""`) | Modified (`FROM PUBLIC, anon`) | Apply in order (`1st`) |
| `20261111000002` | `20261111000002_track_b_atomic_rpcs_and_db_parity.sql` | Pending (`""`) | Modified (`FROM PUBLIC, anon` + verification grant) | Apply in order (`2nd`) |
| `20261111000003` | `20261111000003_track_b_function_privilege_and_default_acl_hardening.sql` | Pending (`""`) | New forward migration | Apply in order (`3rd`) |

---

## 4. Function-by-Function Permission Matrix (All `18` `public` Functions)

In PostgreSQL, `SECURITY INVOKER` triggers still require `EXECUTE` for whichever role initiates DML on the table (`authenticated` via RLS-scoped web clients, `service_role` via server/bot clients). No `anon` DML is permitted anywhere in schema `public` or `storage`.

| # | Exact Signature | Origin | Security Mode | Required Callers / Dependencies | `PUBLIC` | `anon` | `authenticated` | `service_role` | Security Rationale |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `public.auth_is_system_owner()` | `02` / `05` | `SECURITY DEFINER` | RLS policies, `storage` policies, `admin_*` / `record_scoped_audit_log` / C2 RPCs | **REVOKED** | **REVOKED** | `EXECUTE` | `EXECUTE` | RLS & RPC predicate; internal `auth.uid()` + active `system_owner` check denies unauthenticated callers. |
| 2 | `public.auth_is_rep_for_section(UUID)` | `02` / `05` / `000001` | `SECURITY DEFINER` | RLS policies, `storage.objects` rep policy, `record_scoped_audit_log`, `mark_delivery_sent_with_audit` | **REVOKED** | **REVOKED** | `EXECUTE` | `EXECUTE` | Evaluates section scope + active profile check; never needed by anonymous role. |
| 3 | `public.auth_get_assigned_section_ids()` | `02` / `05` / `000001` | `SECURITY DEFINER` | Authenticated rep queries / RLS scope filters | **REVOKED** | **REVOKED** | `EXECUTE` | `EXECUTE` | Returns active section assignments for `auth.uid()` joined to active staff profile only. |
| 4 | `public.admin_set_profile_status(UUID, public.user_role, BOOLEAN)` | `05` | `SECURITY DEFINER` | System Owner / server admin role/activation workflows | **REVOKED** | **REVOKED** | `EXECUTE` | `EXECUTE` | Internal check enforces `auth_is_system_owner()` or `service_role`; rejects `anon` at both ACL & body layers. |
| 5 | `public.record_scoped_audit_log(TEXT, TEXT, UUID, JSONB)` | `05` | `SECURITY DEFINER` | Authenticated web services (`audit-helper.ts`), RPC audit path, bot/admin `service_role` | **REVOKED** | **REVOKED** | `EXECUTE` | `EXECUTE` | Allows scoped audit writes without granting direct `INSERT` on `audit_logs`; rejects anonymous callers. |
| 6 | `public.update_timestamp_column()` | `01` | `SECURITY INVOKER` | `BEFORE UPDATE` triggers on tables with `updated_at` | **REVOKED** | **REVOKED** | `EXECUTE` | `EXECUTE` | Trigger executes under calling DML role (`authenticated` / `service_role`); `anon` performs zero table DML. |
| 7 | `public.enforce_single_group_per_project()` | `01` | `SECURITY INVOKER` | DML trigger preventing dual active group membership | **REVOKED** | **REVOKED** | `EXECUTE` | `EXECUTE` | Needed when `authenticated` or `service_role` mutates `group_members`. |
| 8 | `public.check_and_update_group_verification()` | `01` / `000002` | `SECURITY INVOKER` | DML trigger recalculating `groups.is_verified` | **REVOKED** | **REVOKED** | `EXECUTE` | `EXECUTE` | Runs under calling DML role when `group_members` confirm/decline/delete. |
| 9 | `public.protect_profile_privileged_columns()` | `05` | `SECURITY INVOKER` | `BEFORE UPDATE` trigger on `profiles` | **REVOKED** | **REVOKED** | `EXECUTE` | `EXECUTE` | Blocks non-owner profile role/`is_active` privilege escalation during updates. |
| 10 | `public.approve_student_registration(UUID, TEXT)` | `000002` | `SECURITY DEFINER` | `student-approval-service.ts` (C2 atomic approval + student upsert + audit) | **REVOKED** | **REVOKED** | `EXECUTE` | `EXECUTE` | Internal guard requires `auth_is_system_owner()` or `service_role`; `anon` rejected at ACL & body layers. |
| 11 | `public.reject_student_registration(UUID, TEXT)` | `000002` | `SECURITY DEFINER` | `student-approval-service.ts` (C2 atomic rejection + audit) | **REVOKED** | **REVOKED** | `EXECUTE` | `EXECUTE` | Internal guard requires `auth_is_system_owner()` or `service_role`; `anon` rejected at ACL & body layers. |
| 12 | `public.mark_delivery_sent_with_audit(UUID, TEXT)` | `000002` | `SECURITY DEFINER` | `delivery-service.ts` (C1 atomic `prepared -> sent` transition + audit) | **REVOKED** | **REVOKED** | `EXECUTE` | `EXECUTE` | Internal guard enforces active staff (`system_owner` or assigned rep) / `service_role`; no anonymous access. |
| 13 | `public.is_project_targeted_to_section(UUID, UUID)` | `000002` | `SECURITY INVOKER` | C3 trigger checks on `groups` / `deliveries` | **REVOKED** | **REVOKED** | `EXECUTE` | `EXECUTE` | Invoker helper evaluated during authenticated/`service_role` group & delivery inserts. |
| 14 | `public.enforce_group_integrity()` | `000002` | `SECURITY INVOKER` | C3 `BEFORE INSERT/UPDATE` trigger on `groups` | **REVOKED** | **REVOKED** | `EXECUTE` | `EXECUTE` | Enforces section/project target/precreation status invariants on DML. |
| 15 | `public.enforce_group_member_integrity()` | `000002` | `SECURITY INVOKER` | C3 trigger on `group_members` | **REVOKED** | **REVOKED** | `EXECUTE` | `EXECUTE` | Enforces section parity, approved student status, and confirmation rules. |
| 16 | `public.enforce_group_member_size_bounds()` | `000002` | `SECURITY INVOKER` | C3 `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` on `group_members` | **REVOKED** | **REVOKED** | `EXECUTE` | `EXECUTE` | Enforces min/max group bounds at transaction commit for `authenticated` & `service_role`. |
| 17 | `public.enforce_delivery_integrity()` | `000002` | `SECURITY INVOKER` | C3 trigger on `deliveries` | **REVOKED** | **REVOKED** | `EXECUTE` | `EXECUTE` | Enforces non-revert transition rules and batch/target integrity. |
| 18 | `public.enforce_delivery_item_integrity()` | `000002` | `SECURITY INVOKER` | C3 trigger on `delivery_items` | **REVOKED** | **REVOKED** | `EXECUTE` | `EXECUTE` | Enforces section/project parity and prevents deleting items after `prepared`. |

---

## 5. Tests Added & Local Verification Results (Task 4)

### Commands Executed After Final Edit

| Check | Exact Command | Exit Code | Observed Result |
|---|---|---|---|
| **Typecheck (6 workspaces)** | `npm run typecheck` | `0` | Passed cleanly across `@hu-asms/bot`, `@hu-asms/web`, `@hu-asms/database`, `@hu-asms/shared`, `@hu-asms/types`, `@hu-asms/validation` (`tsc --noEmit`). |
| **Workspace Test Suite** | `npm test` | `0` | `@hu-asms/bot`: **`88` pass / `0` fail / `27` suites**; `@hu-asms/web`: **`109` pass / `0` fail / `27` suites**; `@hu-asms/database`: **`15` pass / `0` fail / `10` suites**; `@hu-asms/shared`, `@hu-asms/types`, `@hu-asms/validation`: `node --version` (`v26.13.0`). **Total: `212` tests / `64` suites / `212` pass / `0` fail / `0` skipped.** |
| **Test Coverage Run** | `npm run test:coverage` | `0` | **`212` tests / `64` suites / `212` pass / `0` fail / `0` skipped** (`2895.44ms`). Aggregate coverage across instrumented files: **`76.33%` line**, **`76.17%` branch**, **`72.29%` function**. |
| **Production Build** | `npm run build` | `0` | Compiled `@hu-asms/types`, `@hu-asms/shared`, `@hu-asms/validation`, `@hu-asms/database`, `@hu-asms/bot` via `tsc`, and `@hu-asms/web` via Next.js `15.5.29` (`✓ Generating static pages (21/21)`, Middleware `95 kB`). |
| **Git Whitespace / Patch Check** | `git diff --check` | `0` | Clean exit (`0`), no whitespace errors or conflict markers. |
| **ESLint Check** | Workspace config inspection + `package.json` audit | **Not Configured** | No project `.eslintrc*` or `eslint.config.*` exists; all `6` `"lint"` scripts alias `tsc --noEmit` despite `eslint` / `eslint-config-next` in `apps/web/package.json`. **ESLint rule linting did NOT run.** |

### Key Security Module Coverage (`npm run test:coverage`)
- `apps/web/src/lib/security/rate-limiter.ts`: `100.00%` line / `96.43%` branch / `100.00%` func
- `apps/web/src/lib/auth/role-policy.ts`: `100.00%` line / `100.00%` branch / `100.00%` func
- `apps/web/src/lib/rep/audit-helper.ts`: `100.00%` line / `75.00%` branch / `100.00%` func
- `apps/web/src/lib/rep/input-validation.ts`: `98.33%` line / `85.19%` branch / `100.00%` func
- `apps/web/src/lib/rep/delivery-service.ts`: `97.10%` line / `80.33%` branch / `93.33%` func
- `apps/web/src/lib/auth/roles.ts`: `95.41%` line / `94.67%` branch / `92.31%` func
- `apps/web/src/lib/admin/student-approval-service.ts`: `94.84%` line / `78.57%` branch / `100.00%` func
- `apps/web/src/lib/rep/group-precreation-service.ts`: `94.83%` line / `82.80%` branch / `100.00%` func
- `apps/web/src/lib/auth/middleware-guard.ts`: `93.18%` line / `93.10%` branch / `100.00%` func
- `apps/web/src/lib/rep/submission-file-service.ts`: `90.72%` line / `79.31%` branch / `100.00%` func

### Honest Test Classification (`212` Total Tests Across `64` Suites)
- **Pure Unit Tests:** Input validation, filename sanitization, HU ID validation, webhook HMAC/secret timing comparison, PII error redaction, `MemoryRateLimiter` sliding-window/LRU eviction, canonical role policy assertions, and `assertSystemOwner`/`assertRepresentativeSectionScope`/`resolveAuthorizedSectionScope` logic.
- **Mocked Unit & Service Integration Tests (Supabase / Storage / Telegram Mocks):** Bot submission, group, reporting, registration, middleware, webhook localhost HTTP tests, and web `admin`/`rep` service tests (`executeApproveRegistration`, `executeRejectRegistration`, `executePrepareDeliveryBatch`, `executeDispatchDelivery`, `executeAcknowledgeDelivery`, `executeGetDeliveryPackageManifest`, `executeCreateProjectGroup`, `executeGetSubmissionFileDownloadUrl`), including the **`5` new negative mocked tests** in [`apps/web/test/track-b-privilege-and-sql-hardening.test.ts`](../apps/web/test/track-b-privilege-and-sql-hardening.test.ts) (`L213–590`).
- **Static SQL & Configuration Contract Verification Tests:** [`apps/web/test/track-a1-vercel.test.ts`](../apps/web/test/track-a1-vercel.test.ts), Migration `05` checks in `audit-and-ratelimit-wiring.test.ts`, `20261111000001`/`20261111000002` checks in `track-b-security.test.ts`, and **`4` new static SQL contract tests** in [`apps/web/test/track-b-privilege-and-sql-hardening.test.ts`](../apps/web/test/track-b-privilege-and-sql-hardening.test.ts) (`L96–211`).
- **Live PostgreSQL / Hosted Supabase Integration Tests:** **`0` executed.** Because the deployment freeze blocks remote writes and no local Docker/PostgreSQL instance exists here, live PostgreSQL ACL queries (`has_function_privilege`), trigger firing order, constraint triggers, and RLS policy enforcement remain unverified against a running database engine until controlled deployment.

---

## 6. Remaining Security Risks & Operational Limitations

1. **Unapplied Migrations Remotely Until Freeze Lifts (High Operational Risk):**
   - Linked Supabase project `mqfbqszvdwhizffdbjnp` still has only `20261110000001–05` applied. Remotely, all `9` live `public` functions remain `anon_exec = true` (and `3` triggers retain `PUBLIC = X`), while C1/C2/C3 RPCs and constraints (`approve_student_registration`, `reject_student_registration`, `mark_delivery_sent_with_audit`, duplicate pending registration unique indexes, integrity triggers) do not yet exist in production.
   - **Coupling Hazard:** Do **not** deploy Vercel web builds from the Track B working tree before applying `20261111000001`, `20261111000002`, and `20261111000003`, because `student-approval-service.ts` and `delivery-service.ts` invoke those RPCs in production.
2. **`supabase_admin` Default Function Privileges on Hosted Supabase:**
   - Because hosted `postgres` is not a member of `supabase_admin`, Migration `20261111000003` only modifies `FOR ROLE supabase_admin` when `pg_has_role(current_user, 'supabase_admin', 'MEMBER')` is true. Therefore, any future function created directly as `supabase_admin` (for example via dashboard SQL editor extensions) must still include explicit `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon;` and `GRANT EXECUTE ... TO authenticated, service_role;` statements.
3. **Supabase Security Advisor `0029` Notices:**
   - Even after `20261111000003` clears `anon` `0028` warnings, Supabase Advisor rule `0029` may continue to surface informational notices for `SECURITY DEFINER` helpers/RPCs granted to `authenticated` (`auth_*`, `admin_set_profile_status`, `record_scoped_audit_log`, `approve_student_registration`, `reject_student_registration`, `mark_delivery_sent_with_audit`). Every one of those routines enforces internal `auth.uid()`, active staff profile (`is_active = true`), and role/section checks or `service_role` gating.
4. **In-Memory Rate Limiter & Bot Session Scope:**
   - [`apps/web/src/lib/security/rate-limiter.ts`](../apps/web/src/lib/security/rate-limiter.ts) (`MemoryRateLimiter`) and [`apps/bot/src/bot.ts`](../apps/bot/src/bot.ts) default `session()` (`L65–67`) keep state only in local Node.js memory. Counters and multi-step Telegram conversation sessions reset on cold starts and are not synchronized across multi-instance Vercel serverless deployments; a shared backing store (e.g., Redis/Upstash or Postgres session storage) is required before multi-instance scaling.
5. **Zero Live Database Runtime Tests:**
   - All `212` passing checks are local unit, mocked service, or static SQL contract tests. Live DB behavior (including `DEFERRABLE INITIALLY DEFERRED` group size constraint trigger semantics and `SELECT ... FOR UPDATE` concurrency) must be verified immediately upon staging/production push.
6. **Repository & Config Hygiene Gaps Outside Track B Scope:**
   - ESLint is unconfigured (`tsc --noEmit` only).
   - Preserved local seed change in [`supabase/seed.sql`](../supabase/seed.sql) (`L136`) and regenerated `apps/web/tsconfig.tsbuildinfo` remain in the working tree and must not accidentally enter security commits.

---

## 7. Complete Git Hygiene Audit & Proposed Staging Plan (Task 5)

Current verified working tree on branch `phase-14-security-hardening` at `HEAD` `6e2c5f8`: **`60` total paths** (`1` deleted `D`, `39` modified `M`, `20` untracked `??` including this report).

### Classification Summary Across All `60` Working-Tree Entries

| Category | Count | Disposition |
|---|---:|---|
| **1. Intended source change** | `35` | `1` intentional root config deletion (`vercel.json`) + `29` modified Track A1/B app/config/validation files + `5` updated regression test files. Stage in Waves `1`, `3`, and `4`. |
| **2. Intended migration or documentation** | `6` | `3` updated architecture/security docs (`M`) + `3` staged forward SQL migrations `20261111000001–03` (`??`, code-ready only — **never** `db push` during freeze). |
| **3. Generated build artifact** | `1` | `apps/web/tsconfig.tsbuildinfo` (`M`) regenerated by local TypeScript builds/typechecks. Exclude from security commits (restore or ignore separately). |
| **4. Accidental change or deletion** | `1` | `supabase/seed.sql` (`M`, pre-existing local representative row edit at `L136`). **Preserved untouched** per user instruction; keep excluded from security commits. (Note: `D vercel.json` is an **intentional** Track A1 fix, not accidental.) |
| **5. Untracked file requiring review** | `17` | `7` new Track A1/B web modules/config + `3` new regression test files (ready to review & stage) + `7` Track B recovery/audit/remediation Markdown docs under `docs/` (decide whether to commit as permanent audit trail or exclude). |
| **Total** | **`60`** | **Every working-tree path accounted for with zero omissions.** |

### File-by-File Inventory (`60` Entries)

#### Category 1 — Intended Source Change (`35` files)
- `D vercel.json` (intentional deletion of BOM-encoded conflicting root config)
- `M apps/web/next.config.mjs`
- `M packages/validation/src/index.ts`
- `M apps/web/src/app/(auth)/login/page.tsx`
- `M apps/web/src/middleware.ts`
- `M apps/web/src/lib/auth/roles.ts`
- `M apps/web/src/lib/rep/delivery-service.ts`
- `M apps/web/src/lib/rep/group-precreation-service.ts`
- `M apps/web/src/lib/rep/submission-file-service.ts`
- `M apps/web/src/lib/security/rate-limiter.ts`
- `M apps/web/src/app/admin/layout.tsx`
- `M apps/web/src/app/admin/page.tsx`
- `M apps/web/src/app/admin/academics/page.tsx`
- `M apps/web/src/app/admin/academics/projects/page.tsx`
- `M apps/web/src/app/admin/audit-logs/page.tsx`
- `M apps/web/src/app/admin/representatives/page.tsx`
- `M apps/web/src/app/admin/structure/page.tsx`
- `M apps/web/src/app/admin/students/page.tsx`
- `M apps/web/src/app/rep/layout.tsx`
- `M apps/web/src/app/rep/page.tsx`
- `M apps/web/src/app/rep/deliveries/actions.ts`
- `M apps/web/src/app/rep/deliveries/new/page.tsx`
- `M apps/web/src/app/rep/deliveries/page.tsx`
- `M apps/web/src/app/rep/groups/actions.ts`
- `M apps/web/src/app/rep/groups/new/page.tsx`
- `M apps/web/src/app/rep/groups/page.tsx`
- `M apps/web/src/app/rep/reports/page.tsx`
- `M apps/web/src/app/rep/students/page.tsx`
- `M apps/web/src/app/rep/submissions/actions.ts`
- `M apps/web/src/app/rep/submissions/page.tsx`
- `M apps/web/test/audit-and-ratelimit-wiring.test.ts`
- `M apps/web/test/auth-roles.test.ts`
- `M apps/web/test/delivery.service.test.ts`
- `M apps/web/test/group-precreation.service.test.ts`
- `M apps/web/test/security-hardening.test.ts`

#### Category 2 — Intended Migration or Documentation (`6` files)
- `M docs/ADMINISTRATIVE_DASHBOARD.md`
- `M docs/SECURITY_AND_HARDENING.md`
- `M docs/SYSTEM_ARCHITECTURE.md`
- `?? supabase/migrations/20261111000001_track_b_rep_active_profile_guard.sql`
- `?? supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql`
- `?? supabase/migrations/20261111000003_track_b_function_privilege_and_default_acl_hardening.sql`

#### Category 3 — Generated Build Artifact (`1` file)
- `M apps/web/tsconfig.tsbuildinfo` *(Exclude from commits; regenerated by local `tsc`)*

#### Category 4 — Accidental / Unrelated Change Preserved (`1` file)
- `M supabase/seed.sql` *(Pre-existing local edit on `L136`; preserved untouched, exclude from Track A1/B commits unless explicitly intended)*

#### Category 5 — Untracked File Requiring Review (`17` files)
- **Intended New Application Modules / Config (`7`):**
  - `?? apps/web/vercel.json`
  - `?? apps/web/src/components/rep/scope-access-error.tsx`
  - `?? apps/web/src/lib/admin/student-approval-service.ts`
  - `?? apps/web/src/lib/auth/middleware-guard.ts`
  - `?? apps/web/src/lib/auth/page-guards.ts`
  - `?? apps/web/src/lib/auth/role-policy.ts`
  - `?? apps/web/src/lib/rep/input-validation.ts`
- **Intended New Security Regression & Contract Tests (`3`):**
  - `?? apps/web/test/track-a1-vercel.test.ts`
  - `?? apps/web/test/track-b-security.test.ts`
  - `?? apps/web/test/track-b-privilege-and-sql-hardening.test.ts`
- **Point-in-Time Track B Audit & Remediation Reports (`7` — review retention vs archival):**
  - `?? docs/INTERRUPTED_WORK_RECOVERY_REPORT.md`
  - `?? docs/TRACK_B_LOCAL_CORRECTIONS.md`
  - `?? docs/TRACK_B_FINAL_REVIEW.md`
  - `?? docs/TRACK_B_CORRECTION_PLAN.md`
  - `?? docs/TRACK_B_GIT_STAGING_PLAN.md`
  - `?? docs/TRACK_B_FINAL_DEPLOYMENT_PREFLIGHT.md`
  - `?? docs/TRACK_B_SECURITY_REMEDIATION_REPORT.md`

### Proposed Clean Staging Waves (For User Execution After Approval)

```powershell
# Wave 1 — Track A1 Vercel Monorepo Configuration & Architecture Doc
git add vercel.json apps/web/vercel.json apps/web/next.config.mjs docs/SYSTEM_ARCHITECTURE.md apps/web/test/track-a1-vercel.test.ts
git commit -m "fix(vercel): move BOM-free vercel.json into apps/web with monorepo tracing root"

# Wave 2 — Track B Staged Forward Migrations (Apply to Supabase BEFORE deploying Wave 3 to Vercel)
git add supabase/migrations/20261111000001_track_b_rep_active_profile_guard.sql supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql supabase/migrations/20261111000003_track_b_function_privilege_and_default_acl_hardening.sql
git commit -m "chore(db): stage Track B active-profile RLS guard, atomic RPCs, and function privilege hardening"

# Wave 3 — Track B Application Security Hardening
git add packages/validation/src/index.ts apps/web/src/middleware.ts apps/web/src/lib/ apps/web/src/components/rep/scope-access-error.tsx "apps/web/src/app/(auth)/login/page.tsx" apps/web/src/app/admin/ apps/web/src/app/rep/
git commit -m "fix(security): enforce fail-closed role guards, atomic RPC wrappers, and rate-limiter bounds"

# Wave 4 — Security Regression Tests & Reviewed Documentation (choose whether to include all Track B audit reports)
git add apps/web/test/audit-and-ratelimit-wiring.test.ts apps/web/test/auth-roles.test.ts apps/web/test/delivery.service.test.ts apps/web/test/group-precreation.service.test.ts apps/web/test/security-hardening.test.ts apps/web/test/track-b-security.test.ts apps/web/test/track-b-privilege-and-sql-hardening.test.ts docs/ADMINISTRATIVE_DASHBOARD.md docs/SECURITY_AND_HARDENING.md
# Optional audit trail docs: docs/INTERRUPTED_WORK_RECOVERY_REPORT.md docs/TRACK_B_LOCAL_CORRECTIONS.md docs/TRACK_B_FINAL_REVIEW.md docs/TRACK_B_CORRECTION_PLAN.md docs/TRACK_B_GIT_STAGING_PLAN.md docs/TRACK_B_FINAL_DEPLOYMENT_PREFLIGHT.md docs/TRACK_B_SECURITY_REMEDIATION_REPORT.md
git commit -m "test(security): add Track B function privilege contract tests and remediation docs"

# Intentionally excluded from all waves: supabase/seed.sql and apps/web/tsconfig.tsbuildinfo
```

---

## 8. Explicit Deployment Freeze Confirmation

I explicitly confirm that throughout this session:
- **Zero remote database modifications** were executed (`supabase db push`, `supabase migration up`, `supabase migration repair`, and all remote write SQL statements were strictly avoided; only read-only catalog inspection via `--read-only` / `migration list --remote` was used).
- **Previously applied migrations (`20261110000001`–`20261110000005`) were NOT modified.**
- **Zero Vercel deployments** were executed or triggered.
- **Zero Git write operations** (`git add`, `git commit`, `git push`, `git merge`, `git reset`, `git rebase`) were executed.
- **Pre-existing local changes** in `supabase/seed.sql` were preserved untouched.
