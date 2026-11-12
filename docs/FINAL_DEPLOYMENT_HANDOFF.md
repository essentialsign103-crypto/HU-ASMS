# HU-ASMS — Final Deployment Handoff

**Handoff Status:** **READY FOR GITHUB CONSOLIDATION (Deployment Freeze Active)**  
**Target Stack:** Clean GitHub Repository → Clean Supabase Project → Vercel (`apps/web` + `/api/bot/webhook`)  
**Freeze Compliance:** Zero Git commits/pushes, zero remote Supabase migrations/writes, zero Vercel deployments, and zero modifications to frozen migrations (`20261110000001`–`05`, `20261111000001`–`03`, and `20261112000001`) were performed.

---

## 1. Minimum Deployment Blocker Fixes Completed

### 1.1 Telegram Cloud Bot API 20 MB Download Limit
- **Shared Constant & Helper:** Added `SYSTEM_CONSTANTS.TELEGRAM_BOT_API_MAX_DOWNLOAD_BYTES` (`20 * 1024 * 1024` / `20,971,520` bytes) and `resolveEffectiveTelegramMaxFileSizeBytes()` in [`packages/shared/src/index.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/packages/shared/src/index.ts#L6-L24).
- **Pre-`getFile()` Bot Enforcement & Clear Student Messaging:**
  - Replaced the `50 MB` `vaultHardLimit` in [`downloadTelegramDocument`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/utils/telegram-file.ts#L69-L90) with the actual **20 MB** Cloud Bot API download limit (`TELEGRAM_BOT_API_MAX_DOWNLOAD_BYTES`), rejecting `declaredSizeBytes > maxSizeBytes` **before** `api.getFile()` is ever called.
  - Updated [`validateSubmissionFile`](file:///d:/HU-ASMS%20%E2%80%94%20University/packages/validation/src/index.ts#L121-L135), [`submission.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/submission.conversation.ts#L117-L169), [`group-submission.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/group-submission.conversation.ts#L210-L269), [`IndividualSubmissionService`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/submission.service.ts#L162), [`GroupSubmissionService`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/group-submission.service.ts#L204), [`handleProjectDetailsCallback`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/handlers/student.project.handler.ts#L74-L76), and [`admin/academics/projects/page.tsx`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/admin/academics/projects/page.tsx#L96) to display and enforce the 20 MB ceiling with explicit guidance for students (`20.0 MB` Telegram download limit).
- **Project Configuration & Database Enforcement:**
  - Updated [`AcademicManagementService.createProject`](file:///d:/HU-ASMS%20%E2%80%94%20University/packages/database/src/academic-management.ts#L257-L267) to reject `max_file_size_bytes <= 0` or `> 20,971,520` bytes.
  - Added database constraint `chk_project_file_rules_max_size` (`CHECK (max_file_size_bytes > 0 AND max_file_size_bytes <= 20971520)`) in forward migration [`20261112000002_minimum_deployment_blocker_fixes.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261112000002_minimum_deployment_blocker_fixes.sql#L13-L21) and aligned [`supabase/seed.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/seed.sql#L128) to `20971520`.
- **Architectural Boundary Note (`> 20 MB` Uploads):** Supporting files larger than 20 MB would require either self-hosting Telegram's `telegram-bot-api --local` server or adding direct browser pre-signed uploads to `'submission-files-vault'`. Both exceed the minimum-blocker architecture and remain intentionally excluded. On Vercel + Cloud Telegram Bot API, the system is safely capped at **20 MB**.

### 1.2 Student Verification UI, Normalization, Lockout & Recovery Unblocking
- **System Owner UI & Rate-Limited Server Action (`/admin/students`):**
  - Created Server Actions in [`apps/web/src/app/admin/students/actions.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/admin/students/actions.ts) (`approveRegistration`, `rejectRegistration`, and `issueStudentVerificationTokenAction` backed by `assertDistributedRateLimit` + active `system_owner` authorization).
  - Created Client UI [`apps/web/src/app/admin/students/token-issuer.tsx`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/admin/students/token-issuer.tsx) allowing System Owners to issue one-time `roster_claim` or `account_recovery` codes (by HU Student ID or directly from each non-suspended enrolled student row) and display the plaintext token once with copy support.
  - Added [`executeIssueStudentVerificationTokenForHuId`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/lib/admin/student-approval-service.ts#L483-L529) for issuing tokens beyond the first 50 displayed roster rows.
- **Target Student Side-by-Side Comparison on Recovery/Claim Requests:**
  - Added [`resolveTargetStudentForRequest`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/lib/admin/student-approval-service.ts#L50-L68) and updated [`apps/web/src/app/admin/students/page.tsx`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/admin/students/page.tsx) to resolve and render the existing enrolled target student record (`full_name`, `hu_student_id`, enrolled scope, `registration_status`, and currently bound Telegram `@username` / ID) alongside every pending `account_recovery` and `roster_claim` request, flagging applicant name mismatches.
- **Lowercase Code Normalization:**
  - Updated [`hashVerificationToken`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/registration.service.ts#L54-L56) to normalize `rawToken.trim().toUpperCase()` before SHA-256 hashing so lowercase user inputs match uppercase System Owner codes.
- **Per-Student Failed-Attempt Lockout & Auditing:**
  - Updated [`redeem_student_verification_token`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261112000002_minimum_deployment_blocker_fixes.sql#L42-L270) in Postgres and [`redeemVerificationToken`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/registration.service.ts#L225-L335) in the bot service to enforce a **5-failure / 15-minute** sliding-window lockout per student / HU ID (`rate_limit_buckets`), atomically commit `STUDENT_VERIFICATION_FAILED` and `STUDENT_VERIFICATION_LOCKED` events to `public.audit_logs` (without logging raw tokens or leaking PII), and reset the counter upon valid redemption.
- **Preventing Unauthorized Pending Recovery Requests from Blocking Legitimate Owners:**
  - Forward migration `20261112000002` replaces `uq_pending_registration_request_hu_id` with `uq_pending_new_registration_hu_id` (uniqueness scoped strictly to `request_type = 'new_registration'`), preserves `uq_pending_registration_request_telegram_id` (preventing per-Telegram queue flooding), and updates both `redeem_student_verification_token` and `approve_student_registration` to mark competing pending claim/recovery requests as `'rejected'` (`Superseded...`) when legitimate ownership is verified.
  - Removed the blocking `pendingHuReq` pre-check in [`submitVerifiedClaimOrRecoveryRequest`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/registration.service.ts#L337-L403).

### 1.3 Bot Session Safety & Private-Chat Enforcement
- **Per-User Session Key Isolation:** Exported and wired [`resolveBotSessionKey`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/bot.ts#L47-L57) into grammY `session()` (`ctx.chat.id === ctx.from.id ? String(userId) : "${chatId}:${userId}"`), ensuring two students in a shared Telegram group chat never share or overwrite session/conversation state while keeping private DM session keys intact.
- **Private-Chat Guard on Sensitive Flows:** Created [`requirePrivateChat`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/utils/chat-guard.ts) and enforced it on `/start`, `/profile`, `/correction`, `/submit`, `/submit_group`, quick-action submission buttons, and inside all four conversations ([`registration.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/registration.conversation.ts), [`correction.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/correction.conversation.ts), [`submission.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/submission.conversation.ts), [`group-submission.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/group-submission.conversation.ts)).

### 1.4 Database Permission Parity (Forward Migration Only)
- In [`20261112000002_minimum_deployment_blocker_fixes.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261112000002_minimum_deployment_blocker_fixes.sql#L36-L37):
  - `REVOKE UPDATE ON TABLE public.student_verification_tokens FROM authenticated;` (issued token hashes are append-only for authenticated System Owners; only `service_role` updates `used_at`/`used_by_telegram_id` during atomic redemption).
  - `REVOKE ALL ON FUNCTION public.audit_student_verification_token_issue() FROM PUBLIC, anon, authenticated, service_role;` (aligns trigger-function ACL with `20261111000003`).

---

## 2. Files Added or Updated in This Final Remediation Round

- **Forward Migration & Seed Alignment:**
  - `supabase/migrations/20261112000002_minimum_deployment_blocker_fixes.sql` *(New)*
  - `supabase/seed.sql` *(Updated demo rule from `52428800` to `20971520`)*
- **Shared, Validation & Database Packages:**
  - `packages/shared/src/index.ts`
  - `packages/validation/src/index.ts`
  - `packages/database/src/academic-management.ts`
  - `packages/database/test/academic-management.test.ts`
- **Telegram Bot (`@hu-asms/bot`):**
  - `apps/bot/src/utils/chat-guard.ts` *(New)*
  - `apps/bot/src/bot.ts`
  - `apps/bot/src/commands/start.ts`
  - `apps/bot/src/commands/correction.ts`
  - `apps/bot/src/commands/profile.ts`
  - `apps/bot/src/conversations/registration.conversation.ts`
  - `apps/bot/src/conversations/correction.conversation.ts`
  - `apps/bot/src/conversations/submission.conversation.ts`
  - `apps/bot/src/conversations/group-submission.conversation.ts`
  - `apps/bot/src/handlers/student.project.handler.ts`
  - `apps/bot/src/services/registration.service.ts`
  - `apps/bot/src/services/submission.service.ts`
  - `apps/bot/src/services/group-submission.service.ts`
  - `apps/bot/src/utils/telegram-file.ts`
  - `apps/bot/test/critical-blockers.test.ts`
- **Web Dashboard (`@hu-asms/web`):**
  - `apps/web/src/lib/admin/student-approval-service.ts`
  - `apps/web/src/app/admin/students/actions.ts` *(New)*
  - `apps/web/src/app/admin/students/token-issuer.tsx` *(New)*
  - `apps/web/src/app/admin/students/page.tsx`
  - `apps/web/src/app/admin/academics/projects/page.tsx`
  - `apps/web/test/critical-blockers-web.test.ts`
  - `apps/web/test/track-b-privilege-and-sql-hardening.test.ts`
- **Documentation:**
  - `docs/FINAL_DEPLOYMENT_HANDOFF.md` *(This file)*

---

## 3. Complete Migration Sequence (10 Ordered Files)

Apply cleanly in order from `supabase/migrations/` (zero prior migrations were edited):
1. `20261110000001_initial_schema.sql` — Core 23 tables, enums, indexes, and initial functions.
2. `20261110000002_row_level_security.sql` — Baseline RLS helper functions and table policies.
3. `20261110000003_storage_setup.sql` — Private `'submission-files-vault'` bucket and storage RLS policies.
4. `20261110000004_delivery_items_rep_policy.sql` — Representative delivery items insert policy.
5. `20261110000005_security_hardening.sql` — Hardened `search_path`, `auth_is_system_owner()`, `record_scoped_audit_log`, and base grants.
6. `20261111000001_track_b_rep_active_profile_guard.sql` — Active-profile enforcement in `auth_is_rep_for_section`.
7. `20261111000002_track_b_atomic_rpcs_and_db_parity.sql` — Atomic approval/rejection/delivery RPCs, triggers, and parity RLS.
8. `20261111000003_track_b_function_privilege_and_default_acl_hardening.sql` — Least-privilege 4-bucket `REVOKE`/`GRANT` across 18 functions + `ALTER DEFAULT PRIVILEGES`.
9. `20261112000001_critical_blockers_persistence_and_identity_hardening.sql` — `bot_sessions`, `rate_limit_buckets`, `check_and_increment_rate_limit`, `student_verification_tokens`, `redeem_student_verification_token`, and claim/recovery approval support.
10. `20261112000002_minimum_deployment_blocker_fixes.sql` *(New)* — 20 MB `project_file_rules` `CHECK` constraint, `new_registration`-scoped pending HU ID index (`uq_pending_new_registration_hu_id`), token/trigger privilege hardening, per-student failed-attempt lockout + audit logging, and automatic closure of competing pending claim/recovery rows on verified approval/redemption.

---

## 4. Automated Verification Results (Observed After Final Edit)

| Check Command | Status | Exact Observed Output |
|---|---|---|
| `npm run typecheck` | **PASS** | `tsc --noEmit` exited `0` across all 6 workspaces (`@hu-asms/bot`, `@hu-asms/web`, `@hu-asms/database`, `@hu-asms/shared`, `@hu-asms/types`, `@hu-asms/validation`). |
| `npm test` | **PASS (`230 / 230`)** | `69` suites, `0` failed, `0` skipped: `@hu-asms/bot` **100/100** (`30` suites), `@hu-asms/web` **114/114** (`29` suites), `@hu-asms/database` **16/16** (`10` suites); `@hu-asms/shared`, `@hu-asms/types`, `@hu-asms/validation` run `node --version`. |
| `npm run test:coverage` | **PASS (`230 / 230`)** | Overall coverage: **`77.08%`** lines, **`74.09%`** branches, **`76.72%`** functions (`chat-guard.ts` `100%`, `submission.service.ts` `97.88%`, `group-submission.service.ts` `97.58%`, `student-approval-service.ts` `92.99%`, `registration.service.ts` `86.42%`, `telegram-file.ts` `80.79%`). |
| `npm run build` | **PASS** | Full 6-workspace build exited `0`. `Next.js 15.5.29` compiled in `5.7s` producing all **`21/21`** routes (`/admin/students`, `/api/bot/webhook`, `/rep/*`, etc.) + `95 kB` middleware. |
| `git diff --check` & freeze check | **PASS** | Exit `0` (zero whitespace/conflict errors); `0` modifications to frozen migrations (`20261110000001`–`05`, `20261111000001`–`03`, `20261112000001`). |

> **Mocked vs. Live Boundary:** All `230` automated tests use mocked Supabase clients, stubbed Telegram/HTTP APIs, and static SQL contract assertions. **Zero** tests ran against live PostgreSQL, live Supabase Auth/RLS/Storage, live Telegram Bot API, or live Vercel serverless infrastructure.

---

## 5. Remaining Live Integration Smoke Tests (Execute Immediately After Deploying)

1. **Database Migrations & Privilege Smoke Check:**
   - Verify all 10 migrations (`20261110000001` through `20261112000002`) apply cleanly on the new Supabase project.
   - Verify `anon` / `authenticated` cannot read/write `public.bot_sessions` or `public.rate_limit_buckets`, `authenticated` cannot `UPDATE` `public.student_verification_tokens`, and only `service_role` can call `check_and_increment_rate_limit` and `redeem_student_verification_token`.
2. **System Owner Bootstrap & Token Issuance UI (`/admin/students`):**
   - Sign in as bootstrapped System Owner, issue a single-use `roster_claim` token for a test unlinked student, confirm it displays once, redeem it in lowercase via `/start` in a private Telegram DM, and verify DB binding + `STUDENT_TOKEN_CLAIM_VERIFIED` audit log.
   - Confirm 5 invalid token attempts trigger lockout (`STUDENT_VERIFICATION_FAILED` / `STUDENT_VERIFICATION_LOCKED`) on the 6th attempt.
   - Submit an unauthorized `account_recovery` request from User A, verify User B (legitimate owner) can still queue an `account_recovery` request, verify side-by-side target student comparison renders in `/admin/students`, and verify approving User B closes User A's request.
3. **20 MB Limit, Real Telegram Upload & Vault Rollback (`/submit`, `/submit_group`, `/rep/submissions`):**
   - Attempt sending a `> 20 MB` attachment in `/submit` — verify clear 20 MB rejection without invoking `getFile` or creating DB/Storage entries.
   - Submit a valid `.pdf` and `.docx` — verify upload to private `'submission-files-vault'`, `checksum_sha256`, and working 15-minute signed download URLs in `/rep/submissions`.
   - Submit an `.exe` / `<!doctype html>` renamed to `.pdf` — verify content rejection.
4. **Group-Chat Guard & Vercel Multi-Request Session Persistence:**
   - Invoke `/start`, `/submit`, `/correction`, `/profile` in a test Telegram group chat — verify immediate private-chat rejection and no shared session state.
   - Complete a multi-step `/start` or `/submit` flow in private DM across separate webhook HTTP calls and verify persistence in `public.bot_sessions` + distributed rate-limit enforcement in `public.rate_limit_buckets`.

---

## 6. Required Environment Variables

Configure these values securely in **Vercel Project Settings** (Production & Preview as appropriate) and never commit real credentials to Git:

| Variable | Required On | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel + Supabase Client | New Supabase project URL (`https://<ref>.supabase.co`). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel (`apps/web`) | Public anon key for SSR/browser Supabase Auth sessions. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel Server Only | Server-side privileged key used strictly by `@hu-asms/bot` webhook (`bot_sessions`, `rate_limit_buckets`, `redeem_student_verification_token`, Vault uploads) and server rate limiter. **Never expose to browser.** |
| `TELEGRAM_BOT_TOKEN` | Vercel Server Only | Bot token from `@BotFather` for `api.getFile`, file download, and replies. |
| `TELEGRAM_WEBHOOK_SECRET` | Vercel Server Only | High-entropy random secret checked against `X-Telegram-Bot-Api-Secret-Token` on `POST /api/bot/webhook`. |
| `NODE_ENV` | Vercel (`production`) | Set automatically by Vercel on production builds; enforces fail-closed persistent Supabase storage and distributed rate limiting. |
| `SUPABASE_URL` *(optional)* | Vercel Server | Fallback alias if `NEXT_PUBLIC_SUPABASE_URL` is absent in standalone bot scripts (`packages/database` & `@hu-asms/bot`). |
| `SUPABASE_ANON_KEY` *(optional)* | Server / Scripts | Fallback alias in `packages/database` if `NEXT_PUBLIC_SUPABASE_ANON_KEY` is absent in standalone scripts. |
| `SUPABASE_STORAGE_BUCKET` *(optional)* | `.env.example` Template | Template reference in `.env.example`; runtime code uses `SYSTEM_CONSTANTS.STORAGE_BUCKET_NAME` (`'submission-files-vault'`). |
| `APP_BASE_URL` *(optional)* | Documentation/Reference | Canonical Vercel HTTPS URL (`https://<your-domain>.vercel.app`). |

---

## 7. Exact Deployment Instructions: GitHub → Supabase → Vercel

### Step 1: Clean GitHub Consolidation (When Authorized)
1. Confirm `.env`, `.env.local`, `.vercel`, and `supabase/.temp` remain untracked/ignored (`git status`).
2. Create or point a clean deployment branch to the new clean GitHub repository and push the consolidated codebase (without merging directly into `main`).

### Step 2: Clean Supabase Project Setup
1. Create a new Supabase project and install/authenticate the Supabase CLI locally.
2. Link the workspace to the new project (`npx supabase link --project-ref <NEW_PROJECT_REF>`) without importing remote old history.
3. Push all `10` ordered migrations cleanly:
   ```bash
   npx supabase db push
   ```
4. Bootstrap the **first System Owner**:
   - Create the System Owner user in **Supabase Dashboard → Authentication → Users** (`email` + password) and copy their UUID.
   - Insert their active profile in SQL Editor (running as `postgres`):
     ```sql
     INSERT INTO public.profiles (id, email, full_name, role, is_active)
     VALUES ('<AUTH_USER_UUID>', '<OWNER_EMAIL>', '<OWNER_FULL_NAME>', 'system_owner', true);
     ```
5. Load real institutional setup rows (`departments`, `academic_years`, `sections`, `courses`, `teachers`, `projects`, `project_targets`, `project_file_rules` with `max_file_size_bytes <= 20971520`, `representative_assignments`). Do **not** load demo student rows from `supabase/seed.sql` into production.

### Step 3: Vercel Monorepo Deployment (`apps/web`)
1. Import the new GitHub repository in Vercel and select the clean deployment branch.
2. Configure **Project Root Directory = `apps/web`** and ensure **"Include files outside the root directory in the Build Step"** is **enabled** (note `apps/web/vercel.json` automatically runs `cd ../.. && npm install` and `cd ../.. && npm run build`, and `apps/web/next.config.mjs` sets `outputFileTracingRoot` to the monorepo root).
3. Add all required environment variables from Section 6 (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`).
4. Trigger initial production deploy and record the live HTTPS domain (`https://<your-app>.vercel.app`).

### Step 4: Register Telegram Bot Webhook
Register Telegram's webhook pointing directly to `/api/bot/webhook` with the **exact** `TELEGRAM_WEBHOOK_SECRET`:
```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<your-app>.vercel.app/api/bot/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
  }'
```
Confirm `"ok": true` and verify webhook health via `getWebhookInfo`, then run the live smoke tests in Section 5.
