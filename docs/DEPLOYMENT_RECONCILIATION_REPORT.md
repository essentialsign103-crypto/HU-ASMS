# HU-ASMS — Deployment Reconciliation Report (Strictly Read-Only)

**Date:** 2026-11-12  
**Target Supabase Project:** `tkdrxfvxryemfdrwcmay` (`"hu-accadamic assistent system"`, `eu-north-1`, production)  
**Mode:** Strictly read-only inspection (`npx supabase db query --remote --read-only`, `npx supabase migration list --remote`, Git read-only checks, and conversation log forensics). **Zero** database mutations, **zero** migrations applied, **zero** Git commits/pushes, **zero** Vercel deployments, **zero** webhook changes, and **zero** secret values exposed.

---

## 1. Executive Reconciliation: Why 10 Migrations Are Already Applied (No Unauthorized Push Occurred)

The apparent discrepancy comes from two separate stages in this session:

1. **Initial 10 Migrations (`20261110000001` – `20261112000002`) — Explicitly Authorized & Applied Earlier:**
   - **Explicit User Authorization (`2026-11-12T08:45:34Z` / `00:45:34-08:00`, transcript step `3883`):**
     > *"I explicitly authorize the initial Supabase migration deployment. Target project: `tkdrxfvxryemfdrwcmay`. Execute: `npx supabase db push`"*
   - **Execution (`2026-11-12T08:47:58Z` – `08:49:15Z` / `00:47:58` – `00:49:15-08:00`, transcript steps `3891`–`3893`):**
     Ran `npx supabase db push --remote --yes` (`--yes` required by Supabase CLI v3.1.0 agent mode after `HostedMutationConsentRequiredError`; no `--include-all`, `--force`, or `db reset`), applying migrations `1`–`10` cleanly (`exit=0`) and documented in [`docs/SUPABASE_PREFLIGHT_REPORT.md`](file:///d:/HU-ASMS%20%E2%80%94%20University/docs/SUPABASE_PREFLIGHT_REPORT.md#L108-L145).
   - **User Milestone Acceptance (`2026-11-12T08:59:07Z` / `00:59:07-08:00`, transcript step `3918`):**
     > *"Excellent. The initial 10 Supabase migrations have been successfully deployed. I accept the migration deployment milestone."*

2. **New 11th Forward Migration (`20261112000003_post_deployment_security_hardening.sql`) — Staged Only, NOT Applied:**
   - Created after the post-deployment read-only security audit (`docs/POST_DEPLOYMENT_SECURITY_AUDIT.md`) to address the three targeted hardening items.
   - As instructed (*"Wait for my approval before applying the new migration to Supabase"*), `20261112000003` has **NOT** been executed against `tkdrxfvxryemfdrwcmay`.

---

## 2. Confirmed Supabase Migration History & Remote Schema Verification (`tkdrxfvxryemfdrwcmay`)

### 2.1 `supabase_migrations.schema_migrations` (`10 / 10` Initial Migrations Applied)
| # | Version | Recorded Name | Statements | Local Match | Status |
|---|---|---|---|---|---|
| 1 | `20261110000001` | `initial_schema` | 79 | [`20261110000001_initial_schema.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261110000001_initial_schema.sql) | Applied |
| 2 | `20261110000002` | `row_level_security` | 70 | [`20261110000002_row_level_security.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261110000002_row_level_security.sql) | Applied |
| 3 | `20261110000003` | `storage_setup` | 3 | [`20261110000003_storage_setup.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261110000003_storage_setup.sql) | Applied |
| 4 | `20261110000004` | `delivery_items_rep_policy` | 1 | [`20261110000004_delivery_items_rep_policy.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261110000004_delivery_items_rep_policy.sql) | Applied |
| 5 | `20261110000005` | `security_hardening` | 37 | [`20261110000005_security_hardening.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261110000005_security_hardening.sql) | Applied |
| 6 | `20261111000001` | `track_b_rep_active_profile_guard` | 5 | [`20261111000001_track_b_rep_active_profile_guard.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261111000001_track_b_rep_active_profile_guard.sql) | Applied |
| 7 | `20261111000002` | `track_b_atomic_rpcs_and_db_parity` | 42 | [`20261111000002_track_b_atomic_rpcs_and_db_parity.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql) | Applied |
| 8 | `20261111000003` | `track_b_function_privilege_and_default_acl_hardening` | 29 | [`20261111000003_track_b_function_privilege_and_default_acl_hardening.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261111000003_track_b_function_privilege_and_default_acl_hardening.sql) | Applied |
| 9 | `20261112000001` | `critical_blockers_persistence_and_identity_hardening` | 32 | [`20261112000001_critical_blockers_persistence_and_identity_hardening.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261112000001_critical_blockers_persistence_and_identity_hardening.sql) | Applied |
| 10 | `20261112000002` | `minimum_deployment_blocker_fixes` | 12 | [`20261112000002_minimum_deployment_blocker_fixes.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261112000002_minimum_deployment_blocker_fixes.sql) | Applied |
| 11 | `20261112000003` | *(Pending local forward migration)* | — | [`20261112000003_post_deployment_security_hardening.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261112000003_post_deployment_security_hardening.sql) | **NOT Applied (`""`)** |

### 2.2 Live Remote Schema Comparison (`1`–`10` Expected vs. Actual)
All expected database objects from migrations `1`–`10` are present and complete (`0` missing or partially applied application objects):
- **Tables (`26 / 26` with RLS enabled):** `academic_years`, `audit_logs`, `bot_sessions`, `courses`, `deliveries`, `delivery_items`, `departments`, `group_members`, `groups`, `identity_change_history`, `identity_change_requests`, `notifications`, `profiles`, `project_file_rules`, `project_targets`, `projects`, `rate_limit_buckets`, `registration_requests`, `representative_assignments`, `sections`, `student_verification_tokens`, `students`, `submission_files`, `submission_members`, `submissions`, `teachers`.
- **Enum Types (`8 / 8`):** `delivery_status_enum`, `group_status`, `membership_status`, `request_status`, `student_registration_status`, `submission_record_status`, `submission_type_enum`, `user_role`.
- **Policies (`48` live total):** `46` on `public` tables + `2` on `storage.objects` (`owner_full_storage_access`, `representative_read_storage_objects`).
- **Functions (`21 / 21`):** All `21` functions in `public` match migrations `01`–`10` and all declare `search_path=""` (`12` `SECURITY DEFINER`, `9` `SECURITY INVOKER`).
- **Triggers, Indexes & Constraints:** `25` non-internal `public` triggers, `71` `public` indexes, `97` `public` constraints (including `chk_project_file_rules_max_size`), and extensions `{pg_stat_statements, pgcrypto, supabase_vault, uuid-ossp}`.
- **Auth Users:** `0` (`auth.users` empty; System Owner not initialized yet).
- **Storage Buckets:**
  - `'submission-files-vault'`: Expected private bucket (`public = false`, `file_size_limit = 52428800` [50 MB], 5 MIME types, `0` objects).
  - **Unexpected / Outside-Repo Object:** Empty private bucket `'hu-assistant'` (`public = false`, `file_size_limit = null`, `allowed_mime_types = null`, `0` objects, created `2026-11-12 08:47:14.964282+00`), referenced nowhere in the repo.
- **Pre-`20261112000003` Live Privilege Proof:** `has_table_privilege('authenticated', 'public.student_verification_tokens', 'TRUNCATE')` still returns `true`, confirming `20261112000003` has not run.

---

## 3. Pending Migration Review (`20261112000003_post_deployment_security_hardening.sql`)

Full SQL inspected in [`supabase/migrations/20261112000003_post_deployment_security_hardening.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261112000003_post_deployment_security_hardening.sql):

| Change | Why Needed | Conflict Check | Safe & Idempotent? | Test Coverage |
|---|---|---|---|---|
| 1. `REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.student_verification_tokens FROM authenticated;` | Migration `05` ran `REVOKE TRUNCATE... ON ALL TABLES` before Migration `09` created `student_verification_tokens`; `TRUNCATE` bypasses RLS. | None (`UPDATE` already revoked in Migration `10`; `SELECT`, `INSERT`, `DELETE` retained for `/admin/students`). | **Yes** (PostgreSQL `REVOKE` succeeds repeatedly). | [`track-b-privilege-and-sql-hardening.test.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/test/track-b-privilege-and-sql-hardening.test.ts#L100-L133) + migration inline `DO $$` assertion block. |
| 2. `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated;` (+ guarded `current_user` block) | Live `pg_default_acl` confirms future `postgres`-owned tables in `public` currently grant `authenticated` `arwdDxtm`. Revoking `Dxt` prevents `TRUNCATE` bypass on future tables while preserving `SELECT/INSERT/UPDATE/DELETE` needed by SSR actions (`anon` already excluded by Migration `05`). | None. | **Yes** (`ALTER DEFAULT PRIVILEGES ... REVOKE` is idempotent). | Covered by static contract regex assertions in [`track-b-privilege-and-sql-hardening.test.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/test/track-b-privilege-and-sql-hardening.test.ts#L120-L124). |
| 3. `DROP POLICY IF EXISTS "System Owners manage student verification tokens" ...; CREATE POLICY ... TO authenticated USING (public.auth_is_system_owner()) WITH CHECK (public.auth_is_system_owner());` | Current policy in Migration `09` omitted `TO authenticated` and defaults to `{public}`. Preserves exact `auth_is_system_owner()` predicate cleanly under `{authenticated}`. | Replaces Migration `09`'s policy definition cleanly without conflict. | **Yes** (`DROP POLICY IF EXISTS` + `CREATE POLICY`). | Verified by static SQL contract test + inline `DO $$` `pg_policies.roles` assertion. |
| 4. `UPDATE storage.buckets SET file_size_limit = 20971520, updated_at = clock_timestamp() WHERE id = 'submission-files-vault';` | Aligns bucket object limit from 50 MB (`52428800` in Migration `03`) to 20 MB (`20971520`), matching Cloud Telegram Bot API `getFile` and `chk_project_file_rules_max_size` (`20261112000002`). | None (`0` objects exist; preserves `public = false` and MIME allowlist). | **Yes** (updates a single scalar config field). | Verified by inline `DO $$` `storage.buckets` assertion (`public = false` and `file_size_limit = 20971520`). |

---

## 4. GitHub Synchronization & Cleanliness (`clean-deployment`)

- **Remote & Tracking:** `origin` (`https://github.com/essentialsign103-crypto/HU-ASMS.git`), branch `clean-deployment` at commit `2d6cf60` (`0` ahead / `0` behind `origin/clean-deployment`).
- **Local Uncommitted Changes Separated by Category:**
  - **Required Application / Database / Test Changes:**
    - `?? supabase/migrations/20261112000003_post_deployment_security_hardening.sql`
    - `M apps/web/test/track-b-privilege-and-sql-hardening.test.ts` (`+22` lines adding `20261112000003` to ordered migration assertions)
  - **Audit & Readiness Documentation (Untracked):**
    - `?? docs/SUPABASE_PREFLIGHT_REPORT.md`
    - `?? docs/POST_DEPLOYMENT_SECURITY_AUDIT.md`
    - `?? docs/POST_DEPLOYMENT_SECURITY_REMEDIATION.md`
    - `?? docs/VERCEL_DEPLOYMENT_READINESS.md`
    - `?? docs/DEPLOYMENT_RECONCILIATION_REPORT.md`
  - **Build Artifact Noise (Do Not Commit / Restore Before Commit):**
    - `M apps/web/tsconfig.tsbuildinfo` (local TypeScript incremental build stamp touched during `npm run typecheck`)
- **Secrets Scan:** Zero `.env*` files are staged or untracked outside `.gitignore`, and scanning all modified/untracked files confirmed zero JWTs, zero `sb_secret_`/`sb_publishable_` credentials, and zero Telegram bot tokens (`SUPABASE_PREFLIGHT_REPORT.md:84` contains only literal prefix doc text `sb_secret_`/`sb_publishable_`).

---

## 5. Exact Vercel Project Configuration & Readiness (Read-Only)

| Setting / Requirement | Exact Value / Scope | Local Evidence & Notes |
|---|---|---|
| **GitHub Repository** | `essentialsign103-crypto/HU-ASMS` | Verified via `git remote -v` (remote Vercel linkage not yet established/verifiable locally). |
| **Production Branch** | `clean-deployment` | Must point Vercel Production deploys to `clean-deployment` once local changes are pushed. |
| **Root Directory** | `apps/web` | Required because root `vercel.json` is intentionally removed and [`apps/web/vercel.json`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/vercel.json) runs `cd ../.. && ...`. |
| **Framework Preset** | `Next.js` (`"framework": "nextjs"`) | Verified in `apps/web/vercel.json`; local `npm run build` passed cleanly (`21/21` routes + `95 kB` Middleware). |
| **Install Command** | `cd ../.. && npm install` | Defined in `apps/web/vercel.json` so all monorepo workspaces resolve. |
| **Build Command** | `cd ../.. && npm run build` | Builds `@hu-asms/types`, `@hu-asms/shared`, `@hu-asms/validation`, `@hu-asms/database`, `@hu-asms/bot`, and Next.js `@hu-asms/web`. |
| **Client + Server Env Vars** | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser client, Edge Middleware, SSR server client (`apps/web`). |
| **Server-Only Env Vars (Sensitive)** | `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | Required for `POST /api/bot/webhook` (`@hu-asms/bot/webhook`), `bot_sessions`, distributed rate limiting (`rate_limit_buckets`), and `'submission-files-vault'` uploads. |
| **Serverless Timeout** | `>= 30s` (Vercel Fluid Compute or `maxDuration`) | [`apps/web/src/app/api/bot/webhook/route.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/api/bot/webhook/route.ts) (`runtime = 'nodejs'`) processes up to `20 MB` Telegram `getFile` downloads + `eu-north-1` Storage uploads synchronously during webhook HTTP requests without an explicit `maxDuration` export. |

---

## 6. Final Verdict: **NOT READY**

**Remaining Sequenced Prerequisites (All Blocked Pending Explicit Approval):**
1. Apply approved forward migration `20261112000003_post_deployment_security_hardening.sql` to `tkdrxfvxryemfdrwcmay` and run post-apply security advisor & privilege checks.
2. Cleanly commit/push `20261112000003`, updated test file, and approved docs to `origin/clean-deployment` (discarding `tsconfig.tsbuildinfo` diff).
3. Connect/verify the Vercel project (`essentialsign103-crypto/HU-ASMS`, branch `clean-deployment`, **Root Directory = `apps/web`**) and configure the 5 required Vercel environment variables + function timeout.
4. Deploy Vercel, initialize the first System Owner (`auth.users` + `public.profiles`) on `tkdrxfvxryemfdrwcmay`, and register Telegram `setWebhook` (`https://<vercel-domain>/api/bot/webhook` with `TELEGRAM_WEBHOOK_SECRET`).
