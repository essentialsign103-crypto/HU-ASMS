# HU-ASMS — Clean Deployment Readiness Review

**Review Status:** Read-only assessment complete under active deployment freeze (`0` application source files or SQL migrations modified).  
**Target Architecture:** New GitHub repository + new Supabase project + Vercel (`apps/web`).

---

## 1. Essential Blockers

### A. Security & Data Integrity Defects Requiring Decision Before Live Rollout
1. **Unlinked Roster Account Hijacking via Guessable HU Student ID (`apps/bot`):**
   - In [`registration.service.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/registration.service.ts#L124-L168) and [`registration.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/registration.conversation.ts#L111-L158), entering any unlinked `students` ID returns `status: 'unlinked_roster_record'` with masked name plus exact department, year, and section, and allows **any Telegram user** clicking **Confirm & Bind Account** to permanently lock (`registration_status = 'locked'`, `is_locked = true`) that student record to their Telegram ID without OTP, verification token, or admin approval.
   - `linked_to_another_user` ([`registration.service.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/registration.service.ts#L113-L122)) also returns `maskedName` and `departmentName` for submitted IDs.
2. **Submission Files Never Downloaded from Telegram or Uploaded to Storage in Live Bot Flows (`apps/bot`):**
   - [`submission.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/submission.conversation.ts#L143-L154) and [`group-submission.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/group-submission.conversation.ts#L243-L255) pass `telegramFileId: doc.file_id` **without `file.buffer`**. There are **`0`** calls to Telegram's `getFile` / file download API anywhere in `apps/` or `packages/`.
   - Because [`IndividualSubmissionService`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/submission.service.ts#L211-L240) and [`GroupSubmissionService`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/group-submission.service.ts#L253-L282) guard storage upload with `if (input.file.buffer)`, live bot submissions skip uploading to `'submission-files-vault'` while still writing `submission_files.storage_path`. Subsequent representative downloads and delivery manifests calling `createSignedUrl(...)` will fail with storage object not found.
3. **In-Memory GrammY Sessions & Conversations Fail on Stateless Vercel Serverless Functions (`apps/bot` + `apps/web`):**
   - [`/api/bot/webhook`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/api/bot/webhook/route.ts#L1-L11) handles Telegram updates via [`createBot`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/bot.ts#L64-L75), which uses grammY's default **in-memory** `session()` and `@grammyjs/conversations` state. Multi-turn flows (`/start`, `/correction`, `/submit`, `/submit_group`) lose state between serverless invocations or cold starts unless backed by external persistent storage (e.g., Supabase/Postgres session adapter) or hosted as a persistent Node process ([`apps/bot/src/index.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/index.ts)).
4. **Pending Track B Security Migrations Must Be Applied Together on Clean Supabase:**
   - Migrations `20261111000001`, `20261111000002`, and `20261111000003` close critical gaps (deactivated representative RLS bypass, `anon` function privileges, `authenticated` execute access on `admin_set_profile_status`, and forged rep group verification/delivery item attachment) AND provide RPCs (`approve_student_registration`, `reject_student_registration`, `mark_delivery_sent_with_audit`) that production web code already requires to function.

### B. Startup & Operational Blockers on Clean Infrastructure
1. **Uncommitted Local Workspace & Branch Divergence:** Current HEAD `6e2c5f8` on `phase-14-security-hardening` is ahead of `main` (`5f97946`) and has **`61`** uncommitted working-tree entries (including [`apps/web/vercel.json`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/vercel.json), deleted root `vercel.json`, hardened `/admin` & `/rep` guards, and `20261111000001`–`03`). Pushing `main` or partial files will fail builds and deploy stale code.
2. **No System Owner Auth/Profile Bootstrap Mechanism:** `supabase/seed.sql` inserts **zero** `auth.users` or `profiles` rows, and [`/login`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/(auth)/login/page.tsx) does not auto-create profiles. `SYSTEM_OWNER_EMAIL` and `SYSTEM_OWNER_TELEGRAM_ID` in [`.env.example`](file:///d:/HU-ASMS%20%E2%80%94%20University/.env.example) are unread by any code. On a clean DB, an administrator must manually create a Supabase Auth user and insert its `public.profiles` row (`role = 'system_owner'`, `is_active = true`) via privileged SQL/`service_role`.
3. **Read-Only `/admin` Setup UI:** Across all of `apps/web/src/app`, `'use server'` actions exist **only** in [`admin/students/page.tsx`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/admin/students/page.tsx) (approve/reject) and `rep/{deliveries,groups,submissions}/actions.ts`. `/admin/structure`, `/admin/academics`, `/admin/academics/projects`, `/admin/representatives`, and `/admin/audit-logs` are read-only displays. Initial departments, academic years, sections, teachers, courses, projects, targets, file rules, and representative assignments must be inserted via SQL or admin scripts (or future UI actions).
4. **Demo Seed Data Risk (`supabase/seed.sql`):** [`seed.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/seed.sql) inserts sample students (including unlinked records like `'1341/17'` and `'HU/10295/14'`) and teachers/projects. Do **not** run `seed.sql` unchanged in production, especially while unlinked roster auto-claim remains active.
5. **Vercel Monorepo Root Directory & Telegram `setWebhook`:** Vercel Project Root Directory **must** be `apps/web` for [`apps/web/vercel.json`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/vercel.json) (`cd ../..`). After deploying, Telegram `setWebhook` must be registered manually with `secret_token` matching `TELEGRAM_WEBHOOK_SECRET`.

---

## 2. Classification of the 3 Pending Track B Migrations

| Migration | Change Item | Classification | Rationale |
|---|---|---|---|
| **`20261111000001`** | [`auth_is_rep_for_section(UUID)`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261111000001_track_b_rep_active_profile_guard.sql#L5-L23) active `profiles.is_active = true` & role join | **ESSENTIAL BEFORE FIRST DEPLOYMENT** | Prevents deactivated/demoted reps from retaining full RLS access to section students, submissions, groups, files, and deliveries. |
| **`20261111000001`** | [`auth_get_assigned_section_ids()`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261111000001_track_b_rep_active_profile_guard.sql#L25-L47) active profile update + full role `REVOKE` | **OPTIONAL / CAN BE DEFERRED** | Helper has `0` SQL/TS callers (`000003` expects it to exist and remain revoked from `authenticated`). |
| **`20261111000002`** | [`approve_student_registration`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql#L29-L159), [`reject_student_registration`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql#L161-L251), [`mark_delivery_sent_with_audit`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql#L257-L379) | **ESSENTIAL BEFORE FIRST DEPLOYMENT** | Current `/admin/students` and `/rep/deliveries` Server Actions call these RPCs and **fail closed** in production without them; ensures atomic transactions & role checks. |
| **`20261111000002`** | Tightened RLS on [`groups`, `group_members`, `delivery_items`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql#L921-L976) | **ESSENTIAL BEFORE FIRST DEPLOYMENT** | Blocks authenticated reps via PostgREST from forging `confirmed` memberships, self-verifying groups, or attaching foreign-section/inactive submissions to deliveries. |
| **`20261111000002`** | Partial unique indexes [`uq_pending_registration_request_*`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql#L17-L23) | **REQUIRED BEFORE PRODUCTION** | Prevents race-condition duplicate pending `/start` registrations for the same HU ID or Telegram ID. |
| **`20261111000002`** | Integrity triggers + helper ([`is_project_targeted_to_section`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql#L385-L408), `enforce_group_integrity`, `enforce_group_member_integrity`, `enforce_group_member_size_bounds`, `check_and_update_group_verification`, `enforce_delivery_integrity`, `enforce_delivery_item_integrity`) | **REQUIRED BEFORE PRODUCTION** | Enforces state-machine transitions (blocks `sent -> prepared`), batch-count/section/project parity, and min/max member bounds DB-side (`000003` expects all 6 triggers when applied). |
| **`20261111000003`** | [`REVOKE ALL ... FROM PUBLIC, anon`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261111000003_track_b_function_privilege_and_default_acl_hardening.sql#L27-L72) across all 18 functions + revoking `authenticated` from [`admin_set_profile_status`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261111000003_track_b_function_privilege_and_default_acl_hardening.sql#L43-L44) & all 9 triggers | **ESSENTIAL BEFORE FIRST DEPLOYMENT** | Closes `anon` RPC surface and strips `authenticated` `EXECUTE` from `SECURITY DEFINER` privilege-mutation helper `admin_set_profile_status`. |
| **`20261111000003`** | [`record_scoped_audit_log`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261111000003_track_b_function_privilege_and_default_acl_hardening.sql#L49-L50) (`authenticated`-only), [`ALTER DEFAULT PRIVILEGES ... FUNCTIONS`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261111000003_track_b_function_privilege_and_default_acl_hardening.sql#L80-L97), and 4-bucket `DO $$` verification (`L103-190`) | **REQUIRED BEFORE PRODUCTION** | Prevents future SQL functions from inheriting implicit `PUBLIC`/`anon`/`authenticated` `EXECUTE`; validates exact least-privilege grants at push time. |

---

## 3. Non-Essential Improvements to Defer

- **Refining `02` / `05` / PostgREST Surface & SSR Coupling:**
  - Moving [`approve_student_registration`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql#L29) and `reject_student_registration` calls in `admin/students/page.tsx` to `service_role` (after `assertSystemOwner`) so `authenticated` `EXECUTE` can be revoked (both already fail closed internally via `auth_is_system_owner()`).
  - Relocating `auth_is_system_owner`, `auth_is_rep_for_section`, and `is_project_targeted_to_section` into a non-exposed `private` schema.
  - Tightening `TO authenticated USING (true)` `SELECT` RLS on `teachers` (contains teacher `email`/`phone`/`telegram_user_id`), `courses`, `projects`, `departments`, `academic_years`, and `sections` to require active staff profiles (`is_active = true`).
  - Adding audit logging + self-demotion protection to `admin_set_profile_status` (already `service_role`-only via `000003`) and strict schema/size checks on `p_metadata` in `record_scoped_audit_log`.
- **Minor Bug & Infrastructure Cleanups:**
  - Checking student authorization in [`handleProjectDetailsCallback`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/handlers/student.project.handler.ts#L56-L98) before querying via `service_role`.
  - Fixing [`NotificationService`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/notification.service.ts#L67-L90) marking `notifications.status = 'sent'` before `botSender` runs and incrementing `dispatchedCount` on failure.
  - Replacing per-instance [`MemoryRateLimiter`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/lib/security/rate-limiter.ts) and bot rate-limit map with Redis/Upstash for multi-instance Serverless enforcement.
  - Adding an actual ESLint configuration (currently all workspace `lint` scripts run `tsc --noEmit`).

---

## 4. Complete Migration Sequence

All **`8`** migration files in [`supabase/migrations/`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations) must be applied in strict chronological order on a clean Supabase PostgreSQL database (`0` duplicate timestamps or conflicting versions):

1. `20261110000001_initial_schema.sql` — Enums, `update_timestamp_column()`, 23 core tables, initial triggers.
2. `20261110000002_row_level_security.sql` — Initial RLS enablement on all 23 tables, helper functions, initial policies.
3. `20261110000003_storage_setup.sql` — Private bucket `'submission-files-vault'` + `storage.objects` policies (depends on `02` helpers).
4. `20261110000004_delivery_items_rep_policy.sql` — Initial representative management policy on `delivery_items` (depends on `01`, `02`).
5. `20261110000005_security_hardening.sql` — `SET search_path = ''` function updates, `protect_profile_privileged_columns`, `admin_set_profile_status`, `record_scoped_audit_log`, table/column revocations (supersedes `02` helpers/profile policy).
6. `20261111000001_track_b_rep_active_profile_guard.sql` — Adds `p.is_active = true` & role check to `auth_is_rep_for_section` and revokes `auth_get_assigned_section_ids` (depends on `01`, `05`).
7. `20261111000002_track_b_atomic_rpcs_and_db_parity.sql` — Pending-request partial unique indexes, 3 atomic RPCs, 6 trigger functions (`check_and_update_group_verification` supersedes `01`/`05`; batch `group_members` inserts match deferrable `enforce_group_member_size_bounds`), `is_project_targeted_to_section`, and tightened `groups`/`group_members`/`delivery_items` RLS policies (depends on `01`–`05`, `000001`).
8. `20261111000003_track_b_function_privilege_and_default_acl_hardening.sql` — Explicit 4-bucket `REVOKE`/`GRANT` across all 18 public functions, `ALTER DEFAULT PRIVILEGES FOR ROLE postgres ... FUNCTIONS` (+ guarded `current_user`/`supabase_admin` blocks), and `DO $$` verification block requiring all 18 functions from `01`–`000002`.

**Compatibility Notes:** No `supabase/config.toml` exists in the repository. Migration execution assumes standard Supabase CLI / Dashboard `postgres` privileges (`cli_login_postgres` as member of `postgres`). `0` edits were made to applied `01`–`05`.

---

## 5. Required Environment Variables

| Variable | Referenced In Runtime? | Required For Vercel Web App (`apps/web` + webhook) | Purpose & Drift Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes (`middleware.ts`, `server.ts`, `client.ts`, `packages/database/src/client.ts`) | **Yes** | Public Supabase Project URL (`packages/database` also checks `SUPABASE_URL` fallback). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes (`middleware.ts`, `server.ts`, `client.ts`, `packages/database/src/client.ts`) | **Yes** | Public Supabase anon/publishable key (`packages/database` also checks `SUPABASE_ANON_KEY` fallback). |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (`packages/database/src/client.ts`) | **Yes** | Privileged server-only key used by `apps/bot` and admin services. Keep secret (`NEXT_PUBLIC_` must never be used). |
| `TELEGRAM_BOT_TOKEN` | Yes (`apps/bot/src/bot.ts`, `apps/bot/src/index.ts`, `apps/bot/src/webhook.ts`) | **Yes** | Bot API token from `@BotFather`. Needed by `/api/bot/webhook` (and by Telegram `getFile` once implemented). |
| `TELEGRAM_WEBHOOK_SECRET` | Yes (`apps/bot/src/webhook.ts`, `apps/bot/src/index.ts`) | **Yes** | Random secret verified against `X-Telegram-Bot-Api-Secret-Token` (returns HTTP `500` if missing). |
| `NODE_ENV` | Yes (`delivery-service.ts`, `student-approval-service.ts`, `apps/bot/src/webhook.ts`, `index.ts`) | Managed automatically (`production` on Vercel) | Controls fail-closed RPC behavior and webhook logging/status exposure. |
| `PORT` | Yes (`apps/bot/src/index.ts` only; defaults `3001`) | Optional (standalone bot only) | Not documented in `.env.example`; unused on Vercel. |
| `TELEGRAM_WEBHOOK_URL` | Standalone `apps/bot/src/index.ts` startup check only | Optional (standalone webhook startup) | Unused by Vercel Next.js `/api/bot/webhook` route. |
| `SUPABASE_STORAGE_BUCKET` | **No** (`.env.example` only) | No effect today | **Drift:** `'submission-files-vault'` is hardcoded in migration `03`, `submission-file-service.ts`, `delivery-service.ts`, `submission.service.ts`, and `group-submission.service.ts`. |
| `SYSTEM_OWNER_EMAIL`, `SYSTEM_OWNER_TELEGRAM_ID`, `APP_BASE_URL` | **No** (`.env.example` only) | Documentation/ops reference only | Not read anywhere in `apps/` or `packages/`. |

---

## 6. Readiness Checklists

### GitHub Readiness — **NOT READY AS-IS**
- Consolidate [`phase-14-security-hardening`](file:///d:/HU-ASMS%20%E2%80%94%20University) (`6e2c5f8`) and the **`61`** local working-tree changes cleanly into the branch pushed to the new GitHub repository (removing or keeping root [`phase_14_security_remediation_report.md`](file:///d:/HU-ASMS%20%E2%80%94%20University/phase_14_security_remediation_report.md) intentionally; never commit `.env`, `.env.local`, or `supabase/.temp`).
- Verify [`.gitignore`](file:///d:/HU-ASMS%20%E2%80%94%20University/.gitignore) covers `.env`, `.env.local`, `supabase/.temp`, `node_modules`, and `.next` (already present).

### Supabase Readiness — **READY AFTER RE-LINK & OWNER BOOTSTRAP**
- Create a fresh Supabase project and re-link locally (`supabase link --project-ref <new-ref>`; [`supabase/.temp/`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/.temp) currently points to the old project).
- Apply all **8** migrations (`20261110000001`–`05` + `20261111000001`–`03`) via `supabase db push` (note no `supabase/config.toml` exists).
- Manually bootstrap the initial **System Owner** user in Supabase Auth + insert its `public.profiles` row (`role = 'system_owner'`, `is_active = true`), and prepare clean non-demo institutional setup SQL (do not blindly apply sample students in `supabase/seed.sql`).

### Vercel Readiness — **BLOCKED FOR LIVE BOT UNTIL DEFECTS #1–#3 ADDRESSED**
- Root build config is aligned: root `vercel.json` removed, [`apps/web/vercel.json`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/vercel.json) present, and [`apps/web/next.config.mjs`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/next.config.mjs) sets `outputFileTracingRoot` and `transpilePackages`.
- In Vercel Project Settings: set **Root Directory = `apps/web`**, configure all 5 required runtime env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`), and deploy.
- After deployment, call Telegram `setWebhook` targeting `https://<domain>/api/bot/webhook` with `secret_token`.
- **Important:** Web portal (`Next.js`) builds cleanly (`21/21` routes), **but** the bundled Telegram webhook (`/api/bot/webhook`) will fail multi-turn bot conversations under Vercel serverless (`MemorySessionStorage`) and will not persist uploaded files to Storage until blockers #1 and #2 in Section 1A are fixed.

---

## 7. Honest Verification Status

Fresh read-only verification executed after all workspace reviews:
- `npm run typecheck`: **Passed** (all 6 workspaces exited `0`).
- `npm run lint --workspaces`: **Passed** (all 6 workspaces exited `0`; runs `tsc --noEmit` only — ESLint is not configured).
- `npm test`: **Passed (`213/213` tests, `64` suites, `0` failures, `0` skipped)** — `@hu-asms/bot` (`88/88`, `27` suites), `@hu-asms/web` (`110/110`, `27` suites), `@hu-asms/database` (`15/15`, `10` suites); `@hu-asms/shared`/`types`/`validation` run `node --version` placeholders. All bot/web/DB tests use **mocked clients and static file assertions**.
- `npm run build`: **Passed** (`Next.js 15.5.29` compiled in `6.9s`, `21/21` routes + middleware built).
- **Not Tested:** **Zero** live PostgreSQL migration pushes, **zero** real Supabase Auth/RLS/Storage integration tests, **zero** live Telegram Bot API / webhook round-trips, and **zero** Vercel runtime deployment tests were run.

---

## 8. Final Deployment Recommendation

**Recommendation: HOLD — Do Not Push Live Until Critical Security & Functional Blockers Are Resolved (Web + Clean DB Schema Are Ready Once Committed & Bootstrapped, Live Telegram Bot Workflows Are Not).**

Specifically, before making the new clean deployment live for students and representatives, request and approve targeted fixes for the **3 critical defects** discovered during this review:
1. **Disable or gate `unlinked_roster_record` self-binding** in `registration.service.ts` / `registration.conversation.ts` (require administrator approval or a single-use verification token before locking a pre-seeded/roster student record to a Telegram ID).
2. **Download uploaded Telegram document bytes (`getFile`) and pass `buffer` to Supabase Storage** in `submission.conversation.ts` and `group-submission.conversation.ts` (failing closed if upload/download fails rather than creating dangling `submission_files` rows).
3. **Resolve Vercel serverless grammY conversation/session persistence** (either store grammY sessions/conversations in Postgres/Supabase or deploy `apps/bot` as a dedicated persistent Node service while keeping `apps/web` on Vercel).
4. Once approved and verified, stage and commit the clean consolidated branch to the new GitHub repository, push all **8** migrations (`01`–`05` + `000001`–`03`) to the new Supabase project, bootstrap the System Owner `auth.users` + `profiles` record + institutional data, deploy `apps/web` on Vercel (`Root Directory = apps/web`), register the Telegram webhook, and execute end-to-end live smoke tests (`/start`, `/submit`, `/submit_group`, `/admin/students`, `/rep/submissions`, `/rep/deliveries`).
