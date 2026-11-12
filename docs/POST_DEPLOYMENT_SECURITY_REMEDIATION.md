# HU-ASMS — Post-Deployment Security Remediation & Review

**Target Project:** `tkdrxfvxryemfdrwcmay` (`"hu-accadamic assistent system"`, `eu-north-1`, production)  
**Date:** 2026-11-12  
**Current Stage:** **APPLIED & VERIFIED (`11 / 11` MIGRATIONS ON `tkdrxfvxryemfdrwcmay`)** *(Forward migration `20261112000003` applied cleanly after explicit user authorization; zero System Owner/data rows created, `hu-assistant` untouched, zero previous migrations modified, zero GitHub/Vercel mutations.)*

---

## Task 1 — New Forward Migration (`20261112000003_post_deployment_security_hardening.sql`)

### 1.1 Live Default ACL & Table Privilege Inspection (`tkdrxfvxryemfdrwcmay`)
Before drafting the migration, live catalog ACLs were inspected read-only:
- **`pg_default_acl` (`schema_name = 'public'`):**
  - `owner_role = 'postgres'`, `defaclobjtype = 'r'` (tables): `{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`.
    - All `26 / 26` `public` application tables are owned by `postgres`.
    - `anon` is already absent from default table privileges due to `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;` in Migration `05` ([`20261110000005_security_hardening.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261110000005_security_hardening.sql#L312)).
    - However, `authenticated` still inherited `TRUNCATE` (`D`), `REFERENCES` (`x`), and `TRIGGER` (`t`) by default on newly created tables because Migration `05` only ran `REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES` against existing tables and did not alter `DEFAULT PRIVILEGES` for `authenticated`.
  - `owner_role = 'postgres'`, `defaclobjtype = 'f'` (functions): `{postgres=X/postgres,service_role=X/postgres}` (already hardened by Migration `08`).
- **`pg_class.relacl` on `public.student_verification_tokens`:**
  - `authenticated=ardDxtm/postgres` (`INSERT`, `SELECT`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN`). `UPDATE` was already revoked in Migration `10` ([`20261112000002_minimum_deployment_blocker_fixes.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261112000002_minimum_deployment_blocker_fixes.sql#L40)), leaving `TRUNCATE`, `TRIGGER`, and `REFERENCES`.
- **`pg_policies` on `public.student_verification_tokens`:**
  - Policy `"System Owners manage student verification tokens"` (`FOR ALL`, `PERMISSIVE`) currently targets `roles = "{public}"` with `auth_is_system_owner()` instead of `TO authenticated`.
- **Grant Preservation Guarantee:**
  - Revoking **only** `TRUNCATE, TRIGGER, REFERENCES` (`Dxt`) in `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public` preserves `SELECT, INSERT, UPDATE, DELETE` (`arwd`) for `authenticated` under RLS on future tables (matching all existing standard application tables such as `students`, `groups`, `deliveries`, and `projects`), while preventing `TRUNCATE` from bypassing RLS.

### 1.2 Staged Forward Migration File
File created: [`supabase/migrations/20261112000003_post_deployment_security_hardening.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261112000003_post_deployment_security_hardening.sql)  
Existing 10 applied migrations (`20261110000001` – `20261112000002`): **Unmodified** (`git diff --name-only -- supabase/migrations/` is empty).

```sql
REVOKE TRUNCATE, TRIGGER, REFERENCES
  ON TABLE public.student_verification_tokens
  FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated;

DO $$
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin') THEN
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated',
      current_user
    );
  END IF;
END
$$;

DROP POLICY IF EXISTS "System Owners manage student verification tokens"
  ON public.student_verification_tokens;

CREATE POLICY "System Owners manage student verification tokens"
ON public.student_verification_tokens
FOR ALL
TO authenticated
USING (public.auth_is_system_owner())
WITH CHECK (public.auth_is_system_owner());

UPDATE storage.buckets
SET file_size_limit = 20971520,
    updated_at = clock_timestamp()
WHERE id = 'submission-files-vault';
```
*(The migration file also includes a `DO $$ ... END $$;` post-apply verification block asserting privileges, `{authenticated}` policy target, `public = false`, and `file_size_limit = 20971520`.)*

---

## Task 2 — Review of the Six `SECURITY DEFINER` Advisor Warnings (`0029_authenticated_security_definer_function_executable`)

All 6 live function definitions, `proconfig`, and `proacl` entries were inspected via `pg_get_functiondef(p.oid)` on `tkdrxfvxryemfdrwcmay`. **Zero concrete vulnerabilities were found**, and **no functions were altered**.

| Function | Purpose | `auth.uid()` Checked? | Active Staff / System Owner Verified? | Data Access Scope | Unauthorized Caller Exploitability & Notes |
|---|---|---|---|---|---|
| `public.auth_is_system_owner()` | RLS & service helper checking if caller is an active `system_owner`. | Yes (`WHERE id = auth.uid()`). Returns `false` if `NULL`. | Yes (`role = 'system_owner'::public.user_role AND is_active = true`). | Reads `public.profiles` strictly for `auth.uid()`; returns scalar `BOOLEAN`. | **Not exploitable.** Parameterless, `search_path = ''`, fails closed for `anon`/inactive/`representative` users. |
| `public.auth_is_rep_for_section(p_section_id uuid)` | RLS & workflow helper checking active `representative` (or `system_owner`) assignment for `p_section_id`. | Yes (`WHERE ra.profile_id = auth.uid()`). | Yes (joins `public.profiles p` requiring `p.is_active = true`, `ra.is_active = true`, and `p.role IN ('representative', 'system_owner')`). | Checks boolean existence on `(auth.uid(), p_section_id)`; returns scalar `BOOLEAN`. | **Not exploitable.** Deactivated profiles immediately return `false`; callers can only test their own `auth.uid()` assignments. |
| `public.approve_student_registration(p_request_id uuid, p_notes text)` | Atomically approves pending `new_registration`, `roster_claim`, or `account_recovery` requests, links/creates `students`, supersedes competing pending requests, and writes `identity_change_history` + `audit_logs`. | Yes (`v_actor_id := auth.uid()`). If `NULL`, explicitly requires `auth.role() = 'service_role'` OR `session_user IN ('postgres', 'supabase_admin')`. | Yes (`public.auth_is_system_owner()` required when `v_actor_id IS NOT NULL`). | Locks and updates single target `registration_requests` & matching `students` row; truncates notes to 500 chars. | **Not exploitable.** `authenticated` callers with `auth.uid() IS NULL` still fail `auth.role() <> 'service_role'`; non-owner staff/users fail `auth_is_system_owner()`. Kept `authenticated`-callable due to SSR Server Actions in `apps/web`. |
| `public.reject_student_registration(p_request_id uuid, p_reason text)` | Atomically rejects a pending `registration_requests` row with sanitized reason and writes `STUDENT_REGISTRATION_REJECTED` audit log. | Yes (same fail-closed `auth.uid()` / `service_role` guard). | Yes (`public.auth_is_system_owner()` required when `v_actor_id IS NOT NULL`). | Locks and updates single `pending` request row; writes one `audit_logs` entry. | **Not exploitable.** Inactive profiles, representatives, and non-staff `authenticated` callers are rejected. |
| `public.mark_delivery_sent_with_audit(p_delivery_id uuid, p_dispatch_notes text)` | Atomically transitions a `'prepared'` delivery batch to `'sent'`, validates `delivery_items` parity against `batch_count`, and records `TEACHER_DELIVERY_DISPATCHED`. | Yes (`v_actor_id := auth.uid()`; fail-closed unless active staff session or `service_role`/`postgres`). | Yes (queries `public.profiles` for `is_active = true` and `role IN ('representative', 'system_owner')`, then checks `auth_is_system_owner() OR auth_is_rep_for_section(v_delivery.section_id)`). | Locks only `deliveries WHERE id = p_delivery_id`; updates after section verification; derives `actor_id` and `actor_role` server-side. | **Not exploitable.** Representatives of Section A are blocked from Section B deliveries (`Forbidden: Section scope violation`). |
| `public.record_scoped_audit_log(p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb)` | Scoped portal audit writer for `GROUP_PRECREATED` (`group`) and `TEACHER_DELIVERY_*` (`delivery`) events so direct `INSERT` on `audit_logs` remains revoked. | Yes (`IF v_actor_id IS NULL THEN RAISE EXCEPTION`). `service_role` has no `EXECUTE` grant. | Yes (queries `public.profiles` requiring active profile AND enforces `auth_is_system_owner() OR auth_is_rep_for_section(v_section_id)`). | Allowlists exact action/entity pairs; resolves real `section_id` from `groups` or `deliveries`; derives `actor_id`/`actor_role` from DB/JWT. | **Not exploitable.** Non-staff/cross-section callers cannot write logs or spoof `actor_id`/`actor_role`. *(Non-critical note: `p_metadata` has no JSON size cap for already-authorized section reps.)* |

---

## Task 3 — Verification of Unexpected `hu-assistant` Bucket

- **Live Bucket Metadata (`storage.buckets` & `storage.objects`):**
  - `id` / `name`: `hu-assistant`
  - `created_at` / `updated_at`: `2026-11-12 08:47:14.964282+00` (~1 minute 58 seconds before `db push` created `submission-files-vault` at `08:49:12.029242+00`)
  - `public`: `false`
  - `file_size_limit`: `null`
  - `allowed_mime_types`: `null`
  - `object_count`: `0`
- **Repository Dependency Search:**
  - `git grep -i "hu-assistant"` returned **0 matches** across all apps, packages, migrations, docs, and env templates.
  - All storage upload/signed-URL callers ([`apps/bot/src/utils/submission-storage.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/utils/submission-storage.ts), [`apps/web/src/lib/rep/submission-file-service.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/lib/rep/submission-file-service.ts), [`apps/web/src/lib/rep/delivery-service.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/lib/rep/delivery-service.ts), [`packages/shared/src/index.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/packages/shared/src/index.ts#L8), and [`.env.example`](file:///d:/HU-ASMS%20%E2%80%94%20University/.env.example#L10)) exclusively reference `'submission-files-vault'`.
- **Conclusion:** **Zero** HU-ASMS components depend on `hu-assistant`. It remains untouched per restrictions and can be safely deleted later via the Supabase Dashboard if not created intentionally for manual testing.

---

## Task 4 — Verification Results

### 4.1 Pre-Apply Local Verification (Executed)
| Check | Command | Result | Details |
|---|---|---|---|
| **Typecheck** | `npm run typecheck` | **PASS (Exit `0`)** | All 6 workspaces (`@hu-asms/bot`, `@hu-asms/web`, `@hu-asms/database`, `@hu-asms/shared`, `@hu-asms/types`, `@hu-asms/validation`) passed cleanly. |
| **Full Test Suite** | `npm run test` | **PASS (`230 / 230`, `0` fail, `0` skipped)** | `@hu-asms/bot`: `100/100`; `@hu-asms/web`: `114/114` (including updated migration sequence test in [`track-b-privilege-and-sql-hardening.test.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/test/track-b-privilege-and-sql-hardening.test.ts)); `@hu-asms/database`: `16/16`. |
| **Applied Migration Integrity** | `git diff --name-only -- supabase/migrations/` | **PASS (`0` edits)** | Zero changes to previously applied migrations `20261110000001` – `20261112000002`. |
| **Migration Sequence List** | `npx supabase migration list --remote` | **PASS (Staged)** | Remote shows `10` applied migrations (`20261110000001`–`20261112000002`); local adds `20261112000003` (`remote: ""` pending approval). |

### 4.2 Remote Post-Apply Verification (Executed After Explicit User Authorization)
All post-apply checks were executed against live `tkdrxfvxryemfdrwcmay` using `--remote` and `--read-only`:
- [x] **`npx supabase db push --remote --yes`:** **PASS (Exit `0`)** — Applied only `20261112000003_post_deployment_security_hardening.sql` (`"Finished supabase db push."`, inline `DO $$` verification block succeeded).
- [x] **`npx supabase migration list --remote`:** **PASS (`11 / 11` Matched)** — Versions `20261110000001` through `20261112000003` match 100% between local and remote (`0` pending).
- [x] **Live `public.student_verification_tokens` Privileges & Policy (`pg_class` / `has_table_privilege` / `pg_policies`):** **PASS**
  - `relacl`: `{postgres=arwdDxtm/postgres,authenticated=ardm/postgres,service_role=arwdDxtm/postgres}`
  - `authenticated`: `SELECT = true`, `INSERT = true`, `DELETE = true`, `UPDATE = false`, `TRUNCATE = false`, `TRIGGER = false`, `REFERENCES = false`; `anon` `SELECT = false`.
  - Policy `"System Owners manage student verification tokens"`: `roles = "{authenticated}"`.
- [x] **Live Default Table ACLs (`pg_default_acl` for `owner_role = 'postgres'`, `schema = 'public'`, `defaclobjtype = 'r'`):** **PASS** — `{postgres=arwdDxtm/postgres,authenticated=arwdm/postgres,service_role=arwdDxtm/postgres}` (future `postgres`-owned tables keep `SELECT/INSERT/UPDATE/DELETE` under RLS for `authenticated` and no longer inherit `TRUNCATE/TRIGGER/REFERENCES`; `anon` stays excluded).
- [x] **Live Storage Buckets (`storage.buckets` + `storage.objects`):** **PASS**
  - `'submission-files-vault'`: `public = false`, `file_size_limit = 20971520` (20 MB), `updated_at = 2026-11-12 09:44:45.587626+00`, `object_count = 0`.
  - `'hu-assistant'`: **Untouched** (`public = false`, `file_size_limit = null`, `allowed_mime_types = null`, `updated_at = 2026-11-12 08:47:14.964282+00`, `object_count = 0`).
- [x] **`npx supabase db advisors --remote --type security`:** **PASS (`0` `ERROR`s, `6` `WARN`s)** — Only the 6 previously audited intentional `0029_authenticated_security_definer_function_executable` notices remain.
- [x] **Zero Auth / Data Creation & Migration Integrity:** `auth.users` count = `0`; `git diff --name-only -- supabase/migrations/` is empty (`0` modifications to applied migrations).
