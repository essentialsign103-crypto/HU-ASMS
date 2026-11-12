# HU-ASMS — Supabase Deployment Preflight & Migration Execution Report

**Current Stage:** **INITIAL MIGRATIONS DEPLOYED (`10 / 10` APPLIED ON `tkdrxfvxryemfdrwcmay`)**  
**Date:** 2026-11-12  
**Supabase CLI Version:** `3.1.0` (`npx supabase --version`)  
**Target Project:** `tkdrxfvxryemfdrwcmay` (`"hu-accadamic assistent system"`, `eu-north-1`, production)  
**Next Stage Boundary:** System Owner creation, institutional setup data, Telegram webhook setup, and Vercel deployment have **NOT** been executed yet (awaiting approval).

---

## 1. Project Identity & Current Link State

### Confirmed Linked Local CLI State (`supabase/.temp/`)
- **Initial Preflight Link Found:** `mqfbqszvdwhizffdbjnp` (`"hu-accadamic assistent"`, which failed `404: {"message":"Resource has been removed"}`).
- **Updated Link (After User Confirmation):** Relinked locally via `npx supabase link --project-ref tkdrxfvxryemfdrwcmay --yes`.
- **`supabase/.temp/project-ref`:** `tkdrxfvxryemfdrwcmay`
- **Live Verification (`npx supabase migration list --remote`):** Connects cleanly to `project hu-accadamic assistent system (tkdrxfvxryemfdrwcmay) · production` (`git status` confirms `supabase/.temp/` remains `.gitignore`d).
- **`supabase/config.toml`:** Not present in `supabase/` (directory contains `.temp/`, `migrations/`, and `seed.sql`).

### Projects Visible via `npx supabase projects list`
Prior to relinking, two `ACTIVE_HEALTHY` projects existed under the authenticated CLI session:

| Project Ref | Name | Region | Organization ID | Postgres Version | Created At (UTC) | Status |
|---|---|---|---|---|---|---|
| `tkdrxfvxryemfdrwcmay` | `hu-accadamic assistent system` | `eu-north-1` | `hioknxwnzodercdadils` | `17.11.0.018` (`postgres_engine: 17`) | `2026-11-11T20:42:08.911374Z` | `ACTIVE_HEALTHY` **(Confirmed & Linked)** |
| `kkzvzklhldtglobtlvpr` | `etharatechnology` | `eu-central-1` | `wzgvhqlprtzlutbjxgcw` | `17.11.0.018` (`postgres_engine: 17`) | `2026-11-09T02:24:25.69935Z` | `ACTIVE_HEALTHY` |

### Identity Assessment
- **Confirmed Match:** User explicitly confirmed **`tkdrxfvxryemfdrwcmay`** (`"hu-accadamic assistent system"`, `eu-north-1`) as the intended NEW HU-ASMS Supabase project, matching `NEXT_PUBLIC_SUPABASE_URL` in `.env.local` (`tkdrxfvxryemfdrwcmay.supabase.co`).

---

## 2. Existing Remote Migration History & Database Inspection (`tkdrxfvxryemfdrwcmay`)

Inspected using non-mutating `--remote=tkdrxfvxryemfdrwcmay` flags (leaving local `supabase/.temp/` untouched):

- **Remote Migration History (`npx supabase migration list --remote=tkdrxfvxryemfdrwcmay`):**
  - **0 remote migrations applied** (all 10 versions report `"remote": ""`).
- **Existing Tables (`npx supabase inspect db table-stats --remote=tkdrxfvxryemfdrwcmay`):**
  - **`0` user tables** (`"rows": []`).
- **Database Footprint (`npx supabase inspect db db-stats --remote=tkdrxfvxryemfdrwcmay`):**
  - `database_size`: `"10 MB"`, `total_table_size`: `"0 bytes"`, `total_index_size`: `"0 bytes"`, `index_hit_rate`: `"N/A"`.
- **Roles (`npx supabase inspect db role-stats --remote=tkdrxfvxryemfdrwcmay`):**
  - Standard managed Supabase Postgres 17 roles present: `postgres` (`search_path="\$user", public, extensions`), `supabase_admin`, `supabase_auth_admin`, `supabase_storage_admin`, `supabase_realtime_admin`, `anon`, `authenticated`, `service_role`, `authenticator`, `cli_login_postgres`.
- **Storage Buckets (`GET /storage/v1/bucket` on `tkdrxfvxryemfdrwcmay`):**
  - **`0` buckets** (`'submission-files-vault'` does not exist yet).
- **Auth Settings (`GET /auth/v1/settings` on `tkdrxfvxryemfdrwcmay`):**
  - Responded `200 OK`; email provider active (`external.email = true`).

---

## 3. Local vs. Remote Migration Comparison (Chronological Order)

All 10 files live in [`supabase/migrations/`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations):

| # | Version | Migration Filename | Remote Status (`tkdrxfvxryemfdrwcmay`) | Key Objects / Changes |
|---|---|---|---|---|
| 1 | `20261110000001` | `20261110000001_initial_schema.sql` | Not applied (`""`) | Extensions (`uuid-ossp`, `pgcrypto`), 8 ENUM types, `update_timestamp_column()`, 16 core tables, updated_at/group triggers |
| 2 | `20261110000002` | `20261110000002_row_level_security.sql` | Not applied (`""`) | Enables RLS on core tables; creates `auth_is_system_owner()`, `auth_is_rep_for_section()`, `auth_get_assigned_section_ids()` and baseline policies |
| 3 | `20261110000003` | `20261110000003_storage_setup.sql` | Not applied (`""`) | Creates private `'submission-files-vault'` bucket (`file_size_limit = 52428800`) and 2 policies on `storage.objects` |
| 4 | `20261110000004` | `20261110000004_delivery_items_rep_policy.sql` | Not applied (`""`) | Representative INSERT RLS policy on `delivery_items` |
| 5 | `20261110000005` | `20261110000005_security_hardening.sql` | Not applied (`""`) | `SET search_path = ''` on helper/trigger functions, `record_scoped_audit_log()`, security triggers, tightened RLS/grants |
| 6 | `20261111000001` | `20261111000001_track_b_rep_active_profile_guard.sql` | Not applied (`""`) | Enforces `profiles.is_active = true` and role guard inside `auth_is_rep_for_section()` and `auth_get_assigned_section_ids()` |
| 7 | `20261111000002` | `20261111000002_track_b_atomic_rpcs_and_db_parity.sql` | Not applied (`""`) | Atomic RPCs (`approve_student_registration`, `reject_student_registration`, `mark_delivery_sent_with_audit`), DB integrity triggers, partial unique indexes, parity RLS |
| 8 | `20261111000003` | `20261111000003_track_b_function_privilege_and_default_acl_hardening.sql` | Not applied (`""`) | 4-bucket `REVOKE`/`GRANT` across 18 functions, `ALTER DEFAULT PRIVILEGES ... REVOKE ALL ON FUNCTIONS`, post-apply ACL assertion `DO` block |
| 9 | `20261112000001` | `20261112000001_critical_blockers_persistence_and_identity_hardening.sql` | Not applied (`""`) | `bot_sessions`, `rate_limit_buckets`, `check_and_increment_rate_limit()`, `student_verification_tokens`, `audit_student_verification_token_issue()`, `redeem_student_verification_token()`, updated `approve_student_registration()` |
| 10 | `20261112000002` | `20261112000002_minimum_deployment_blocker_fixes.sql` | Not applied (`""`) | `chk_project_file_rules_max_size` (`<= 20971520`), scoped `uq_pending_new_registration_hu_id`, token/trigger ACL revocations, 5-attempt/15-min lockout + audit logging in `redeem_student_verification_token()`, automatic superseding of competing claim/recovery requests |

---

## 4. Conflicts, Dependencies & Technical Checks

### Clean / Passed Checks
- **No Duplicate Versions or Ordering Gaps:** All `10` migration version prefixes (`20261110000001`–`20261112000002`) are unique and ordered chronologically.
- **Cross-Migration Dependencies Verified:**
  - `02` and `03` depend on tables from `01` (`profiles`, `representative_assignments`, `submission_files`, `submissions`) and functions from `02` (`auth_is_system_owner()`, `auth_is_rep_for_section()`).
  - `20261111000003` verifies exact function signatures created across `01`, `02`, `05`, and `20261111000002` and guards `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` with `pg_has_role(current_user, 'supabase_admin', 'MEMBER')`.
  - `20261112000002` safely drops `uq_pending_registration_request_hu_id` (`IF EXISTS`, created in `20261111000002`) and updates `redeem_student_verification_token()` and `approve_student_registration()` (introduced/updated in `20261112000001`).
- **Extensions & `search_path` Safety:** UUID defaults use built-in `gen_random_uuid()`; hardened functions use `SET search_path = ''` with fully schema-qualified names (`public.*`, `auth.*`) and zero unqualified `pgcrypto`/`uuid-ossp` calls.

### Resolved Blocker & Remaining Operational Warnings
1. **RESOLVED — Project Link Updated (`tkdrxfvxryemfdrwcmay`):** Initially linked to removed `mqfbqszvdwhizffdbjnp` (`404`); after user confirmation, `npx supabase link --project-ref tkdrxfvxryemfdrwcmay --yes` linked `supabase/.temp/project-ref` to `tkdrxfvxryemfdrwcmay`, and `npx supabase migration list --remote` cleanly reports all `10` migrations pending on `hu-accadamic assistent system · production`.
2. **WARNING — Stale `.env` and `apps/bot/.env`:** `.env` and `apps/bot/.env` still reference `mqfbqszvdwhizffdbjnp.supabase.co` instead of `tkdrxfvxryemfdrwcmay.supabase.co` (and `apps/bot/.env` has a different `TELEGRAM_WEBHOOK_SECRET` length `38` vs `64` in `.env` and `.env.local`).
3. **WARNING — Rest Root OpenAPI Check vs. Client Queries (`tkdrxfvxryemfdrwcmay`):** `.env.local` keys (`len=46` anon/publishable, `len=41` secret/service-role) succeeded with `200 OK` against Storage (`/storage/v1/bucket`) and Auth (`/auth/v1/settings`), whereas raw `GET /rest/v1/` returned `401 Unauthorized` (expected with `sb_secret_`/`sb_publishable_` or restricted PostgREST OpenAPI root; re-verify table queries via `@supabase/supabase-js` immediately after applying migrations).
4. **WATCH ITEM — `storage.objects` RLS Ownership During `db push`:** [`20261110000003_storage_setup.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261110000003_storage_setup.sql#L33-L60) runs `CREATE POLICY ... ON storage.objects` (`storage.objects` is normally owned by `supabase_storage_admin`). Confirm migration `03` completes without an `ERROR: must be owner of table objects` during push.
5. **NOTE — Bucket vs. App File-Size Cap:** Migration `03` sets `'submission-files-vault'` `file_size_limit` to `52428800` (50 MB), while Migration `10` (`chk_project_file_rules_max_size`) and bot/web validation enforce `20971520` (20 MB). These do not conflict; 20 MB remains strictly enforced by `project_file_rules` and bot upload guards.

---

## 5. Required Environment Variables Audit (No Secret Values Exposed)

| Variable | `.env.local` | `.env` | `apps/bot/.env` | Notes for Deployment |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Set (`HOST: tkdrxfvxryemfdrwcmay.supabase.co`) | Set (**STALE:** `mqfbqszvdwhizffdbjnp.supabase.co`) | Set (**STALE:** `mqfbqszvdwhizffdbjnp.supabase.co`) | Must target `https://tkdrxfvxryemfdrwcmay.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Set (`len=46`) | Set (`len=46`) | Set (`len=46`) | Verify `.env.local` key matches new project's Publishable/Anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Set (`len=41`) | Set (`len=41`) | Set (`len=41`) | Server-only (`apps/bot`, rate limiter); never expose to browser |
| `TELEGRAM_BOT_TOKEN` | Set (`len=46`) | Set (`len=46`) | Set (`len=46`) | Required on Vercel Server |
| `TELEGRAM_WEBHOOK_SECRET` | Set (`len=64`) | Set (`len=64`) | Set (`len=38` — **mismatch**) | Must match `secret_token` registered via Telegram `setWebhook` |
| `NODE_ENV` | `development` | `development` | `development` | Set automatically to `production` on Vercel Production deploys |
| `SUPABASE_STORAGE_BUCKET` | `submission-files-vault` | `submission-files-vault` | `submission-files-vault` | Template reference in `.env.example`; code uses `SYSTEM_CONSTANTS.STORAGE_BUCKET_NAME` |
| `TELEGRAM_WEBHOOK_URL` | Placeholder (`your-domain.vercel.app`) | Placeholder (`your-domain.vercel.app`) | Placeholder (`your-domain.vercel.app`) | Set to live Vercel `https://<domain>/api/bot/webhook` when configuring webhook |
| `APP_BASE_URL` | `http://localhost:3000` | `http://localhost:3000` | `http://localhost:3000` | Update to canonical Vercel HTTPS URL in production docs/settings |

*(No `apps/web/.env*` files exist locally.)*

---

## 6. Migration Deployment Execution Record (`tkdrxfvxryemfdrwcmay`)

1. ~~Confirm `tkdrxfvxryemfdrwcmay`~~ — **Completed** (`YES — CONFIRM tkdrxfvxryemfdrwcmay AS THE HU-ASMS PROJECT`).
2. ~~Link workspace to `tkdrxfvxryemfdrwcmay`~~ — **Completed** (`npx supabase link --project-ref tkdrxfvxryemfdrwcmay --yes`).
3. ~~Dry-run check (`npx supabase db push --remote --dry-run`)~~ — **Completed** (`exit=0`, `upToDate: false`, queued all `10` migrations in order).
4. **Migration Execution (`npx supabase db push --remote --yes`):** **SUCCEEDED (`exit=0`)**
   - Unconditional note: `npx supabase db push --remote` in CLI v3.1.0 agent mode prompted `HostedMutationConsentRequiredError` requiring `--yes` consent; zero `--include-all`, `--force`, or `db reset` flags were used.
   - Applied cleanly in exact chronological order:
     1. `20261110000001_initial_schema.sql` — OK
     2. `20261110000002_row_level_security.sql` — OK
     3. `20261110000003_storage_setup.sql` — OK (no `storage.objects` ownership error)
     4. `20261110000004_delivery_items_rep_policy.sql` — OK
     5. `20261110000005_security_hardening.sql` — OK
     6. `20261111000001_track_b_rep_active_profile_guard.sql` — OK
     7. `20261111000002_track_b_atomic_rpcs_and_db_parity.sql` — OK
     8. `20261111000003_track_b_function_privilege_and_default_acl_hardening.sql` — OK (inline `DO $$` 4-bucket ACL verification block passed)
     9. `20261112000001_critical_blockers_persistence_and_identity_hardening.sql` — OK
     10. `20261112000002_minimum_deployment_blocker_fixes.sql` — OK
   - CLI completion payload: `"message": "Finished supabase db push."`, `"target": {"kind": "linked", "project_ref": "tkdrxfvxryemfdrwcmay", "project_name": "hu-accadamic assistent system", "environment": "production"}`.

---

## 7. Independent Post-Deployment Verification Results

All post-push checks were strictly read-only (`0` test rows written; `0` System Owner or institutional seed rows created):

- **Applied Migration History (`npx supabase migration list --remote`):** **10 / 10 Recorded** — every version from `20261110000001` through `20261112000002` reports matching `"local"` and `"remote"` versions (`0` pending, `0` skipped).
- **Application Tables (`npx supabase inspect db table-stats --remote` & `service_role` `SELECT ... head: true`):** **26 / 26 Present (`svcErr: []`)** — all `23` core tables (`departments`, `academic_years`, `sections`, `profiles`, `representative_assignments`, `students`, `registration_requests`, `identity_change_requests`, `identity_change_history`, `courses`, `teachers`, `projects`, `project_targets`, `project_file_rules`, `groups`, `group_members`, `submissions`, `submission_files`, `submission_members`, `deliveries`, `delivery_items`, `audit_logs`, `notifications`) plus `bot_sessions`, `rate_limit_buckets`, and `student_verification_tokens` exist with `0` rows.
- **Anonymous Lockdown (`anon` read-only table & RPC probes):**
  - All `26` public tables returned HTTP **`401 Unauthorized`** under the `anon` key.
  - Direct `anon.rpc(...)` calls to `approve_student_registration`, `reject_student_registration`, and `redeem_student_verification_token` returned HTTP **`401` (`permission denied for function ...`)**.
- **Indexes (`npx supabase inspect db index-stats --remote`):** **`71` live indexes confirmed**, including `uq_pending_new_registration_hu_id`, `uq_pending_registration_request_telegram_id`, `bot_sessions_pkey`, `rate_limit_buckets_pkey`, `student_verification_tokens_pkey`, and `idx_student_verif_tokens_student`.
- **Storage Bucket (`GET /storage/v1/bucket` + `storage.from('submission-files-vault').list()`):**
  - `'submission-files-vault'` exists with `"public": false`, `"file_size_limit": 52428800`, and `allowed_mime_types`: `["application/pdf","application/zip","application/x-zip-compressed","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/msword"]`.
  - *(An existing empty private bucket `"hu-assistant"` with `"public": false` was also present and is unused by application code.)*
  - `anon` and `service_role` list calls both returned `0` items cleanly (`anonStorage.count = 0`, `svcStorage.count = 0`).
- **Catalog Inspection Boundary (`pg_dump` / Docker):** `npx supabase db dump --remote` could not run here because Docker Desktop / Podman is not installed (`docker: command not found`). Accordingly, `pg_class.relrowsecurity`, `pg_trigger`, `pg_constraint` (`chk_project_file_rules_max_size`), and `storage.objects` `pg_policies` rows were **not** directly dumped from system catalogs; their presence is established by the error-free (`exit=0`) remote execution of migrations `01`–`10`, the passing inline `DO $$` ACL assertion in `20261111000003`, live `401` `anon` rejections, and `71` live indexes.

---

## 8. Required Manual Setup (Next Stage — Not Yet Executed)

1. **Create Initial System Owner Account:**
   - In **Supabase Dashboard (`tkdrxfvxryemfdrwcmay`) → Authentication → Users**, create the initial System Owner user (`email` + strong password) and copy their Auth UUID.
   - In **Supabase SQL Editor** (running as `postgres`), insert their active profile row:
     ```sql
     INSERT INTO public.profiles (id, email, full_name, role, is_active)
     VALUES ('<AUTH_USER_UUID>', '<OWNER_EMAIL>', '<OWNER_FULL_NAME>', 'system_owner', true);
     ```
2. **Load Institutional Setup Data (Do NOT Use Demo Students from `supabase/seed.sql`):**
   - Seed real institutional records via SQL or the System Owner dashboard (`/admin/*`): `departments`, `academic_years`, `sections`, `courses`, `teachers`, `projects`, `project_targets`, `project_file_rules` (`max_file_size_bytes <= 20971520`), and `representative_assignments` (plus enrolled student roster rows with `registration_status = 'pending'`/`telegram_user_id = NULL` if using one-time `roster_claim` verification codes).
   - Do **not** execute `supabase/seed.sql` directly into production, as it contains demo accounts and `Hamza Teha` test records.
3. **Sync Local Env Files Before Any Local Smoke Checks:**
   - Update `.env` and `apps/bot/.env` from `mqfbqszvdwhizffdbjnp` to `tkdrxfvxryemfdrwcmay` with the matching keys and webhook secret (never commit `.env*`).

---

## 9. Deployment Status Summary

**Status:** **INITIAL SUPABASE MIGRATIONS COMPLETE (`10 / 10`) — AWAITING APPROVAL FOR NEXT STAGE**  
Project `tkdrxfvxryemfdrwcmay` schema, functions, indexes, and `'submission-files-vault'` private bucket are deployed cleanly. Stopped prior to System Owner creation, institutional data loading, Telegram webhook configuration, and Vercel deployment.
