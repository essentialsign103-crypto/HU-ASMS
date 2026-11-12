# HU-ASMS — Post-Deployment Security & Configuration Audit (Read-Only)

**Target Project:** `tkdrxfvxryemfdrwcmay` (`"hu-accadamic assistent system"`, `eu-north-1`, production)  
**Audit Date:** 2026-11-12  
**Audit Scope:** Strictly read-only inspection via `npx supabase db query --remote --read-only`, `npx supabase db advisors --remote --type security`, `npx supabase migration list --remote`, `npx supabase inspect db`, read-only Storage/REST/RPC probes, and Git status verification. Zero database mutations, zero bucket edits, zero users created, and zero secrets exposed.  
**Verdict for System Owner Initialization:** **READY** *(Core schema, `26/26` RLS-enabled tables, `profiles` escalation defenses, `21/21` `search_path=""` functions, `anon` lockdown, and `'submission-files-vault'` privacy are verified live. One medium table-privilege finding on `student_verification_tokens`, the 50 MB vs 20 MB bucket limit mismatch, and the unused `hu-assistant` bucket are flagged below for cleanup before opening production traffic or issuing tokens.)*

---

## 1. Storage Configuration

### 1.1 Live Buckets (`storage.buckets` & `storage.objects`)
Direct read-only query of `storage.buckets` returned `2` buckets (both private, `0` objects):

| Bucket ID / Name | Public | `file_size_limit` | `allowed_mime_types` | Created At (UTC) | Objects | Source |
|---|---|---|---|---|---|---|
| `hu-assistant` | `false` | `null` | `null` | `2026-11-12 08:47:14.964282+00` | `0` | Outside repository migrations |
| `submission-files-vault` | `false` | `52428800` (50 MB) | `application/pdf`, `application/zip`, `application/x-zip-compressed`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/msword` | `2026-11-12 08:49:12.029242+00` | `0` | Migration `20261110000003_storage_setup.sql` |

### 1.2 Why `submission-files-vault` Has a 50 MB Limit While App / Telegram Enforce 20 MB
- Migration `03` ([`20261110000003_storage_setup.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261110000003_storage_setup.sql#L10-L21)) was created during early schema setup with `file_size_limit = 52428800` (50 MB).
- During pre-deployment security remediation ([`20261112000002_minimum_deployment_blocker_fixes.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261112000002_minimum_deployment_blocker_fixes.sql#L13-L25) & [`packages/shared/src/index.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/packages/shared/src/index.ts#L10-L24)), the Cloud Telegram Bot API `getFile` hard cap of **20 MB** (`20,971,520` bytes) was enforced via `chk_project_file_rules_max_size` (`> 0 AND <= 20971520`) and pre-`getFile()` bot validation without editing frozen Migration `03`.
- **Recommendation:** **Align `submission-files-vault.file_size_limit` down to `20971520` (20 MB)** in a small follow-up forward migration (do **not** mutate it right now without approval) so Supabase Storage enforces the same 20 MB ceiling at the object layer as defense-in-depth.

### 1.3 Source & Purpose of Unexpected `hu-assistant` Bucket
- `hu-assistant` was absent during the initial preflight Storage check (`08:32:31 UTC`), and appeared at `2026-11-12 08:47:14.964282+00`—approximately 2 minutes before `db push` executed Migration `03` (`08:49:12 UTC`).
- `git grep -i "hu-assistant"` returns **zero matches** across the entire codebase, migrations, and documentation.
- **Assessment:** Created outside HU-ASMS migrations (most likely created manually in Supabase Dashboard, matching the project name `"hu-accadamic assistent system"`). It is private (`public = false`) and empty (`0` objects), posing no immediate data exposure, but should be deleted/cleaned up if not intentionally created for another purpose.

### 1.4 Live `storage.objects` Policies & Private Access Verification
Direct read-only `pg_policies` inspection confirms **2** policies on `storage.objects` (and RLS enabled on both `storage.buckets` and `storage.objects`):

1. **`owner_full_storage_access`** (`ALL`, `PERMISSIVE`, role `{authenticated}`):
   - `USING` & `WITH CHECK`: `((bucket_id = 'submission-files-vault'::text) AND auth_is_system_owner())`
2. **`representative_read_storage_objects`** (`SELECT`, `PERMISSIVE`, role `{authenticated}`):
   - `USING`: `((bucket_id = 'submission-files-vault'::text) AND (EXISTS (SELECT 1 FROM (submission_files sf JOIN submissions s ON ((s.id = sf.submission_id))) WHERE ((sf.storage_path = objects.name) AND auth_is_rep_for_section(s.section_id)))))`

**Boundary Verification:**
- **Anonymous (`anon`):** Zero policies exist for `anon` on `storage.objects`; `anon.storage.from('submission-files-vault').list()` returns `0` objects cleanly (no bucket enumeration).
- **Students:** Students do not hold Supabase Auth accounts (`auth.users`); all student file uploads go exclusively through `@hu-asms/bot` using `SUPABASE_SERVICE_ROLE_KEY`. Even if an arbitrary authenticated user existed without a `system_owner` or assigned active `representative` profile, both `storage.objects` policies evaluate to `false`.
- **Representatives:** Read-only (`SELECT`) access restricted strictly to objects mapped via `submission_files.storage_path` to `submissions` in their active `representative_assignments` sections (`auth_is_rep_for_section` also requires `profiles.is_active = true` and staff role). Notice `apps/web` generates 15-minute signed URLs server-side only after verifying section authorization.
- **System Owners:** Active `system_owner` profiles retain full `ALL` management within `'submission-files-vault'`.

---

## 2. Database Security

### 2.1 RLS Enabled & Forced Status (`pg_class`)
Direct read-only `pg_class` inspection confirmed **`rls_enabled = true`** across **all 28 checked tables** (`26/26` `public` tables + `storage.buckets` + `storage.objects`), with `auth.users` count = `0`:
- `public` (`26`): `academic_years`, `audit_logs`, `bot_sessions`, `courses`, `deliveries`, `delivery_items`, `departments`, `group_members`, `groups`, `identity_change_history`, `identity_change_requests`, `notifications`, `profiles`, `project_file_rules`, `project_targets`, `projects`, `rate_limit_buckets`, `registration_requests`, `representative_assignments`, `sections`, `student_verification_tokens`, `students`, `submission_files`, `submission_members`, `submissions`, `teachers`.
- `storage` (`2`): `buckets`, `objects`.
- **`rls_forced = false` on all 28 tables:** Standard Supabase setting so `SECURITY DEFINER` RPCs owned by `postgres` and `service_role` operate normally while `anon` and `authenticated` remain governed by RLS.

### 2.2 Policies Overview (`pg_policies` — `49` Total Policies: `47` `public` + `2` `storage`)
- **Zero-Authenticated Tables (`bot_sessions`, `rate_limit_buckets`):** `0` permissive policies and `REVOKE ALL FROM PUBLIC, anon, authenticated` (`service_role` only).
- **Read-Only Reference Catalogs (`departments`, `academic_years`, `sections`, `courses`, `teachers`, `projects`, `project_targets`, `project_file_rules`):** `SELECT` (`true`) for `{authenticated}`; `ALL` restricted to `auth_is_system_owner()`.
- **Profiles (`profiles`):** `owner_full_access_profiles` (`ALL`, `auth_is_system_owner()`); `users_read_own_profile` (`SELECT`, `id = auth.uid()`); `users_update_own_profile` (`UPDATE`, `{authenticated}`, `USING (id = auth.uid())`, `WITH CHECK` locks `role` and `is_active` unchanged). Paired with column-level `UPDATE` (`full_name`, `phone`, `telegram_username` only) and BEFORE UPDATE trigger `trg_protect_profile_privileges`.
- **Section-Scoped Representative Data:**
  - `students`, `registration_requests`, `submissions`, `submission_files`, `submission_members`: Rep `SELECT` scoped via `auth_is_rep_for_section(...)`; `ALL` restricted to `auth_is_system_owner()`.
  - `groups`, `group_members`: Rep `ALL` scoped via `auth_is_rep_for_section(...)` with `WITH CHECK` blocking direct `'verified'`/`'submitted'` group transitions or `'confirmed'` member spoofing.
  - `deliveries`, `delivery_items`: Rep `ALL` scoped via `auth_is_rep_for_section(...)` with `WITH CHECK` requiring `d.status = 'prepared'` and matching section/project active submissions (`delivery_items`).
  - `representative_assignments`: `SELECT` own assignments (`profile_id = auth.uid()`); `ALL` owner-only.
  - `audit_logs`: `owner_read_all_audit_logs` (`auth_is_system_owner()`); `rep_read_own_audit_logs` (`actor_id = auth.uid()`). Direct writes revoked.
  - `identity_change_requests`, `identity_change_history`, `notifications`: Owner-only policies.
- **Finding on `student_verification_tokens` Policy Target (`{public}`):**
  - Policy `"System Owners manage student verification tokens"` (`ALL`, `auth_is_system_owner()`) is bound to `roles = "{public}"` rather than `"{authenticated}"`. While `REVOKE ALL ON TABLE ... FROM PUBLIC, anon` + `auth.uid() IS NULL` currently blocks `anon`, changing the policy to `TO authenticated` removes any role ambiguity.

### 2.3 Table & Column Privileges (`has_table_privilege` / `has_column_privilege`)
- **`anon` Role:** `SELECT = false` and `INSERT = false` across **all `26/26` `public` tables**; verified live via `anon` REST `HEAD` requests returning HTTP **`401 Unauthorized`** on all `26` tables.
- **`service_role`:** Full `SELECT, INSERT, UPDATE, DELETE` across all `26/26` `public` tables.
- **Immutable / Restricted Tables for `authenticated`:**
  - `bot_sessions`, `rate_limit_buckets`: `false` for all privileges.
  - `audit_logs`, `identity_change_history`: `SELECT` only (`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` = `false`).
  - `submission_members`: `SELECT`, `INSERT` only (`UPDATE`/`DELETE`/`TRUNCATE` = `false`).
  - `profiles`: Table-level `UPDATE = false`; column-level `UPDATE = true` **only** on `full_name`, `phone`, `telegram_username` (`id`, `role`, `email`, `telegram_user_id`, `is_active`, `created_at`, `updated_at` all `false`).
  - `student_verification_tokens`: `UPDATE = false` (revoked in `20261112000002`), `SELECT`/`INSERT`/`DELETE` = `true`.
- **SECURITY FINDING (Medium) — `authenticated` Retains `TRUNCATE` on `public.student_verification_tokens`:**
  - Direct `has_table_privilege('authenticated', oid, 'TRUNCATE')` returned **`true` on `student_verification_tokens`** (`false` on the other `25` tables).
  - **Root Cause:** Migration `05` (`REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM authenticated`) ran before Migration `09` (`20261112000001`) created `student_verification_tokens`, and Migration `09` did not revoke `TRUNCATE`/`TRIGGER`/`REFERENCES` (default `postgres` table grants in Supabase), nor was `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE ... ON TABLES FROM authenticated` configured.
  - **Risk:** PostgreSQL `TRUNCATE` bypasses RLS completely. Although PostgREST (`/rest/v1/`) does not expose `TRUNCATE`, any direct SQL execution under `authenticated` would have permission to truncate `student_verification_tokens`.
  - **Remediation:** Add a forward migration running `REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.student_verification_tokens FROM authenticated;` and `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated;`.

### 2.4 Functions, `SECURITY DEFINER`, `search_path`, and `EXECUTE` Privileges (`pg_proc`)
Direct `pg_proc` inspection confirmed **`21` functions in `public`**:
- **`21 / 21`** set `config = 'search_path=""'` (zero mutable `search_path` functions).
- **`21 / 21`** have **`exec_public = false`** and **`exec_anon = false`**.
- **Exact 4-Bucket Privilege Breakdown:**
  1. **Owner-only (`11` functions — `PUBLIC/anon/authenticated/service_role` all `false`):** `audit_student_verification_token_issue()` (`SECURITY DEFINER`), `auth_get_assigned_section_ids()` (`SECURITY DEFINER`), and 9 `SECURITY INVOKER` trigger helpers (`update_timestamp_column`, `protect_profile_privileged_columns`, `enforce_single_group_per_project`, `check_and_update_group_verification`, `enforce_group_integrity`, `enforce_group_member_integrity`, `enforce_group_member_size_bounds`, `enforce_delivery_integrity`, `enforce_delivery_item_integrity`).
  2. **`service_role`-only (`3` functions — all `SECURITY DEFINER`, `authenticated = false`):** `admin_set_profile_status(uuid,user_role,boolean)`, `check_and_increment_rate_limit(text,integer,bigint)`, `redeem_student_verification_token(text,text,bigint,text)`.
  3. **`authenticated`-only (`1` function — `SECURITY DEFINER`):** `record_scoped_audit_log(text,text,uuid,jsonb)` (requires `auth.uid()`, active staff profile, allowlisted action, and owner/section scope).
  4. **`authenticated` + `service_role` (`6` functions):** `auth_is_system_owner()`, `auth_is_rep_for_section(uuid)`, `is_project_targeted_to_section(uuid,uuid)` (`SECURITY INVOKER`), `approve_student_registration(uuid,text)`, `reject_student_registration(uuid,text)`, `mark_delivery_sent_with_audit(uuid,text)`.
- **Live `anon` RPC Probe & Supabase Security Advisors:**
  - `anon.rpc(...)` calls to `approve_student_registration`, `reject_student_registration`, and `redeem_student_verification_token` returned live HTTP **`401` (`permission denied for function ...`)**.
  - `npx supabase db advisors --remote --type security` returned **0 `ERROR` findings** and **6 `WARN` findings** (`0029_authenticated_security_definer_function_executable`), matching the exact `6` intentional `authenticated`-callable `SECURITY DEFINER` helpers/RPCs (`auth_is_system_owner`, `auth_is_rep_for_section`, `approve_student_registration`, `reject_student_registration`, `mark_delivery_sent_with_audit`, `record_scoped_audit_log`), each of which enforces `auth.uid()` / `auth_is_system_owner()` / active section checks internally.

### 2.5 Triggers & Constraints (`pg_trigger`, `pg_constraint`)
- **`25` active (`tgenabled = 'O'`) triggers** verified live across `public` tables: `updated_at` triggers (`15`), `trg_protect_profile_privileges`, group/member integrity & deferred size-bound constraint triggers (`6`), delivery/delivery_item integrity triggers (`2`), and `trg_audit_student_verification_token_issue` (`AFTER INSERT ON student_verification_tokens`).
- **`47` `CHECK` / `UNIQUE` / `PRIMARY KEY` constraints** verified live, including `chk_project_file_rules_max_size` (`CHECK (((max_file_size_bytes > 0) AND (max_file_size_bytes <= 20971520)))`), `chk_group_size_bounds`, `chk_deadline_after_opening`, `chk_submission_ownership`, `registration_requests_request_type_check`, and `student_verification_tokens_purpose_check`.
- **`71` live indexes** verified via `inspect db index-stats`, including `uq_pending_new_registration_hu_id` and `uq_pending_registration_request_telegram_id`.

---

## 3. Authorization Test Plan (Design Only — No Users or Rows Created)

> **Account Requirement Note:** Anonymous and `service_role` tests can run immediately without users. All role-boundary tests for **authenticated student**, **Section Representative (active vs deactivated/unassigned)**, and **System Owner** require **real authenticated accounts** in `auth.users` (plus corresponding `public.profiles` and `representative_assignments` rows) so PostgREST/Storage evaluate real Supabase Auth JWT claims (`auth.uid()`, `role = authenticated`). Do not execute these until accounts are provisioned in the next stage.

| Role / Actor | Required Auth Setup | Test Cases to Execute (Read & Negative Write Checks) | Expected Result |
|---|---|---|---|
| **1. Anonymous (`anon`)** | None (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) | 1. `SELECT`/`INSERT` on all `26` `public` tables (`students`, `bot_sessions`, `audit_logs`, `student_verification_tokens`).<br>2. `rpc` calls to `approve_student_registration`, `redeem_student_verification_token`, `record_scoped_audit_log`, `admin_set_profile_status`.<br>3. `storage.from('submission-files-vault').list()` & public object fetch. | 1. HTTP `401 Unauthorized` on all `26` tables *(verified)*<br>2. `401 permission denied for function` *(verified)*<br>3. Empty list / `400`/`403`/`404` on storage paths |
| **2. Authenticated Non-Staff User ("Authenticated Student /Rogue User")** | Real `auth.users` JWT with NO staff `profiles` row (or `is_active = false`) | 1. Query `students`, `registration_requests`, `submissions`, `audit_logs`, `student_verification_tokens`.<br>2. Call `approve_student_registration`, `reject_student_registration`, `mark_delivery_sent_with_audit`, `record_scoped_audit_log`, `admin_set_profile_status`, `redeem_student_verification_token`.<br>3. Read/upload to `storage.objects` in `'submission-files-vault'`.<br>4. Attempt `UPDATE profiles SET role='system_owner', is_active=true`. | 1. `0` rows returned via RLS (and `403`/permission denied on `bot_sessions`/`rate_limit_buckets`).<br>2. RPCs raise `Unauthorized`/`Forbidden` or `401/403` (`admin_set_profile_status`, `redeem_*` revoked from `authenticated`).<br>3. Storage `SELECT`/`INSERT` blocked by `storage.objects` policies.<br>4. Blocked by RLS `WITH CHECK` & `protect_profile_privileged_columns` trigger. |
| **3. Section Representative (Section A)** | Real `auth.users` JWT + `profiles(role='representative', is_active=true)` + `representative_assignments(section_id=A, is_active=true)` | 1. Read `students`, `submissions`, `submission_files`, `registration_requests` in **Section A** vs **Section B**.<br>2. List/download `submission-files-vault` objects for Section A vs Section B.<br>3. Attempt to `UPDATE` own `profiles.role` or `is_active`, or `INSERT`/`UPDATE` `student_verification_tokens`, or `approve_student_registration`.<br>4. Toggle `profiles.is_active = false` (via owner) and re-test Section A access. | 1. Succeeds for Section A; `0` rows / denied for Section B.<br>2. Signed download / storage `SELECT` succeeds for Section A; denied for Section B.<br>3. Self-role edit & owner actions blocked (`Privilege Escalation Blocked` / `Forbidden`).<br>4. Deactivated profile immediately loses all Section A access (`20261111000001`). |
| **4. System Owner** | Real `auth.users` JWT + `profiles(role='system_owner', is_active=true)` | 1. Read/manage `departments`, `projects`, `project_file_rules` (verify `> 20971520` rejected by `chk_project_file_rules_max_size`).<br>2. Issue `student_verification_tokens` via `/admin/students` (`INSERT` succeeds, `UPDATE` denied for `authenticated`).<br>3. Approve `registration_requests` via `approve_student_registration` & verify audit log entry.<br>4. Direct `INSERT`/`UPDATE`/`DELETE` on `audit_logs`. | 1. Full scoped CRUD; `> 20 MB` rule rejected at DB constraint.<br>2. Token insert succeeds + audit trigger fires; direct token hash `UPDATE` blocked.<br>3. Atomic approval succeeds.<br>4. Direct `audit_logs` write blocked (`REVOKE INSERT/UPDATE/DELETE`). |

---

## 4. Migration Integrity & Git Tree State

- **Remote vs. Local Migrations (`q_migrations.json` vs `supabase/migrations/`):**
  - Exact **10 / 10 match** (`20261110000001` through `20261112000002`) in chronological order.
- **Migration File Integrity (`git diff --name-only -- supabase/migrations/`):**
  - Empty output (`0` migration files edited after deployment).
- **Working Tree Status (`git status --short`):**
  - Tracked codebase has **zero** modifications (`git diff --stat` is empty).
  - Note: The working tree is **not** completely clean solely because [`docs/SUPABASE_PREFLIGHT_REPORT.md`](file:///d:/HU-ASMS%20%E2%80%94%20University/docs/SUPABASE_PREFLIGHT_REPORT.md) and [`docs/POST_DEPLOYMENT_SECURITY_AUDIT.md`](file:///d:/HU-ASMS%20%E2%80%94%20University/docs/POST_DEPLOYMENT_SECURITY_AUDIT.md) are new untracked audit report deliverables generated locally after the `clean-deployment` branch push.

---

## 5. Summary of Findings & Recommended Next Corrections

| # | Severity | Finding | Recommended Action (Upon Approval) |
|---|---|---|---|
| **1** | **Medium** | `authenticated` retains `TRUNCATE` (and default table grants) on `public.student_verification_tokens`, and its RLS policy targets `{public}` instead of `{authenticated}`. | Add tiny forward migration: `REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.student_verification_tokens FROM authenticated;`, `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated;`, and recreate the policy `TO authenticated`. |
| **2** | **Low** | `'submission-files-vault'.file_size_limit` is `52428800` (50 MB) while DB `chk_project_file_rules_max_size` and `@hu-asms/bot` cap uploads at `20971520` (20 MB). | Align `'submission-files-vault'.file_size_limit` to `20971520` in the same forward migration for storage-layer defense-in-depth. |
| **3** | **Info** | Unexpected empty private bucket `hu-assistant` exists (`created_at: 2026-11-12 08:47:14 UTC`, `0` objects, unreferenced in repo). | Confirm it is unused and delete it via Supabase Dashboard Storage to keep storage hygiene clean. |
| **4** | **Info** | `docs/SUPABASE_PREFLIGHT_REPORT.md` and `docs/POST_DEPLOYMENT_SECURITY_AUDIT.md` are untracked locally in Git. | Commit/push audit docs to `clean-deployment` before final release handoff if desired. |

---

## 6. Final Verdict for System Owner Initialization: **READY**

**Justification:** All `26/26` `public` tables and `storage.buckets`/`storage.objects` have RLS enabled; `anon` has zero table and function access (`401` verified live); `profiles` privilege escalation is blocked at RLS, column grant, and `BEFORE UPDATE` trigger levels; all `21/21` functions enforce `search_path=""` and zero `anon`/`PUBLIC` `EXECUTE` grants; and `0` users or data rows exist yet. System Owner bootstrapping (`auth.users` + `public.profiles`) can safely proceed, with Finding #1 and Finding #2 recommended via a small follow-up migration prior to enabling student traffic / issuing verification tokens.
