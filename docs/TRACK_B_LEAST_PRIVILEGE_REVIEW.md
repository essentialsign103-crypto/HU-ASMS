# HU-ASMS — Track B Security Permission & Least-Privilege Review

**Status:** Local remediation & verification complete — **Deployment Freeze Remains Active**
**Scope:** Least-privilege audit of all `18` functions in schema `public` (9 deployed across `20261110000001`–`20261110000005`; 9 staged in Track B `20261111000001`–`20261111000003`), default ACLs (`pg_default_acl`), trigger execution rules, and all `8` effective `SECURITY DEFINER` definitions.

---

## Executive Summary

The initial draft of `supabase/migrations/20261111000003_track_b_function_privilege_and_default_acl_hardening.sql` revoked `PUBLIC` and `anon`, but granted `EXECUTE` to `authenticated` and `service_role` uniformly across all `18` `public` functions and revoked only `PUBLIC, anon` in `ALTER DEFAULT PRIVILEGES ... FUNCTIONS`.

Under this least-privilege review, that uniform grant model was **over-permissive**. After inspecting live PostgreSQL role metadata (`pg_roles`, `pg_proc`, `pg_default_acl`, `pg_trigger` via read-only remote queries) and all application callers across `apps/` and `packages/`, `20261111000001`, `20261111000002`, and `20261111000003` plus regression tests have been updated so that:

- **`11` functions no longer grant `EXECUTE` to `authenticated`** (`10` owner-only triggers/unused helper revoked from `PUBLIC, anon, authenticated, service_role`; `1` service-only admin function revoked from `PUBLIC, anon, authenticated` and granted solely to `service_role`).
- **`1` function is `authenticated`-only** (`record_scoped_audit_log`, which explicitly rejects `auth.uid() IS NULL`).
- **`6` functions remain `authenticated, service_role`** (`3` RLS/`SECURITY INVOKER` trigger helpers, `1` representative workflow RPC with internal active-staff + section-scope checks, and `2` System-Owner registration RPCs currently coupled to the SSR `authenticated` client in `apps/web/src/app/admin/students/page.tsx`).
- **`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public`** (and guarded `current_user` / `supabase_admin` blocks) now revokes implicit `EXECUTE` on future functions from `PUBLIC, anon, authenticated` (preserving `postgres` and `service_role` without altering existing table `r` or sequence `S` defaults).

> **Important Deployment State Notice:** `20261110000001`–`20261110000005` remain unmodified on disk and deployed remotely. `20261111000001`–`20261111000003` are staged locally under the active deployment freeze and have NOT been pushed or executed against any PostgreSQL instance.

---

## 1. Complete 18-Function Least-Privilege Permission Matrix

| # | Exact Function Name & Signature | Classification | Purpose | Application & SQL Callers | Intended Caller Roles | General `authenticated` Needed? | Internal Authorization Checks | Updated Minimum Grants (`20261111000003`) |
|---|---|---|---|---|---|---|---|---|
| 1 | `public.auth_is_system_owner()` | RLS & RPC Helper (`SECURITY DEFINER`) | Checks whether `auth.uid()` maps to an active `system_owner` profile. | RLS `USING`/`WITH CHECK` policies (`02`, `03`, `000002`), `protect_profile_privileged_columns`, `admin_set_profile_status`, `record_scoped_audit_log`, `approve_student_registration`, `reject_student_registration`, `mark_delivery_sent_with_audit`, triggers (`000002`). Zero direct JS `.rpc()` callers. | `authenticated` (during RLS evaluation), `service_role` | **Yes (via RLS/invoker)** | Queries `public.profiles` for `id = auth.uid() AND role = 'system_owner' AND is_active = true`. | `authenticated, service_role` (`PUBLIC, anon` revoked) |
| 2 | `public.auth_is_rep_for_section(UUID)` | RLS & RPC Helper (`SECURITY DEFINER`) | Checks active representative assignment + active staff profile for a target section. | RLS policies (`02`, `04`, `000002`), `storage.objects` (`03`), `record_scoped_audit_log`, `mark_delivery_sent_with_audit`, integrity triggers (`000002`). Zero direct JS `.rpc()` callers. | `authenticated` (during RLS/storage evaluation), `service_role` | **Yes (via RLS/invoker)** | Joins `representative_assignments` + `profiles` checking `profile_id = auth.uid()`, `ra.is_active = true`, `p.is_active = true`, `p.role IN ('representative', 'system_owner')`. | `authenticated, service_role` (`PUBLIC, anon` revoked) |
| 3 | `public.auth_get_assigned_section_ids()` | Unused RLS Helper (`SECURITY DEFINER`) | Returns assigned active section IDs for `auth.uid()`. | **0 SQL or TS callers** across `apps/`, `packages/`, and `supabase/`. | None (legacy/unused) | **No (Revoked)** | Active assignment + active staff profile check (`000001`). | **None (`postgres` owner only)** — revoked from `PUBLIC, anon, authenticated, service_role` |
| 4 | `public.admin_set_profile_status(UUID, public.user_role, BOOLEAN)` | Service-Only Administrative (`SECURITY DEFINER`) | Updates target user `profiles.role` and/or `profiles.is_active` while bypassing end-user trigger block. | **0 TS/SSR callers** in `apps/` or `packages/`. | Privileged server/admin maintenance (`service_role` / `postgres`) | **No (Revoked)** | Checks `auth_is_system_owner() OR COALESCE(auth.role(), '') = 'service_role' OR session_user IN ('postgres', 'supabase_admin')`. | **`service_role` only** (`PUBLIC, anon, authenticated` revoked) |
| 5 | `public.record_scoped_audit_log(TEXT, TEXT, UUID, JSONB)` | Scoped Portal Audit Helper (`SECURITY DEFINER`) | Appends allowlisted rep/owner portal events into `public.audit_logs`. | `apps/web/src/lib/rep/audit-helper.ts` (`executeCreateProjectGroup`, `executePrepareDeliveryBatch`, `executeDispatchDelivery`, `executeAcknowledgeDelivery`) via SSR `createServerSupabaseClient()`. | Active `representative` / `system_owner` SSR user sessions (`authenticated`) | **Yes (SSR workflow)** | Rejects `auth.uid() IS NULL`, verifies active `profiles` row, allowlists 4 `(action, entity_type)` pairs, resolves `section_id`, requires `auth_is_system_owner() OR auth_is_rep_for_section(v_section_id)`. | **`authenticated` only** (`PUBLIC, anon, service_role` revoked — body rejects `auth.uid() IS NULL`) |
| 6 | `public.update_timestamp_column()` | Trigger-Only (`SECURITY INVOKER`) | Sets `NEW.updated_at = NOW()` on row updates. | Table `BEFORE UPDATE` triggers (`01`). **0 `.rpc()` callers**. | PostgreSQL trigger executor only | **No (Revoked)** | Trigger runtime only. | **None (`postgres` owner only)** |
| 7 | `public.enforce_single_group_per_project()` | Trigger-Only (`SECURITY INVOKER`) | Prevents a student from holding active group membership in multiple groups for one project. | `group_members` trigger (`01`). **0 `.rpc()` callers**. | PostgreSQL trigger executor only | **No (Revoked)** | Trigger runtime only. | **None (`postgres` owner only)** |
| 8 | `public.check_and_update_group_verification()` | Trigger-Only (`SECURITY INVOKER`) | Auto-updates `groups.is_verified` when member confirmation counts satisfy bounds. | `group_members` trigger (`01`, updated `000002`). **0 `.rpc()` callers**. | PostgreSQL trigger executor only | **No (Revoked)** | Trigger runtime only. | **None (`postgres` owner only)** |
| 9 | `public.protect_profile_privileged_columns()` | Trigger-Only (`SECURITY INVOKER`) | Blocks non-owner/non-service modifications to `profiles.role` and `profiles.is_active`. | `profiles` `BEFORE UPDATE` trigger (`05`). **0 `.rpc()` callers**. | PostgreSQL trigger executor only | **No (Revoked)** | Trigger checks `current_user`, `COALESCE(auth.role(), '')`, `auth_is_system_owner()`. | **None (`postgres` owner only)** |
| 10 | `public.approve_student_registration(UUID, TEXT)` | Administrative RPC Coupled to SSR (`SECURITY DEFINER`) | Atomically inserts approved `students` row and updates `registration_requests` -> `approved`. | `apps/web/src/lib/admin/student-approval-service.ts` <- `apps/web/src/app/admin/students/page.tsx` (`createServerSupabaseClient()`, user JWT = `authenticated`). | `system_owner` (or `service_role`) | **Coupled today (Recommend refactor)** | Rejects non-`service_role`/non-DBA callers who fail `public.auth_is_system_owner()`. | `authenticated, service_role` (documented temporary coupling until `/admin/students` switches to `service_role`) |
| 11 | `public.reject_student_registration(UUID, TEXT)` | Administrative RPC Coupled to SSR (`SECURITY DEFINER`) | Atomically transitions pending `registration_requests` -> `rejected`. | `apps/web/src/lib/admin/student-approval-service.ts` <- `apps/web/src/app/admin/students/page.tsx` (`createServerSupabaseClient()`, user JWT = `authenticated`). | `system_owner` (or `service_role`) | **Coupled today (Recommend refactor)** | Rejects non-`service_role`/non-DBA callers who fail `public.auth_is_system_owner()`. | `authenticated, service_role` (documented temporary coupling until `/admin/students` switches to `service_role`) |
| 12 | `public.mark_delivery_sent_with_audit(UUID, TEXT)` | Scoped Portal RPC (`SECURITY DEFINER`) | Atomically transitions `deliveries` `prepared -> sent` (`FOR UPDATE`, item count check) and logs audit event. | `apps/web/src/lib/rep/delivery-service.ts` <- `apps/web/src/app/rep/deliveries/actions.ts` (`createServerSupabaseClient()`, user JWT = `authenticated`). | Assigned active `representative` / `system_owner` / `service_role` | **Yes (SSR workflow)** | Checks `auth.uid()` active staff profile (or `service_role`/DBA), `auth_is_system_owner() OR auth_is_rep_for_section(v_delivery.section_id)`, and `prepared` status. | `authenticated, service_role` (`PUBLIC, anon` revoked) |
| 13 | `public.is_project_targeted_to_section(UUID, UUID)` | Trigger Helper (`SECURITY INVOKER`) | Validates whether a project targets all sections or a specific section via `project_targets`. | `enforce_group_integrity()` and `enforce_delivery_integrity()` (`000002`). **0 `.rpc()` callers**. | Invoked during `SECURITY INVOKER` DML trigger execution on `groups`/`deliveries` | **Yes (while `SECURITY INVOKER` triggers call it)** | Read-only check against `projects` / `project_targets`. | `authenticated, service_role` (recommend inlining into triggers or relocating to `private` schema later) |
| 14 | `public.enforce_group_integrity()` | Trigger-Only (`SECURITY INVOKER`) | Enforces project/section/group-mode invariants on `groups` insert/update. | `trg_enforce_group_integrity` on `groups` (`000002`). **0 `.rpc()` callers**. | PostgreSQL trigger executor only | **No (Revoked)** | Enforces `auth_is_system_owner()`, `service_role`, DBA, or `auth_is_rep_for_section(section_id)` + domain invariants. | **None (`postgres` owner only)** |
| 15 | `public.enforce_group_member_integrity()` | Trigger-Only (`SECURITY INVOKER`) | Enforces student active status, section match, and scope on `group_members`. | `trg_enforce_group_member_integrity` on `group_members` (`000002`). **0 `.rpc()` callers**. | PostgreSQL trigger executor only | **No (Revoked)** | Enforces `auth_is_system_owner()`, `service_role`, DBA, or `auth_is_rep_for_section(section_id)` + domain invariants. | **None (`postgres` owner only)** |
| 16 | `public.enforce_group_member_size_bounds()` | Constraint Trigger-Only (`SECURITY INVOKER`, `DEFERRABLE`) | Enforces `min_group_size` / `max_group_size` on `group_members`. | `trg_enforce_group_member_size_bounds` (`000002`). **0 `.rpc()` callers**. | PostgreSQL trigger executor only | **No (Revoked)** | Trigger runtime only. | **None (`postgres` owner only)** |
| 17 | `public.enforce_delivery_integrity()` | Trigger-Only (`SECURITY INVOKER`) | Enforces project/teacher/section scope, batch count, and delivery state invariants. | `trg_enforce_delivery_integrity` on `deliveries` (`000002`). **0 `.rpc()` callers**. | PostgreSQL trigger executor only | **No (Revoked)** | Enforces `auth_is_system_owner()`, `service_role`, DBA, or `auth_is_rep_for_section(section_id)` + domain invariants. | **None (`postgres` owner only)** |
| 18 | `public.enforce_delivery_item_integrity()` | Trigger-Only (`SECURITY INVOKER`) | Enforces submission/delivery project+section parity and active submission requirement. | `trg_enforce_delivery_item_integrity` on `delivery_items` (`000002`). **0 `.rpc()` callers**. | PostgreSQL trigger executor only | **No (Revoked)** | Trigger runtime only. | **None (`postgres` owner only)** |

---

## 2. Functions That Should NOT Be Executable by General `authenticated` Users

### A. Revoked from `authenticated` immediately in `20261111000001`–`20261111000003` (`11` functions)
1. **All `9` trigger functions** (`update_timestamp_column`, `enforce_single_group_per_project`, `check_and_update_group_verification`, `protect_profile_privileged_columns`, `enforce_group_integrity`, `enforce_group_member_integrity`, `enforce_group_member_size_bounds`, `enforce_delivery_integrity`, `enforce_delivery_item_integrity`): Direct client RPC invocation is meaningless (`TRIGGER` return type cannot be called via PostgREST), and PostgreSQL does **not** check `EXECUTE` on trigger functions during DML — see Section 5.
2. **`auth_get_assigned_section_ids()`**: Unused across the entire repository (`0` SQL/RLS policies, `0` triggers, `0` TS callers). Keeping `authenticated` `EXECUTE` exposed an unnecessary helper in `public` schema.
3. **`admin_set_profile_status(UUID, public.user_role, BOOLEAN)`**: High-risk administrative function mutating `profiles.role` and `profiles.is_active` with `0` SSR/UI callers. Restricted strictly to `service_role` (plus owner `postgres`).

### B. Temporarily retaining `authenticated` due to current SSR architecture — Recommended Future Hardening (`5` functions)
1. **`approve_student_registration(UUID, TEXT)`** & **`reject_student_registration(UUID, TEXT)`**:
   - Strictly `system_owner` / `service_role` administrative workflows; general `authenticated` users (representatives or students) should ideally NOT even have PostgREST RPC visibility or `EXECUTE` ACLs on them.
   - **Current Coupling:** [apps/web/src/app/admin/students/page.tsx](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/admin/students/page.tsx) constructs `const supabase = await createServerSupabaseClient()` (using the signed-in user's `authenticated` JWT) and passes it directly into `executeApproveRegistration` / `executeRejectRegistration` -> `.rpc(...)`. Revoking `authenticated` now without refactoring those Server Actions would break `/admin/students` approvals/rejections.
   - **Runtime Safety Today:** Both RPCs fail closed on internal `NOT public.auth_is_system_owner()` when `auth.role() <> 'service_role'`, blocking representatives and students even though `EXECUTE` is granted.
   - **Recommended Follow-up (requires explicit user approval):** Refactor `/admin/students` Server Actions to execute the RPC through `getSupabaseAdminClient()` (`service_role`) immediately *after* `assertSystemOwner(context)` succeeds (passing verified `actorId` or keeping `admin_set` audit attribution explicit), then revoke `authenticated` from both RPCs.
2. **`is_project_targeted_to_section(UUID, UUID)`**:
   - Helper with `0` `.rpc()` callers, invoked by `SECURITY INVOKER` trigger functions `enforce_group_integrity()` and `enforce_delivery_integrity()`. Because those triggers run under `SECURITY INVOKER`, any `authenticated` or `service_role` DML session executing inserts/updates on `groups`/`deliveries` requires `EXECUTE` on `is_project_targeted_to_section`. Inline into the two trigger bodies (or relocate into a non-exposed `private` schema) in a future schema cleanup if removal from PostgREST's `public` catalog is desired.
3. **`auth_is_system_owner()`** & **`auth_is_rep_for_section(UUID)`**:
   - Directly referenced inside RLS `USING`/`WITH CHECK` predicates (`02`, `03`, `04`, `000002`) and `SECURITY INVOKER` triggers (`05`, `000002`). Under PostgreSQL RLS evaluation, callers evaluate policy expressions with their own `EXECUTE` privilege; relocating them into a non-API `private` schema in a future migration would remove them from Supabase PostgREST RPC discovery without removing `EXECUTE` from `authenticated`.

---

## 3. Minimum Necessary Grants by Role

| PostgreSQL Role | Granted Functions (`20261111000003`) | Count | Rationale |
|---|---|---:|---|
| **`PUBLIC`** | *(None)* | **0** | Explicit `REVOKE ALL` on all `18` functions + default function privileges. |
| **`anon`** | *(None)* | **0** | Explicit `REVOKE ALL` on all `18` functions + default function privileges. Unauthenticated sessions never need RPC execution here. |
| **`service_role`** | `admin_set_profile_status`, `auth_is_system_owner`, `auth_is_rep_for_section`, `is_project_targeted_to_section`, `approve_student_registration`, `reject_student_registration`, `mark_delivery_sent_with_audit` | **7** | Admin maintenance + RLS/trigger helpers + SSR/service RPCs (`record_scoped_audit_log` omitted because its SQL body explicitly rejects `auth.uid() IS NULL`). |
| **`authenticated`** | `record_scoped_audit_log`, `auth_is_system_owner`, `auth_is_rep_for_section`, `is_project_targeted_to_section`, `approve_student_registration`, `reject_student_registration`, `mark_delivery_sent_with_audit` | **7** | Scoped SSR workflows + RLS/`SECURITY INVOKER` trigger helpers + temporary SSR coupling for `/admin/students` (protected inside by `auth_is_system_owner()` / active rep scope checks). |
| **Owner (`postgres`) Only** | All `9` trigger functions + `auth_get_assigned_section_ids` | **10** | Explicitly revoked from `PUBLIC, anon, authenticated, service_role`. |

---

## 4. Audit of All 8 `SECURITY DEFINER` Functions

All `8` effective `SECURITY DEFINER` functions (defined in `20261110000005` — which superseded `20261110000002` — plus `20261111000001` and `20261111000002`) were audited statically and verified via unit test assertions in `apps/web/test/track-b-privilege-and-sql-hardening.test.ts`:

| Function | Defined / Superseded In | `SET search_path = ''`? | Dynamic `EXECUTE` SQL? | Internal Authorization & Parameter / Escalation Safety |
|---|---|---|---|---|
| `public.auth_is_system_owner()` | `20261110000005` (`L9-23`) | Yes | None | Zero parameters. Checks `public.profiles` for `id = auth.uid() AND role = 'system_owner' AND is_active = true`. Blocks deactivated owners, reps, students, and anon (`auth.uid() IS NULL`). |
| `public.auth_is_rep_for_section(UUID)` | `20261111000001` (`L5-23`) | Yes | None | Derives caller via `auth.uid()`; parameter `p_section_id` only narrows target section. Joins `representative_assignments` and `profiles` requiring both `ra.is_active = true`, `p.is_active = true`, and `p.role IN ('representative', 'system_owner')`. |
| `public.auth_get_assigned_section_ids()` | `20261111000001` (`L25-41`) | Yes | None | Zero parameters; uses `auth.uid()` + active assignment + active staff profile guard. Execution now revoked from `PUBLIC, anon, authenticated, service_role`. |
| `public.admin_set_profile_status(UUID, public.user_role, BOOLEAN)` | `20261110000005` (`L184-214`) | Yes | None | Checks `auth_is_system_owner() OR COALESCE(auth.role(), '') = 'service_role' OR session_user IN ('postgres', 'supabase_admin')`. **Findings noted (without modifying applied `05`):** does not itself write an `audit_logs` entry, reject an all-NULL update, or block self-demotion/self-deactivation; now isolated to `service_role` + `postgres` (`authenticated` revoked). |
| `public.record_scoped_audit_log(TEXT, TEXT, UUID, JSONB)` | `20261110000005` (`L223-300`) | Yes | None | Rejects `auth.uid() IS NULL`; queries active `profiles` row (`v_actor_role IS NULL OR v_is_active IS DISTINCT FROM true`); allowlists 4 `(action, entity_type)` pairs; resolves real `section_id` from `groups`/`deliveries` (ignores forged client `section_id`); checks `auth_is_system_owner() OR auth_is_rep_for_section(v_section_id)`. **Finding noted (without modifying applied `05`):** `p_metadata JSONB` accepts arbitrary JSONB keys/sizes without schema/key allowlisting. |
| `public.approve_student_registration(UUID, TEXT)` | `20261111000002` (`L29-156`) | Yes | None | Rejects non-`service_role`/non-DBA callers unless `public.auth_is_system_owner()` is true (blocks students and section representatives). Resolves `actor_id` server-side from `auth.uid()` (not caller-spoofable). Uses `FOR UPDATE` row lock + checks `'pending'` state before atomic student insert & audit insert. |
| `public.reject_student_registration(UUID, TEXT)` | `20261111000002` (`L161-248`) | Yes | None | Same internal `auth_is_system_owner()` / `service_role` / DBA gate; locks row `FOR UPDATE`, enforces `'pending'` status, writes status + server-derived `actor_id` + `audit_logs` atomically. |
| `public.mark_delivery_sent_with_audit(UUID, TEXT)` | `20261111000002` (`L257-376`) | Yes | None | When `auth.uid() IS NOT NULL`, requires active staff `profiles` row (`v_is_active IS DISTINCT FROM true`) AND `public.auth_is_system_owner() OR public.auth_is_rep_for_section(v_delivery.section_id)` (blocks students and foreign section representatives). Otherwise requires `service_role` or DBA session. Locks delivery `FOR UPDATE`, enforces `'prepared'` state and item-count parity. |

---

## 5. Trigger Function Privileges & Default ACL Verification (`pg_default_acl`)

### Trigger Privilege Check (PostgreSQL Semantics)
- In PostgreSQL, `EXECUTE` permission on a `RETURNS TRIGGER` function is checked **only at `CREATE TRIGGER` definition time** against the role defining the trigger (`postgres`), **not** at `INSERT`/`UPDATE`/`DELETE` DML runtime by table callers.
- All `19` triggers inspected on live `pg_trigger` fire cleanly without granting `EXECUTE` on their `9` backing trigger functions to `PUBLIC`, `anon`, `authenticated`, or `service_role`.
- Accordingly, unapplied migrations `20261111000001`, `20261111000002`, and `20261111000003` strip `PUBLIC, anon, authenticated, service_role` `EXECUTE` from all `9` trigger functions (preserving `postgres` ownership).

### Default Privilege Verification (Observed Live DB Facts)
Read-only live queries executed prior to the local edits observed:
1. **Migration Role:** `cli_login_postgres` has `rolinherit = false`, `rolsuper = false`, `rolbypassrls = false`, and `member_of = {postgres}`; all `9` live `public` functions have `fn_owner = "postgres"`.
2. **Existing `pg_default_acl`:**
   - Schema `public`, object type `f` (functions), owner `postgres`: `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`.
   - Schema `public`, object types `r` (relations) and `S` (sequences) were also present; `ALTER DEFAULT PRIVILEGES ... REVOKE ALL ON FUNCTIONS ...` alters **only** function defaults (`f`), leaving table and sequence default ACLs intact and not weakening existing object grants.
3. **Updated `20261111000003` Rule:**
   - Runs `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;`
   - Also applies guarded `ALTER DEFAULT PRIVILEGES` (`REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated`) for `current_user` (if neither `postgres` nor `supabase_admin`) and `supabase_admin` (`pg_has_role(current_user, 'supabase_admin', 'MEMBER')`) so pushes never fail under non-superuser CLI roles while closing implicit `authenticated`/`anon`/`PUBLIC` defaults for future functions.
4. **Post-Apply Verification Block in `20261111000003`:**
   - Replaced the single-list check with an explicit 4-bucket `DO $$` verification (`v_owner_only_sigs`, `v_service_only_sigs`, `v_authenticated_only_sigs`, `v_auth_and_service_sigs`) asserting exact `has_function_privilege` across `public`, `anon`, `authenticated`, and `service_role`.

---

## 6. Modified Files & Regression Verification Results

### Files Modified Under This Review
1. [supabase/migrations/20261111000001_track_b_rep_active_profile_guard.sql](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261111000001_track_b_rep_active_profile_guard.sql) — revoked `PUBLIC, anon, authenticated, service_role` on unused `auth_get_assigned_section_ids()`.
2. [supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql) — revoked `PUBLIC, anon, authenticated, service_role` (with zero `GRANT EXECUTE`) across all 6 Track B trigger functions (`enforce_group_integrity`, `enforce_group_member_integrity`, `enforce_group_member_size_bounds`, `check_and_update_group_verification`, `enforce_delivery_integrity`, `enforce_delivery_item_integrity`).
3. [supabase/migrations/20261111000003_track_b_function_privilege_and_default_acl_hardening.sql](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261111000003_track_b_function_privilege_and_default_acl_hardening.sql) — enforced the 4-bucket least-privilege grant matrix, tightened `ALTER DEFAULT PRIVILEGES ... REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated`, and updated the 4-bucket `DO $$` `has_function_privilege` post-apply verification.
4. [apps/web/test/track-b-security.test.ts](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/test/track-b-security.test.ts) — updated migration SQL contract assertions for `000001` (`auth_get_assigned_section_ids`) and `000002` (all 6 triggers revoked with no `GRANT EXECUTE`).
5. [apps/web/test/track-b-privilege-and-sql-hardening.test.ts](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/test/track-b-privilege-and-sql-hardening.test.ts) — replaced blanket 18-function grants assertion with exact 4-bucket least-privilege enforcement, tightened default ACL assertions, and added static verification across all 8 effective `SECURITY DEFINER` functions (`SET search_path = ''`, zero dynamic `EXECUTE`, internal auth guards).
6. [docs/TRACK_B_LEAST_PRIVILEGE_REVIEW.md](file:///d:/HU-ASMS%20%E2%80%94%20University/docs/TRACK_B_LEAST_PRIVILEGE_REVIEW.md) — this deliverable report.

### Local Verification Runs (Executed After Final Code & Test Edits)

| Check | Command | Outcome | Notes |
|---|---|---|---|
| Workspace TypeScript | `npm run typecheck` | **Exit `0`** | All `6` workspaces (`@hu-asms/bot`, `@hu-asms/web`, `@hu-asms/database`, `@hu-asms/shared`, `@hu-asms/types`, `@hu-asms/validation`) passed. |
| Workspace Lint Scripts | `npm run lint --workspaces` | **Exit `0`** | All `6` workspaces passed. Note: every workspace `"lint"` script executes `tsc --noEmit`; **ESLint is not installed or configured** in this repository. |
| Full Unit Test Suite | `npm test` | **Exit `0`** | `@hu-asms/bot`: `88/88` (`27` suites); `@hu-asms/web`: `110/110` (`27` suites); `@hu-asms/database`: `15/15` (`10` suites); `@hu-asms/shared`/`types`/`validation`: `node --version` placeholder scripts. Zero skipped/cancelled tests. |
| Combined Test Coverage | `npm run test:coverage` | **Exit `0`** | `213/213` tests (`64` suites), `0` failures, `0` skipped — overall coverage: **`76.33%` lines, `76.17%` branches, `72.29%` functions**. |
| Production Build | `npm run build` | **Exit `0`** | All `6` packages/apps compiled (`Next.js 15.5.29`, compiled in `6.6s`, `21/21` static/dynamic route entries built). |
| Git Hygiene & Untouched Applied Migrations | `git diff --check` & `git diff --name-only -- supabase/migrations/2026111000000{1..5}*` | **Exit `0`** | Zero whitespace/conflict errors; all `5` applied migrations (`20261110000001`–`05`) remain completely unmodified. |
| Live PostgreSQL Integration Tests | *(Not run)* | **0 tests executed** | **Honest limitation:** No local Docker daemon or local PostgreSQL (`psql`) daemon is installed here, and the remote DB remains under strict deployment freeze; all `20261111000001`–`03` SQL contracts are verified statically against migration source files and live `pg_roles`/`pg_default_acl`/`pg_trigger` read-only queries, NOT by executing DDL against a live PostgreSQL server. |

---

## 7. Remaining Risks & Requested Explicit Approval

1. **Deployment Status:** Staged Track B migrations (`20261111000001`, `20261111000002`, `20261111000003`) are **local only** and NOT applied remotely. Previously deployed migrations (`20261110000001`–`05`) on the remote DB still carry the permissive `authenticated`/`anon` defaults and prior trigger/helper grants until approved deployment occurs.
2. **Optional Future Follow-Ups (Require Explicit Approval):**
   - **Approval Option A — Decouple `/admin/students` from `authenticated` RPCs:** Refactor `apps/web/src/app/admin/students/page.tsx` (after `assertSystemOwner(context)`) to call `approve_student_registration` and `reject_student_registration` using `getSupabaseAdminClient()` (`service_role`), pass/preserve verified owner attribution, and revoke `authenticated` from both admin RPCs in `20261111000003`.
   - **Approval Option B — Move Internal/RLS Helpers Out of `public`:** Consider a follow-up migration relocating `auth_is_system_owner`, `auth_is_rep_for_section`, and `is_project_targeted_to_section` (or inlining `is_project_targeted_to_section`) into a non-exposed `private` schema if removal from PostgREST's `public` schema catalog is required.
   - **Approval Option C — Audit/Harden `20261110000005` Helpers in a Forward Migration:** Optionally add `audit_logs` write + self-demotion guard to `admin_set_profile_status` and schema/size validation for `p_metadata` in `record_scoped_audit_log` via a new forward migration (without editing applied `05`).
   - **Approval Option D — Lift Freeze / Apply Staged Migrations:** Explicitly authorize when ready to test against a staging/branch PostgreSQL instance and run `supabase db push` (preserving all local work such as `supabase/seed.sql`).
