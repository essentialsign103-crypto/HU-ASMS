# HU-ASMS — Telegram Bot Production Readiness Audit

**Audit Date:** 2026-11-12  
**Target Supabase Project:** `tkdrxfvxryemfdrwcmay` (`"hu-accadamic assistent system"`, `eu-north-1`, production)  
**Repository / Branch:** `clean-deployment` (local working tree includes uncommitted remediation fixes)  
**Audit Mode:** Strictly read-only inspection across environment files, source code, tests, and live `tkdrxfvxryemfdrwcmay` metadata. **Zero** code/migration/`.env` edits, **zero** secret values printed, **zero** commits/pushes, **zero** Vercel or webhook changes.

---

## 1. Executive Summary

**Final Verdict: `NOT READY FOR VERCEL DEPLOYMENT`**

The core Telegram bot security architecture — fail-closed `X-Telegram-Bot-Api-Secret-Token` validation (`timingSafeEqual`), Postgres-backed `bot_sessions` across serverless cold starts, distributed Postgres rate limiting (`check_and_increment_rate_limit`), zero-PII identity verification, Telegram 20 MB download clamping, magic-byte/OOXML/anti-executable inspection, private `submission-files-vault` uploads with rollback cleanup, and redaction of bot tokens/SQL errors — is well engineered and passes **214 / 214** automated unit/mocked tests (`100` bot + `114` web).

However, **four production blockers (`FAIL`)** prevent deployment right now:
1. **Unseeded Target Database (`FAIL`):** `tkdrxfvxryemfdrwcmay` has 1 active System Owner (`auth_users = 1`, `active_owners = 1`), but `departments = 0`, `sections = 0`, `projects = 0`, and `students = 0`, so registration and submission conversations cannot complete.
2. **Unpushed Remediation & Dirty GitHub Branch (`FAIL`):** `origin/clean-deployment` (`5ea64c5`) still contains the revoked `TELEGRAM_BOT_TOKEN` in [`apps/bot/test/webhook-security.test.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/test/webhook-security.test.ts#L113) (only fixed locally), alongside uncommitted report/build artifacts and untracked [`docs/LOCAL_SMOKE_TEST_REPORT.md`](file:///d:/HU-ASMS%20%E2%80%94%20University/docs/LOCAL_SMOKE_TEST_REPORT.md#L506) containing a revoked `sbp_` PAT.
3. **Vercel Linking, Env Vars & Function `maxDuration` (`FAIL` / `NOT VERIFIED`):** No Vercel CLI/project link exists locally, live Vercel env vars are unconfigured/unverified, and [`apps/web/src/app/api/bot/webhook/route.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/api/bot/webhook/route.ts) does not export `maxDuration` (`downloadTelegramDocument` timeout is `25_000` ms + synchronous Supabase Storage upload).
4. **Unregistered Webhook & Zero Live Integration Tests (`FAIL` / `NOT VERIFIED`):** `bot_sessions = 0`, `rate_limit_buckets = 0`, Telegram `setWebhook` is not registered, and zero live Telegram/Supabase/Vercel E2E tests have run.

Additionally, **warnings (`WARNING`)** exist for local bot `.env` drift (wrong Supabase project ref in `.env` and `apps/bot/.env`), dead keyboard buttons in `main-menu.ts`, missing `/cancel` escape hatch inside conversations, and missing webhook `update_id` idempotency.

---

## 2. Bot Architecture & Actual Runtime Mode

| Component | Runtime Mode / Mechanism | Source Evidence | Status |
|---|---|---|---|
| **Next.js Webhook Route** | Webhook HTTP `POST /api/bot/webhook` (`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`), delegating to `@hu-asms/bot/webhook` (`handleTelegramWebhookFetch`) | [`route.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/api/bot/webhook/route.ts#L1-L11), [`webhook.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/webhook.ts#L133-L169) | **PASS** |
| **Vercel Serverless Architecture** | **Webhook mode** embedded in Next.js (`transpilePackages: ['@hu-asms/bot']`); `webhook.ts` does **not** import `dotenv/config` and **never** calls `bot.start()` | [`next.config.mjs`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/next.config.mjs#L10-L16), [`webhook.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/webhook.ts#L1-L128) | **PASS** |
| **Standalone Bot Entrypoint** | `apps/bot/src/index.ts` guards execution with `isExecutedDirectly()`: runs HTTP webhook server if `NODE_ENV === 'production' && TELEGRAM_WEBHOOK_URL`; otherwise calls `bot.start()` (long polling) for local dev | [`index.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/index.ts#L18-L65) | **PASS** |
| **Simultaneous Polling vs. Webhook Risk** | Production Vercel deployment imports `@hu-asms/bot/webhook` (`./src/webhook.ts` export), **not** `index.ts`, so Vercel cannot start polling. Risk exists **only** if an operator concurrently runs `npm run dev` locally (`bot.start()`) against the **same** live bot token after `setWebhook` is registered | [`package.json`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/package.json#L6-L9), [`index.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/index.ts#L38-L39) | **WARNING** |

---

## 3. Environment Variable Matrix (Names & Safe Status Only)

### 3.1 Env Loading Behavior Observed
- **Bot (`apps/bot/src/index.ts`):** Imports `'dotenv/config'` (`dotenv@16.6.1`), which loads **only `path.resolve(process.cwd(), '.env')`** (`override = false`). It ignores `.env.local`. Running `npm run dev` sets `cwd = apps/bot`, loading **`apps/bot/.env`**.
- **Next.js (`apps/web`):** `@next/env` (`loadEnvConfig`) loads `.env.local` / `.env` **only from `apps/web/`**. Verified `loadEnvConfig('apps/web', true)` loads **`[".env.local"]`**; root `.env` / `.env.local` are ignored when running via `-w apps/web`.
- **Webhook (`apps/bot/src/webhook.ts`):** Reads `process.env.TELEGRAM_BOT_TOKEN` (`L39`) and `process.env.TELEGRAM_WEBHOOK_SECRET` (`L72`) directly without `dotenv`.

### 3.2 Local File Matrix (No Secret Values Printed)

| Variable Name | Root `.env` | Root `.env.local` | `apps/bot/.env` | `apps/web/.env.local` | Status |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `OTHER_PROJECT` | `TARGET(tkdrxfvxryemfdrwcmay)` | `OTHER_PROJECT` | `TARGET(tkdrxfvxryemfdrwcmay)` | **WARNING** (bot `.env` files target wrong project) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `SET_DIFFERS_FROM_LOCAL` | `SET_MATCHES_LOCAL` | `SET_DIFFERS_FROM_LOCAL` | `SET_MATCHES_LOCAL` | **WARNING** |
| `SUPABASE_SERVICE_ROLE_KEY` | `SET_DIFFERS_FROM_LOCAL` | `SET_MATCHES_LOCAL` | `SET_DIFFERS_FROM_LOCAL` | `SET_MATCHES_LOCAL` | **WARNING** |
| `TELEGRAM_BOT_TOKEN` | `SET_ROTATED_MATCH` | `SET_ROTATED_MATCH` | `SET_ROTATED_MATCH` | `SET_ROTATED_MATCH` | **PASS** |
| `TELEGRAM_WEBHOOK_SECRET` | `SET_MATCHES_LOCAL` | `SET_MATCHES_LOCAL` | `PLACEHOLDER` | `SET_MATCHES_LOCAL` | **WARNING** (`apps/bot/.env` has placeholder) |
| `TELEGRAM_WEBHOOK_URL` | `PLACEHOLDER` | `PLACEHOLDER` | `PLACEHOLDER` | `NOT_SET` | **WARNING** (expected until Vercel URL exists) |
| `SUPABASE_STORAGE_BUCKET` | `SET_MATCHES_LOCAL` | `SET_MATCHES_LOCAL` | `SET_MATCHES_LOCAL` | `NOT_SET` (uses constant) | **PASS** |
| `SYSTEM_OWNER_EMAIL` | `SET_MATCHES_LOCAL` | `SET_MATCHES_LOCAL` | `SET_MATCHES_LOCAL` | `NOT_SET` (not read by app) | **PASS** |
| `SYSTEM_OWNER_TELEGRAM_ID` | `SET_MATCHES_LOCAL` | `SET_MATCHES_LOCAL` | `SET_MATCHES_LOCAL` | `NOT_SET` (not read by app) | **PASS** |
| `NODE_ENV` | `SET_MATCHES_LOCAL` | `SET_MATCHES_LOCAL` | `SET_MATCHES_LOCAL` | `NOT_SET` (framework-managed) | **PASS** |
| `APP_BASE_URL` | `SET_MATCHES_LOCAL` | `SET_MATCHES_LOCAL` | `SET_MATCHES_LOCAL` | `NOT_SET` (not read by app) | **PASS** |

- **Placeholder & Gitignore Protection:** [`.env.example`](file:///d:/HU-ASMS%20%E2%80%94%20University/.env.example#L1-L29) contains placeholders only (**PASS**). [`.gitignore`](file:///d:/HU-ASMS%20%E2%80%94%20University/.gitignore#L21-L25) ignores all four secret env files (**PASS**).
- **Schema Validation Gap:** Neither `apps/bot` nor `apps/web` uses a startup Zod env validation schema — missing vars fail lazily per route/RPC/client call (**WARNING**).
- **Required Vercel Environment Variables (`apps/web`, exact 5 keys):**
  1. `NEXT_PUBLIC_SUPABASE_URL` *(Browser + Server)*
  2. `NEXT_PUBLIC_SUPABASE_ANON_KEY` *(Browser + Server)*
  3. `SUPABASE_SERVICE_ROLE_KEY` *(Server-only — never prefix `NEXT_PUBLIC_`)*
  4. `TELEGRAM_BOT_TOKEN` *(Server-only — rotated token)*
  5. `TELEGRAM_WEBHOOK_SECRET` *(Server-only — 64-char secret)*

---

## 4. Supabase Connection Verification (`tkdrxfvxryemfdrwcmay`)

Live read-only query executed against `tkdrxfvxryemfdrwcmay`:

| Check / Table | Observed Live Value | Assessment | Status |
|---|---|---|---|
| **Web Config Target (`apps/web/.env.local` & `.env.local`)** | Targets `tkdrxfvxryemfdrwcmay` | Matches deployed production DB | **PASS** |
| **Bot Local Config (`.env` & `apps/bot/.env`)** | Targets `OTHER_PROJECT` | Local `npm run dev` bot will **not** connect to `tkdrxfvxryemfdrwcmay` unless aligned | **WARNING** |
| **`auth.users` / `profiles` / active `system_owner`** | `1` / `1` / `1` | System Owner initialized and logged in | **PASS** |
| **`departments` / `sections` / `projects` / `students`** | `0` / `0` / `0` / `0` | Target DB has zero academic seed records | **FAIL** |
| **`bot_sessions` / `rate_limit_buckets`** | `0` / `0` | Persistent tables exist, untested live | **NOT VERIFIED** |
| **`getSupabaseAdminClient()` Singleton** | [`packages/database/src/client.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/packages/database/src/client.ts#L18-L40) reads `NEXT_PUBLIC_SUPABASE_URL \|\| SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` with `persistSession: false` | Safe singleton over HTTPS PostgREST (no raw TCP pool exhaustion) | **PASS** |

---

## 5. Webhook Security Assessment

| Control | Implementation | Source Evidence | Status |
|---|---|---|---|
| **Secret Header Verification** | Constant-time `crypto.timingSafeEqual` on `x-telegram-bot-api-secret-token`; HTTP `500` if `TELEGRAM_WEBHOOK_SECRET` unset, `403` if missing/invalid | [`webhook-security.middleware.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/middleware/webhook-security.middleware.ts#L10-L71) | **PASS** |
| **Method & Body Bounds** | Rejects non-`POST` (`405`), > 1 MB raw body (`413`), malformed JSON or non-numeric `update_id` (`400`) | [`webhook.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/webhook.ts#L65-L106), [`webhook.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/webhook.ts#L152-L157) | **PASS** |
| **Sensitive Log Redaction** | `sanitizeLogData()` redacts `bot<id>:<token>` substrings and sensitive keys (`bot_token`, `telegram_bot_token`, `supabase_service_role_key`, etc.) in `webhook.ts`, `bot.ts`, and `telegram-file.ts` | [`error-handler.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/utils/error-handler.ts#L112-L149) | **PASS** |
| **Private Chat Isolation** | `requirePrivateChat()` enforced on `/start`, `/profile`, `/correction`, `/submit`, `/submit_group`, and registration/submission conversations; **omitted** on `My Projects`, `My Groups` (`/groups`), and Rep quick actions | [`chat-guard.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/utils/chat-guard.ts#L12-L26), [`bot.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/bot.ts#L145-L161) | **WARNING** |
| **Duplicate Webhook `update_id` Deduplication** | Not implemented; Telegram retries after timeout/500 will re-run `bot.handleUpdate()`. Single-version submissions fail DB uniqueness, but `resubmission_allowed = true` could create duplicate versions | [`webhook.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/webhook.ts#L108-L114) | **WARNING** |
| **Telegram Webhook Registration (`setWebhook`)** | No registration run yet; `getWebhookInfo` unverified | Live deployment pending | **FAIL** |

---

## 6. Workflow-by-Workflow Assessment

| # | Workflow | Findings & Code Path | Status |
|---|---|---|---|
| **1** | **`/start` & Registration** | `handleStartCommand` routes active reps to rep menu, suspended/approved students appropriately, and unlinked users to `registrationConversation`. **Blocked in live DB** until `departments`, `academic_years`, and `sections` exist (`departments = 0`). Inline keyboard `waitForCallbackQuery` + `waitFor(':text')` lacks `/cancel` or non-text prompt recovery | [`start.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/commands/start.ts#L10-L78), [`registration.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/registration.conversation.ts#L34-L86) | **FAIL** (DB empty) / **WARNING** (UX) |
| **2** | **HU ID Lookup & Duplicate Prevention** | `lookupStudentIdentity()` queries minimal columns (`id, hu_student_id, telegram_user_id, registration_status`), never returning stored names, masked names, departments, or suspension reasons pre-verification; blocks duplicate Telegram IDs and direct roster claiming | [`registration.service.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/registration.service.ts#L110-L187) | **PASS** |
| **3** | **Identity Verification & Approval** | Single-use SHA-256 uppercase-normalized token redeemed atomically via `redeem_student_verification_token` RPC (`service_role` only); supports admin-reviewed `roster_claim` and `account_recovery`; 5-attempt 15-min lockout audited | [`registration.service.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/registration.service.ts#L236-L332) | **PASS** *(Note: per-student Map in `registration.service.ts:45` is in-memory; DB RPC `LOCKED` also enforces server-side)* |
| **4** | **Individual Project Submission** | `individualSubmissionConversation` + `IndividualSubmissionService` check `is_active`, scope target, `opening_date`..`deadline`, `resubmission_allowed`, file validation, vault upload, DB rows (`submissions`, `submission_files`, `submission_members`), and audit log. **UX Warning:** `waitFor(':document')` hangs silently if student sends a compressed photo or `/cancel` | [`submission.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/submission.conversation.ts#L142-L221), [`submission.service.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/submission.service.ts#L67-L377) | **WARNING** (UX; `projects = 0` live) |
| **5** | **Group Creation & Membership Confirmation** | `handleMyGroups` (`👥 My Groups`, `/groups`) + `grp_confirm_` / `grp_decline_` callbacks work cleanly with `GroupManagementService.confirmMembership()`. Note: `grp_confirm_` calls `groupService` directly without `requirePrivateChat`; Rep `'👥 View Groups'` triggers student `handleMyGroups` | [`group.handler.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/handlers/group.handler.ts#L7-L111), [`bot.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/bot.ts#L146) | **WARNING** |
| **6** | **Group Submission** | Enforces `group.status === 'verified'`, confirmed membership, sole leader (`group_leader_id === student.id`), project window, file rules, duplicate prevention, snapshots all confirmed members in `submission_members`, updates `groups.status = 'submitted'`. Same `waitFor(':document')` UX warning | [`group-submission.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/group-submission.conversation.ts#L137-L248), [`group-submission.service.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/group-submission.service.ts#L77-L453) | **WARNING** |
| **7** | **Representative Scope & Notifications** | `RepresentativeService` requires `profiles.is_active = true` and `representative_assignments.is_active = true`; `NotificationService` writes `notifications` rows and dispatches non-blocking Telegram alerts (`ctx.api.sendMessage`) on individual/group submissions | [`representative.service.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/representative.service.ts#L60-L104), [`notification.service.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/notification.service.ts#L22-L93) | **PASS** |
| **8** | **Submission Status & Delivery Workflows** | **Incomplete in Bot:** Student `'📜 Submission History'` (`main-menu.ts:10`), Rep `'📦 Forward to Teacher'` (`main-menu.ts:19`), Rep `'📜 Delivery History'` (`main-menu.ts:20`), and `/support` (`shared/index.ts:48`) have **no handlers** in `bot.ts` (delivery forwarding exists in Web `/rep/deliveries`, not Telegram bot) | [`main-menu.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/keyboards/main-menu.ts#L6-L22), [`bot.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/bot.ts#L128-L197) | **FAIL** (dead menu buttons) |

---

## 7. File Upload & Storage Assessment

End-to-end pipeline: **Telegram `doc` → preCheck (`validateSubmissionFile`) → `downloadTelegramDocument` (`api.getFile` + streamed fetch with `AbortSignal.timeout(25_000)` + byte cap + `redactBotTokens`) → `validateAndPrepareSubmissionBinary` (`sanitizeFilename`, extension/MIME, `validateSubmissionFileContent` magic-byte/OOXML/anti-executable checks, SHA-256) → `uploadSubmissionToVault` (`upsert: false` to private `submission-files-vault`) → DB rows (`submissions`, `submission_files`, `submission_members`) → rollback cleanup on DB failure**.

- **20 MB Telegram Cap & Storage Parity:** Clamped everywhere via `resolveEffectiveTelegramMaxFileSizeBytes` (`20 * 1024 * 1024 = 20,971,520`), matching live `submission-files-vault` (`public = false`, `file_size_limit = 20971520`) and DB `chk_project_file_rules_max_size`. (**PASS**)
- **MIME & Extension Validation:** Metadata + magic bytes (`%PDF-`, `PK\x03\x04` + OOXML markers for `.docx`/`.xlsx`/`.pptx`, OLE for `.doc`/`.xls`/`.ppt`, PNG/JPEG, UTF-8/JSON) and executable/HTML rejection (`MZ`, `ELF`, `#!`, Mach-O, `<script`, `<?php`). (**PASS**)
- **Server-Only Service-Role Key:** Storage upload in bot uses `getSupabaseAdminClient()` server-side; client-side web code never touches `SUPABASE_SERVICE_ROLE_KEY`. (**PASS**)
- **Failed Upload Cleanup & Versioning:** `upsert: false` writes versioned keys `v${newVersion}_${safeFilename}`. On DB failure after Storage upload, `cleanupOrphanedVaultObject()` removes the uploaded object, deletes partial DB rows, and restores prior `active` submission status. (**PASS**)
- **Signed URL Access Controls:** Web portal `executeGetSubmissionFileDownloadUrl()` validates session, `is_active = true`, canonical role + section scope (`assertRepresentativeSectionScope`), UUID format, rate limits (`30/min`), and creates a 15-minute (`900s`) signed URL. (**PASS**)

---

## 8. Vercel Compatibility & Reliability Assessment

| Area | Finding | Evidence | Status |
|---|---|---|---|
| **Monorepo Build Config** | `apps/web/vercel.json` sets `"framework": "nextjs"`, `"installCommand": "cd ../.. && npm install"`, `"buildCommand": "cd ../.. && npm run build"`; requires Vercel **Root Directory = `apps/web`** | [`vercel.json`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/vercel.json#L1-L5) | **PASS** (pending Vercel setup) |
| **Persistent Sessions Across Cold Starts** | `bot.ts` mounts `SupabaseSessionStorage` backed by `public.bot_sessions` (24h TTL); fails closed in `NODE_ENV=production` if Supabase env missing; key isolated by `chat.id === from.id ? userId : chatId:userId` | [`supabase-session-storage.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/storage/supabase-session-storage.ts#L17-L76), [`bot.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/bot.ts#L47-L85) | **PASS** |
| **Distributed Rate Limiting** | `SupabaseRateLimitStore` invokes `check_and_increment_rate_limit` RPC (`10 req / 10s`); fails closed on RPC error and throws at startup in `production` if DB credentials missing | [`rate-limit.middleware.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/middleware/rate-limit.middleware.ts#L95-L188) | **PASS** |
| **Serverless Timeout (`maxDuration`)** | `apps/web/src/app/api/bot/webhook/route.ts` does **not** export `maxDuration`; synchronous 20 MB `getFile` (25s timeout) + Supabase Storage upload can exceed default Vercel serverless timeout | [`route.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/api/bot/webhook/route.ts#L6-L11) | **FAIL** |
| **Concurrent Same-User Updates** | `SupabaseSessionStorage.read()`/`write()` performs non-locked `select` + `upsert` and lacks periodic cleanup of expired `bot_sessions` / `rate_limit_buckets`; rapid parallel clicks from one user could experience last-write-wins session overwrites | [`supabase-session-storage.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/storage/supabase-session-storage.ts#L23-L64) | **WARNING** |
| **Webhook URL & Registration** | No live Vercel URL or project link exists locally (`vercel` CLI uninstalled; `.vercel/` absent); Telegram `setWebhook` not executed | Local FS & CLI check | **FAIL** |

---

## 9. Testing Coverage Separation (Phase G)

| Test Category | Current Coverage (Observed Live) | Status |
|---|---|---|
| **Automated Unit & Mocked Integration Tests (`apps/bot`)** | **100 / 100 passed** (`30` suites, `0` failed, `0` skipped, `2904 ms`): registration/recovery verification, file download/validation/rollback, persistent session & rate-limiter mocks, group management, group/individual submission services, rep reporting, webhook security (`19/19`) | **PASS** *(All mocked/in-memory)* |
| **Automated Unit & Contract Tests (`apps/web`)** | **114 / 114 passed** (`29` suites, `0` failed, `0` skipped, `1754 ms`): auth roles, middleware, delivery/signed-URL mocks, secret hygiene (`2/2`), migration/SQL security contracts | **PASS** *(All mocked/static)* |
| **Real Telegram Bot API Tests** | **0 tests** — `getMe`, `getWebhookInfo`, real `getFile` 20 MB download, live `sendMessage` alerts never executed | **NOT VERIFIED** |
| **Real Supabase Integration Tests** | **0 tests** — live `bot_sessions`, `check_and_increment_rate_limit`, `redeem_student_verification_token`, storage uploads/signed URLs, and live JWT RLS checks never executed against `tkdrxfvxryemfdrwcmay` | **NOT VERIFIED** |
| **Live Webhook & Concurrency Tests** | **0 tests** — live HTTPS `POST /api/bot/webhook` with `X-Telegram-Bot-Api-Secret-Token` and concurrent user updates untested | **NOT VERIFIED** |
| **Manual Browser Tests** | System Owner successfully logged into **local** admin dashboard; end-to-end rep/admin file download & approval flows on Vercel untested | **NOT VERIFIED** |

---

## 10. Production Blockers & Ordered Remediation Steps

### Production Blockers Summary
1. **`FAIL` — `tkdrxfvxryemfdrwcmay` Institutional Seed Data Missing:** `departments = 0`, `sections = 0`, `projects = 0`, `students = 0`.
2. **`FAIL` — Clean Code/Security Fixes Not Pushed (`origin/clean-deployment`):** `apps/bot/test/webhook-security.test.ts` fix is local only; untracked `docs/LOCAL_SMOKE_TEST_REPORT.md:506` contains a revoked `sbp_` PAT.
3. **`FAIL` — Vercel Deployment, Env Vars & `maxDuration` Missing:** `maxDuration` unset on `/api/bot/webhook`; Vercel project not yet configured/deployed with the 5 production env vars.
4. **`FAIL` — Telegram `setWebhook` & Live E2E Tests Unexecuted.**

### Recommended Remediation Steps (Ordered by Priority)
1. **P0 — Clean Working Tree & Push Remediation to `clean-deployment` (Upon Approval):**
   - Add `export const maxDuration = 60;` (or platform-supported ceiling) to [`apps/web/src/app/api/bot/webhook/route.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/api/bot/webhook/route.ts).
   - Wire or remove the dead keyboard buttons (`📜 Submission History`, `📦 Forward to Teacher`, `📜 Delivery History`, Rep `👥 View Groups`, `/support`) and add a `/cancel` + non-document guidance prompt in submission conversations.
   - Align root `.env` and `apps/bot/.env` to `tkdrxfvxryemfdrwcmay` (and real `TELEGRAM_WEBHOOK_SECRET` in `apps/bot/.env`) before any local bot `npm run dev` testing.
   - Scrub the revoked `sbp_` line from untracked [`docs/LOCAL_SMOKE_TEST_REPORT.md`](file:///d:/HU-ASMS%20%E2%80%94%20University/docs/LOCAL_SMOKE_TEST_REPORT.md#L506), discard `apps/web/tsconfig.tsbuildinfo` + disposable scratch scripts, and commit/push vetted changes to `clean-deployment`.
2. **P1 — Deploy `apps/web` to Vercel:**
   - Connect `essentialsign103-crypto/HU-ASMS` branch `clean-deployment` with **Root Directory = `apps/web`**.
   - Configure the exact 5 Vercel env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, rotated `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`), keeping server secrets unprefixed.
3. **P2 — Seed Institutional Data on `tkdrxfvxryemfdrwcmay`:**
   - Via the Admin Dashboard (or approved seed script), create departments, academic years, sections, courses, teachers, projects, and `project_file_rules` (`<= 20 MB`).
4. **P3 — Register Telegram Webhook & Run Live Smoke Suite:**
   - Call Telegram `setWebhook` targeting `https://<vercel-domain>/api/bot/webhook` with `secret_token = TELEGRAM_WEBHOOK_SECRET` (and do **not** run local polling `npm run dev` concurrently against that same token).
   - Verify live `/start` registration, token redemption (`bot_sessions` + `rate_limit_buckets`), `< 20 MB` & `> 20 MB` upload behavior, Private Storage upload + `/rep` 15-min signed URL download, and `getWebhookInfo`.

---

## 11. Final Deployment Readiness Verdict

**`NOT READY FOR VERCEL DEPLOYMENT`**
