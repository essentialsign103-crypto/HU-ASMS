# HU-ASMS — Final Read-Only Deployment Reconciliation Audit

**Audit Date:** 2026-11-12  
**Target Supabase Project:** `tkdrxfvxryemfdrwcmay` (`"hu-accadamic assistent system"`, `eu-north-1`, production)  
**GitHub Repository / Branch:** `https://github.com/essentialsign103-crypto/HU-ASMS.git` (`origin/clean-deployment` @ `5ea64c5`)  
**Audit Constraints Observed:** Strictly read-only inspection (`npx supabase db query --remote --read-only`, `npx supabase migration list --remote`, read-only Git checks). **Zero** database writes, **zero** migrations applied, **zero** commits/pushes, **zero** Vercel changes, and **zero** secret values printed or repeated.

---

## 1. Confirmed Facts (Executive Summary)

1. **Supabase Database Schema & Migrations Are 100% Deployed (`11 / 11`):** Remote `supabase_migrations.schema_migrations` on `tkdrxfvxryemfdrwcmay`, local `supabase/migrations/`, and GitHub `origin/clean-deployment` (`5ea64c5`) all match identically across all **11** migrations (`20261110000001` through `20261112000003`), verified by exact Git blob SHA parity.
2. **Database Contains `26` `public` Application Tables — NOT `11` and NOT `0`:** The earlier `0` count was from pre-migration preflight (`08:32Z`); the `"11 tables"` claim in the local uncommitted `02:24 AM` edit to `docs/DEPLOYMENT_RECONCILIATION_REPORT.md` came solely from `verify-remote-state.mjs` querying a hardcoded sample list of `11` table names.
3. **Storage Bucket `'submission-files-vault'` Is Private & Capped at `20 MB` (`20971520` bytes):** Both the remote migration ledger (`20261112000003`) and live `storage.buckets` confirm this independently. An unused, empty private bucket `'hu-assistant'` exists (`created_at: 2026-11-12 08:47:14.964282+00`), created outside migrations and untouched.
4. **Database Security Hardening Is Verified Live:** All `26 / 26` `public` tables enforce RLS, `anon` has zero table/function access, `authenticated` has `TRUNCATE = false` across all `26 / 26` `public` tables, `redeem_student_verification_token` is `SECURITY DEFINER` (`search_path=""`) executable **only** by `service_role`, and `storage.objects` allows only scoped `authenticated` System Owner / section representative access.
5. **Exposed Local Credential Is a Supabase Personal Access Token (`sbp_...`):** Found locally in untracked `check-migrations.mjs:4` and the local modified `docs/DEPLOYMENT_RECONCILIATION_REPORT.md` (`L527, 532, 538, 874, 983`) — **not** a `service_role` key (`origin/clean-deployment` history does **not** contain this token). It **must be revoked immediately** and those local files cleaned before any commit.
6. **Application / Production Launch Status: Database READY; Full System NOT YET READY FOR LIVE TRAFFIC:** `auth.users = 0` (no System Owner), `0` institutional seed rows, Vercel deployment & live env vars unverified, Telegram `setWebhook` unconfigured, and live integration tests remain unexecuted.

---

## 2. Exact Remote & Local Migration Ledger Comparison (`11 / 11` Parity)

> **Ledger Column Note:** Live `information_schema.columns` inspection confirms `supabase_migrations.schema_migrations` on `tkdrxfvxryemfdrwcmay` contains `version` (`text`), `name` (`text`), and `statements` (`text[]`), with **no `inserted_at` column**. Execution timestamps below come from recorded CLI logs (`transcript.jsonl`) and `storage.buckets` timestamps.

| # | Version | Remote Ledger `name` | Statements / SQL Len | Local File (`supabase/migrations/`) | Git Blob SHA (Local = `origin/clean-deployment`) | Remote & GitHub Status |
|---|---|---|---|---|---|---|
| 1 | `20261110000001` | `initial_schema` | 79 / 24,530 | `20261110000001_initial_schema.sql` | `400d58d40d9a504f958671b4bdb04421c104f18a` | Applied (`08:47–08:49Z`), Exact Match |
| 2 | `20261110000002` | `row_level_security` | 70 / 11,915 | `20261110000002_row_level_security.sql` | `81411953c23536b1eb536fc0c6712e9f8e8f7332` | Applied (`08:47–08:49Z`), Exact Match |
| 3 | `20261110000003` | `storage_setup` | 3 / 1,796 | `20261110000003_storage_setup.sql` | `0f65fa4c222a30de50efc71db44baa1e061f825b` | Applied (`08:49:12Z`), Exact Match |
| 4 | `20261110000004` | `delivery_items_rep_policy` | 1 / 668 | `20261110000004_delivery_items_rep_policy.sql` | `050d436a2ecb2e86a41f0760735e7c132ba76117` | Applied (`08:47–08:49Z`), Exact Match |
| 5 | `20261110000005` | `security_hardening` | 37 / 11,745 | `20261110000005_security_hardening.sql` | `5e6552dc965c28b6f3f3752a429cfb3b7b4528dc` | Applied (`08:47–08:49Z`), Exact Match |
| 6 | `20261111000001` | `track_b_rep_active_profile_guard` | 5 / 1,751 | `20261111000001_track_b_rep_active_profile_guard.sql` | `b8b679bc8602c5f282a5236ccbcbf8c68cf1a646` | Applied (`08:47–08:49Z`), Exact Match |
| 7 | `20261111000002` | `track_b_atomic_rpcs_and_db_parity` | 42 / 36,998 | `20261111000002_track_b_atomic_rpcs_and_db_parity.sql` | `adb5a45ba33f9bf52e05ace9c676708628500f90` | Applied (`08:47–08:49Z`), Exact Match |
| 8 | `20261111000003` | `track_b_function_privilege_and_default_acl_hardening` | 29 / 10,579 | `20261111000003_track_b_function_privilege_and_default_acl_hardening.sql` | `8fe70e26ae646fa839862113bc4b4d823c57d4b5` | Applied (`08:47–08:49Z`), Exact Match |
| 9 | `20261112000001` | `critical_blockers_persistence_and_identity_hardening` | 32 / 22,563 | `20261112000001_critical_blockers_persistence_and_identity_hardening.sql` | `f8b1859860a8cb4aed3721d6fd73fb82bbf24b99` | Applied (`08:47–08:49Z`), Exact Match |
| 10 | `20261112000002` | `minimum_deployment_blocker_fixes` | 12 / 20,399 | `20261112000002_minimum_deployment_blocker_fixes.sql` | `52f729af4b103c2128187f8c5c6bf20630316a92` | Applied (`08:47–08:49Z`), Exact Match |
| **11** | **`20261112000003`** | **`post_deployment_security_hardening`** | **7 / 5,335** | `20261112000003_post_deployment_security_hardening.sql` | `cdebb2c53022a1d6ba5b48c358cd6fc956727e73` | **Applied (`09:44:45Z`), Exact Match** |

- **Missing / Duplicated / Modified / Unexpected Migrations:** **None** (`0` missing, `0` duplicates, `0` local-vs-remote-vs-GitHub diffs; `git diff --stat origin/clean-deployment -- supabase/migrations/` is empty).
- **Exact 11th Migration Identity:** `20261112000003_post_deployment_security_hardening.sql`, authorized at `01:43 AM -08:00` (`09:43Z`) and applied via `npx supabase db push --remote --yes` at `09:44:45Z` (`updated_at` on `submission-files-vault` matches `2026-11-12 09:44:45.587626+00`). Committed to `origin/clean-deployment` in `656e7ae`.

---

## 3. Explanation of Discrepancy Across Earlier Reports

| Reported Count | Source Document / Script | Actual Reason |
|---|---|---|
| **`0` user tables (`0` applied)** | [`docs/SUPABASE_PREFLIGHT_REPORT.md`](file:///d:/HU-ASMS%20%E2%80%94%20University/docs/SUPABASE_PREFLIGHT_REPORT.md#L38-L46) (`08:32Z` preflight) | Accurate snapshot of brand-new empty project `tkdrxfvxryemfdrwcmay` **before** initial `npx supabase db push` ran (`08:47:58Z`–`08:49:15Z`). |
| **`26` created `public` tables** | [`docs/POST_DEPLOYMENT_SECURITY_AUDIT.md`](file:///d:/HU-ASMS%20%E2%80%94%20University/docs/POST_DEPLOYMENT_SECURITY_AUDIT.md#L50) & live `information_schema.tables` | **True count** of `BASE TABLE`s in `public` created by migrations `01`–`10` (`23` core tables in `01` + `bot_sessions`, `rate_limit_buckets`, `student_verification_tokens` in `09`). |
| **`11` tables** | `verify-remote-state.mjs` (`L23–35`) & `02:24 AM` external edit to `docs/DEPLOYMENT_RECONCILIATION_REPORT.md` | **Artifact of a partial check script:** `verify-remote-state.mjs` only iterated over a hardcoded array of `11` table names (`students`, `student_verification_tokens`, `profiles`, `representative_assignments`, `submissions`, `submission_files`, `groups`, `group_members`, `registration_requests`, `audit_logs`, `identity_change_history`), omitting the other `15` real `public` tables (`academic_years`, `bot_sessions`, `courses`, `deliveries`, `delivery_items`, `departments`, `identity_change_requests`, `notifications`, `project_file_rules`, `project_targets`, `projects`, `rate_limit_buckets`, `sections`, `submission_members`, `teachers`), and the external report mistook those `11` probed tables for total DB tables. Also note `check-migrations.mjs` failed with `403`/RPC error because it sent a PAT (`sbp_...`) to PostgREST `/rest/v1/rpc/sql`, causing that script to wrongly claim remote migration count was `"UNKNOWN"`. |

---

## 4. Database Structure Inventory (Live `tkdrxfvxryemfdrwcmay`)

### 4.1 Schema Breakdown (`information_schema.tables`)
| Schema | Base Tables | Views | Category / Purpose |
|---|---|---|---|
| `public` | **26** | 0 | HU-ASMS application tables |
| `auth` | **27** | 0 | Supabase-managed GoTrue authentication tables |
| `storage` | **10** | 0 | Supabase-managed Storage tables (`buckets`, `objects`, `s3_multipart_uploads`, etc.) |
| `realtime` | **3** | 0 | Supabase-managed Realtime subscription tables |
| `supabase_migrations` | **1** | 0 | CLI migration ledger (`schema_migrations`) |
| `vault` | **1** | **1** | Supabase Vault extension table & `decrypted_secrets` view |
| `extensions` | 0 | **2** | `pg_stat_statements`, `pg_stat_statements_info` views |

### 4.2 All `26` `public` Tables — Live RLS, `anon`, `TRUNCATE` & Policy Count
*(Source: Live read-only `pg_class`, `has_table_privilege`, and `pg_policies` query on `tkdrxfvxryemfdrwcmay`)*

| Table Name | RLS Enabled | RLS Forced | `anon` `SELECT` | `authenticated` `TRUNCATE` | Policy Count |
|---|---|---|---|---|---|
| `academic_years` | `true` | `false` | `false` | `false` | 2 |
| `audit_logs` | `true` | `false` | `false` | `false` | 2 |
| `bot_sessions` | `true` | `false` | `false` | `false` | 0 (`service_role` only) |
| `courses` | `true` | `false` | `false` | `false` | 2 |
| `deliveries` | `true` | `false` | `false` | `false` | 2 |
| `delivery_items` | `true` | `false` | `false` | `false` | 3 |
| `departments` | `true` | `false` | `false` | `false` | 2 |
| `group_members` | `true` | `false` | `false` | `false` | 2 |
| `groups` | `true` | `false` | `false` | `false` | 2 |
| `identity_change_history` | `true` | `false` | `false` | `false` | 1 |
| `identity_change_requests` | `true` | `false` | `false` | `false` | 1 |
| `notifications` | `true` | `false` | `false` | `false` | 1 |
| `profiles` | `true` | `false` | `false` | `false` | 3 |
| `project_file_rules` | `true` | `false` | `false` | `false` | 2 |
| `project_targets` | `true` | `false` | `false` | `false` | 2 |
| `projects` | `true` | `false` | `false` | `false` | 2 |
| `rate_limit_buckets` | `true` | `false` | `false` | `false` | 0 (`service_role` only) |
| `registration_requests` | `true` | `false` | `false` | `false` | 2 |
| `representative_assignments` | `true` | `false` | `false` | `false` | 2 |
| `sections` | `true` | `false` | `false` | `false` | 2 |
| `student_verification_tokens` | `true` | `false` | `false` | `false` | 1 |
| `students` | `true` | `false` | `false` | `false` | 2 |
| `submission_files` | `true` | `false` | `false` | `false` | 2 |
| `submission_members` | `true` | `false` | `false` | `false` | 2 |
| `submissions` | `true` | `false` | `false` | `false` | 2 |
| `teachers` | `true` | `false` | `false` | `false` | 2 |

*(Note: `auth.users` count = `0`, `public.students` count = `0`, `public.departments` count = `0`.)*

---

## 5. Storage Configuration Verification (Live `storage.buckets` & `storage.objects`)

| Bucket ID / Name | `public` | `file_size_limit` | `allowed_mime_types` | `created_at` (UTC) | `updated_at` (UTC) | Objects | Origin & Verification |
|---|---|---|---|---|---|---|---|
| `submission-files-vault` | **`false`** | **`20971520` (20 MB)** | `application/pdf`, `application/zip`, `application/x-zip-compressed`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/msword` | `2026-11-12 08:49:12.029242+00` | `2026-11-12 09:44:45.587626+00` | `0` | Created at 50 MB (`52428800`) by Migration `03` (`08:49:12Z`); aligned to 20 MB (`20971520`) by Migration `11` (`20261112000003`, `09:44:45Z`), independently confirmed in `supabase_migrations.schema_migrations`. |
| `hu-assistant` | `false` | `null` | `null` | `2026-11-12 08:47:14.964282+00` | `2026-11-12 08:47:14.964282+00` | `0` | Created outside repository migrations; unreferenced in codebase; untouched. |

- **`storage.objects` Policies (`pg_policies` where `schemaname = 'storage'`):**
  1. `owner_full_storage_access` (`ALL`, `PERMISSIVE`, `{authenticated}`): `(bucket_id = 'submission-files-vault'::text) AND auth_is_system_owner()`
  2. `representative_read_storage_objects` (`SELECT`, `PERMISSIVE`, `{authenticated}`): `(bucket_id = 'submission-files-vault'::text) AND EXISTS (SELECT 1 FROM submission_files sf JOIN submissions s ON s.id = sf.submission_id WHERE sf.storage_path = objects.name AND auth_is_rep_for_section(s.section_id))`
  - Zero `anon` policies exist on `storage.objects`.

---

## 6. Security Findings Verification

- **RLS & Privileges:** `26 / 26` `public` tables have `rls_enabled = true`; `46` `public` policies + `2` `storage` policies (`48` total) are active. `student_verification_tokens` policy `"System Owners manage student verification tokens"` targets `{authenticated}` with `auth_is_system_owner()`, `UPDATE` and `TRUNCATE` are `false` for `authenticated`.
- **`TRUNCATE` Privileges:** `authenticated` holds `TRUNCATE = false` across **all `26 / 26`** `public` tables (`bot_sessions`, `profiles`, `representative_assignments`, `student_verification_tokens`, etc.), and `pg_default_acl` for `postgres` in `public` confirms `authenticated=arwdm/postgres` (excluding `Dxt`).
- **Functions (`21 / 21` `public` functions):** Every function pins `proconfig = ["search_path=\"\""]`, and `PUBLIC` + `anon` have `EXECUTE = false` on all `21 / 21`:
  - **`service_role`-only (`3` `SECURITY DEFINER` functions, `authenticated = false`):**
    - **`redeem_student_verification_token`** (`prosecdef = true`, `search_path=""`, `exec_public = false`, `exec_anon = false`, `exec_auth = false`, `exec_service = true`) — strictly restricted to `service_role`.
    - `admin_set_profile_status` (`exec_service = true` only)
    - `check_and_increment_rate_limit` (`exec_service = true` only)
  - **`authenticated`-only (`1` `SECURITY DEFINER`):** `record_scoped_audit_log` (requires non-null `auth.uid()` + active staff + allowlisted section scope).
  - **`authenticated` + `service_role` (`6` functions):** `auth_is_system_owner`, `auth_is_rep_for_section`, `is_project_targeted_to_section` (`INVOKER`), `approve_student_registration`, `reject_student_registration`, `mark_delivery_sent_with_audit` (each enforces active System Owner / section checks internally).
  - **Owner-only (`11` functions — no `PUBLIC`/`anon`/`authenticated`/`service_role`):** `audit_student_verification_token_issue`, `auth_get_assigned_section_ids`, and all 9 trigger functions.
- **Note on Local Script Bug (`VERIFICATION_QUERIES.sql`):** If run manually in SQL Editor, Query `1.1` references non-existent column `inserted_at`, and Query `3.1` checks `'search_path=' = ANY(proconfig)` whereas Postgres 17 stores `'search_path=""'` (all 21 live functions have `search_path=""`).

---

## 7. Credential Classification & Rotation Assessment (Zero Values Exposed)

- **Exposed Credential Classification:** The token present in local untracked `check-migrations.mjs:4` and local uncommitted `docs/DEPLOYMENT_RECONCILIATION_REPORT.md` (`L527, 532, 538, 874, 983`) begins with `sbp_` — it is a **Supabase Personal Access Token (PAT)** (account-level CLI / Management API token).
  - It is **not** a project `service_role` / `sb_secret_` key, **not** a project `anon` / `sb_publishable_` key, **not** a database password, and **not** a Telegram bot token (`DEPLOYMENT_RECONCILIATION_REPORT.md:527, 538` mislabeled it as `SUPABASE_SERVICE_ROLE_KEY` / `"service role key"`).
- **GitHub Branch Cleanliness:** `git grep` on `origin/clean-deployment` (`5ea64c5`) confirms **zero** `sbp_` PATs and **zero** `sb_secret_` keys exist in pushed commits (`apps/bot/test/webhook-security.test.ts:113` holds only a synthetic unit-test fixture string for `sanitizeLogData`).
- **Required Revocation / Cleanup Actions:**
  1. **Revoke Immediately:** Revoke the exposed `sbp_...` **Supabase Personal Access Token** in **Supabase Dashboard → Account → Access Tokens** (a PAT grants full Management API access across projects under that account). Generate a fresh PAT only if CLI administration is needed later.
  2. **Scrub Local Working Tree Before Any Git Operations:** Delete untracked `check-migrations.mjs` and revert/discard or scrub the external `02:24 AM` edits in `docs/DEPLOYMENT_RECONCILIATION_REPORT.md` so the PAT never enters Git history (also review `verify-remote-state.mjs` and `VERIFICATION_QUERIES.sql` as temporary untracked scripts).
  3. **Project API Keys & Telegram Secrets:** Were **not** found in any tracked/untracked script or markdown report scanned above; rotate `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, or `TELEGRAM_WEBHOOK_SECRET` **only** if those values were pasted or shared separately outside the repository.

---

## 8. Application Readiness vs. Unverified Items

| Layer | Status | Details |
|---|---|---|
| **Database Deployment (`tkdrxfvxryemfdrwcmay`)** | **COMPLETE** | `11/11` migrations applied, `26/26` RLS tables, hardened grants/functions/storage (`20 MB` private bucket). |
| **Application Integration & Production Launch** | **NOT READY / UNVERIFIED** | Local workspace build/unit tests (`230/230` mocked) passed previously, but live end-to-end infrastructure is not yet initialized or verified. |

### Unverified / Remaining Items
1. **System Owner Account (`auth.users = 0`):** Initial `system_owner` has not yet been created in Supabase Auth + `public.profiles`.
2. **Institutional Seed Data (`departments = 0`, `students = 0`):** Departments, academic years, sections, courses, teachers, projects, and `project_file_rules` are empty.
3. **Vercel Linking, Deployment & Env Vars:** Vercel CLI is not installed/authenticated locally and no `.vercel/` link exists; GitHub branch connection (`clean-deployment`), `Root Directory = apps/web`, server function timeout (`>= 30s`), and production env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`) remain unverified on Vercel.
4. **Live Integration Tests Outstanding:**
   - Authenticated real-JWT RLS boundary tests (non-staff user, active/deactivated Section Representative cross-section isolation, System Owner token insert/revoke + `UPDATE`/`TRUNCATE` denial).
   - Live Telegram Bot `setWebhook` registration -> `POST /api/bot/webhook` -> `bot_sessions` persistence across serverless calls & `rate_limit_buckets` enforcement.
   - Live 20 MB rejection + real `.pdf`/`.docx` Telegram `getFile` download -> `'submission-files-vault'` upload -> 15-minute signed URL download in `/rep/submissions`.
   - Live token issuance via `/admin/students` -> lowercase DM redemption -> 5-attempt lockout verification.

---

## 9. Recommended Next Actions (Order of Execution Upon Approval)

1. **Immediately Revoke Exposed Supabase PAT (`sbp_...`)** in Supabase Dashboard → Account → Access Tokens, and delete local `check-migrations.mjs` + restore/clean local uncommitted `docs/DEPLOYMENT_RECONCILIATION_REPORT.md` (keep `docs/DEPLOYMENT_RECONCILIATION_FINAL.md`).
2. **Clean GitHub Sync (When Authorized):** Commit/push only vetted documentation updates (`docs/DEPLOYMENT_RECONCILIATION_FINAL.md`) if desired; keep `.env*`, temporary `.mjs`/`.sql` check scripts, and `tsconfig.tsbuildinfo` out of Git.
3. **Configure & Deploy Vercel (`apps/web`):** Link `essentialsign103-crypto/HU-ASMS` branch `clean-deployment`, set Root Directory `apps/web`, configure the 5 required env vars + `>= 30s` serverless timeout, and deploy.
4. **Initialize System Owner & Institutional Data:** Create the first System Owner in Supabase Auth + `public.profiles`, load institutional data (`departments`, `sections`, `projects`, `project_file_rules`), register Telegram `setWebhook` with `TELEGRAM_WEBHOOK_SECRET`, and execute the live smoke & RLS tests.
