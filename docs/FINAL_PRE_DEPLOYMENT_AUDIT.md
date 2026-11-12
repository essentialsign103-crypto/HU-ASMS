# HU-ASMS — Final Pre-Deployment Focused Audit Report

**Audit Date:** 2026-11-11  
**Audit Scope:** Read-only code, SQL migration, dependency, and test verification audit preceding GitHub consolidation  
**Reference Remediation Report:** [`CRITICAL_BLOCKERS_REMEDIATION.md`](file:///d:/HU-ASMS%20%E2%80%94%20University/docs/CRITICAL_BLOCKERS_REMEDIATION.md)  
**Target Architecture:** Clean GitHub Repository + Clean Supabase Project + Vercel (`apps/web` + `/api/bot/webhook`)

---

## Executive Decision: **NOT READY — ESSENTIAL FIXES REMAIN**

Two essential functional/security gaps remain before GitHub consolidation and clean deployment, alongside moderate hardening items that should be tracked cleanly:

1. **Essential Gap #1 (Telegram `getFile` 20 MB Limit vs. `50 MB` Hard Cap):** [`downloadTelegramDocument`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/utils/telegram-file.ts#L69-L75) enforces a `50 MB` (`52,428,800`-byte) `vaultHardLimit` instead of standard Telegram Cloud Bot API's documented **`20 MB`** download cap, and [`AcademicManagementService.createProject`](file:///d:/HU-ASMS%20%E2%80%94%20University/packages/database/src/academic-management.ts#L309), [`submission.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/submission.conversation.ts#L141-L151), and [`group-submission.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/group-submission.conversation.ts#L241-L251) do not prevent projects from configuring `max_file_size_bytes > 20 MB`. Any project configured for `21–50 MB` will accept the attachment past pre-validation and fail mid-download on `api.getFile()` with a raw Telegram API error rather than a clear size-limit rejection.
2. **Essential Gap #2 (Unwired Verification Token Issuance UI in `/admin/students`):** [`executeIssueStudentVerificationToken`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/lib/admin/student-approval-service.ts#L372-L440) is implemented and unit-tested, **but has zero callers anywhere in `apps/web/src/app`**. Specifically, [`apps/web/src/app/admin/students/page.tsx`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/admin/students/page.tsx) has no Server Action or UI control to issue single-use claim/recovery codes or display existing bound `target_student` records alongside `account_recovery` requests. Additionally, token verification hashes raw input case-sensitively (`rawToken.trim()` vs. uppercase generated codes) and has no per-student failed-attempt lockout/auditing.

---

## 1. Telegram File Size Limit Investigation

### 1.1 Actual Telegram Bot API `getFile` Download Limit
- Under the standard cloud-hosted Telegram Bot API (`https://api.telegram.org`), `getFile` enforces a strict **20 MB download limit** (Bots can download files up to 20 MB via `getFile`; larger files return `400 Bad Request: file is too big`). By contrast, standard bots can *send* up to 50 MB, and Supabase Storage `'submission-files-vault'` ([`20261110000003_storage_setup.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261110000003_storage_setup.sql#L10)) allows `52,428,800` bytes (`50 MB`).

### 1.2 Current Codebase Behavior & Gap Analysis
- **Defaults work cleanly at 20 MB:** [`SYSTEM_CONSTANTS.DEFAULT_MAX_FILE_SIZE_BYTES`](file:///d:/HU-ASMS%20%E2%80%94%20University/packages/shared/src/index.ts#L6) is `20 * 1024 * 1024` (20 MB), [`project_file_rules.max_file_size_bytes`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261110000001_initial_schema.sql#L302) defaults to `20971520` (`20 MB`), and [`AcademicManagementService.createProject`](file:///d:/HU-ASMS%20%E2%80%94%20University/packages/database/src/academic-management.ts#L309) defaults to `20971520`. When a project uses that default 20 MB limit, [`validateSubmissionFile`](file:///d:/HU-ASMS%20%E2%80%94%20University/packages/validation/src/index.ts#L121-L128) rejects oversized files **before** calling `getFile` with:  
  `"File size (X MB) exceeds maximum permitted limit of 20.0 MB."`
- **Confirmed Gap (`50 MB` Hard Cap):** In [`downloadTelegramDocument`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/utils/telegram-file.ts#L69-L75):
  ```ts
  const vaultHardLimit = 50 * 1024 * 1024;
  const maxSizeBytes = Math.min(
    options.maxSizeBytes && options.maxSizeBytes > 0
      ? options.maxSizeBytes
      : SYSTEM_CONSTANTS.DEFAULT_MAX_FILE_SIZE_BYTES,
    vaultHardLimit
  );
  ```
  Neither `project_file_rules` (no SQL `CHECK`), `createProject`, bot submission conversations, nor `downloadTelegramDocument` enforces a **20 MB** ceiling for standard Bot API downloads. If a project sets `max_file_size_bytes` to e.g. `30 MB` or `50 MB`:
  1. Bot prompts advertise the higher limit (`formatFileSize(project.file_rules.max_file_size_bytes)`).
  2. `validateSubmissionFile` accepts a `25 MB` attachment.
  3. The bot replies `"Downloading, validating content..."` and invokes `api.getFile(...)`, which Telegram Cloud API rejects (`file is too big`).
  4. `downloadTelegramDocument` catches that error and replies `"❌ Submission Rejected: Failed to resolve file metadata from Telegram: ..."` — exposing an unclear failure instead of rejecting >20 MB upfront with a clear user-facing limit message.

### 1.3 Architecture & Deployment Requirements If Files `> 20 MB` Are Needed
If HU-ASMS must accept files larger than 20 MB via Telegram or web:
- **Alternative A — Self-Hosted Telegram Bot API Server (`--local`):**
  - Run Telegram's official C++ `telegram-bot-api` daemon in `--local` mode (persistent Docker/VM host with `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`, persistent disk storage, and reverse proxy/TLS) and point grammY `client.apiRoot` to that server.
  - Expands Bot API `getFile` limits up to **2,000 MB (2 GB)**.
  - **Code & infra incompatibility today:** In `--local` mode, `getFile` returns an absolute local filesystem path on the Bot API host rather than an HTTPS URL under `https://api.telegram.org/file/bot...`. [`downloadTelegramDocument`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/utils/telegram-file.ts#L109-L133) explicitly rejects non-relative paths / local paths (`isSafeTelegramRelativePath` + hardcoded `api.telegram.org` URL) and Vercel serverless functions cannot read a separate local Bot API container's disk without an HTTP file proxy.
- **Alternative B — Web Pre-Signed Direct Upload for Large Assignments (Recommended if >20 MB is needed while staying serverless on Vercel):**
  - Keep standard `api.telegram.org` capped strictly at `20 MB` (`20 * 1024 * 1024`) for Telegram uploads, and for projects requiring larger files, authenticate/generate a short-lived signed upload token/URL via a Next.js upload route directly into `'submission-files-vault'` (adjusting `storage.buckets.file_size_limit` above `50 MB` if required).

### 1.4 Required Remediation Before Consolidation
1. Enforce a **`20 MB` (`20 * 1024 * 1024`)** ceiling in `downloadTelegramDocument`, `submission.conversation.ts`, `group-submission.conversation.ts`, `IndividualSubmissionService`, `GroupSubmissionService`, and `AcademicManagementService.createProject` when running against standard Telegram Cloud API (or introduce an explicit feature flag only if a `--local` proxy is deployed).
2. Ensure the rejection message returned before calling `getFile()` clearly tells students: files sent through Telegram cannot exceed **20 MB** (alongside the project's configured limit).

---

## 2. Persistent Conversation State Audit

### 2.1 Is `@grammyjs/conversations` Replay State Actually Persisted?
- **Yes — verified in installed dependency source.** [`apps/bot/package.json`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/package.json#L19-L26) uses `grammy@^1.22.4` and `@grammyjs/conversations@^1.2.0`.
- Inspection of [`node_modules/@grammyjs/conversations/out/conversation.js`](file:///d:/HU-ASMS%20%E2%80%94%20University/node_modules/@grammyjs/conversations/out/conversation.js#L252-L389) confirms that `@grammyjs/conversations` v1.x stores all active conversation logs (`session.conversation[id]`) inside `ctx.session` and transforms them via `listify(...)` / `delistify(...)` so they serialize cleanly as JSON.
- In [`apps/bot/src/bot.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/bot.ts#L92-L106), `session({ storage: sessionStorage, ... })` is registered **before** `conversations()` and `createConversation(...)`, and `resolveSessionStorage` uses [`SupabaseSessionStorage`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/storage/supabase-session-storage.ts#L17-L76) whenever `SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured (and throws if missing in `NODE_ENV=production`). Thus **both** `SessionData` and `@grammyjs/conversations` multi-step execution logs persist in `public.bot_sessions.session_data` (JSONB).

### 2.2 Behavior Across Webhook Requests, Cold Starts & Multiple Instances
- Each POST request to `/api/bot/webhook` calls `handleTelegramWebhookFetch` -> `processTelegramWebhookRequest` -> `getOrCreateWebhookBot` ([`apps/bot/src/webhook.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/webhook.ts#L35-L48)). Warm instances reuse `cachedBot` without retaining conversation state in memory; cold instances re-run `createBot()` and reload `ctx.session.conversation` from `public.bot_sessions` during `bot.handleUpdate()`.
- **Consequence / Race Limitation:** [`SupabaseSessionStorage`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/storage/supabase-session-storage.ts#L23-L64) uses a bare `SELECT` at middleware entry and `UPSERT` (`onConflict: 'session_key'`) at middleware exit with **no optimistic concurrency control (version counter / conditional update)** and no per-session row lock. Two rapid updates from the same user processed simultaneously on two separate Vercel lambdas can overwrite each other's `session_data`.

### 2.3 Isolation Between Two Students
- [`bot.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/bot.ts#L97) configures `getSessionKey: (ctx) => ctx.chat?.id?.toString() ?? ctx.from?.id?.toString()`.
- **In private 1-on-1 DMs:** `ctx.chat.id === ctx.from.id` (each student's unique Telegram chat ID), so two different students **cannot** overwrite each other's session or conversation state.
- **Residual Group-Chat Collision Risk:** If the bot is ever invoked inside a Telegram group chat, `ctx.chat.id` identifies the shared group rather than the individual user, allowing two students in the same group to share and overwrite the same `bot_sessions` key. Interactive academic workflows (`/start`, `/submit`, `/submit_group`, `/correction`) should scope keys by `${ctx.chat?.id}:${ctx.from?.id}` (or restrict commands to `ctx.chat?.type === 'private'`).

### 2.4 Session Expiration & Recovery Behavior
- `SupabaseSessionStorage` sets `expires_at = now + 24h` (`DEFAULT_SESSION_TTL_MS`) on every `write()`. On `read()`, expired rows (`expires_at <= Date.now()`) are deleted and `undefined` is returned cleanly so grammY starts fresh with `initial: () => ({})`.
- **Recovery Limitation:** If an unhandled error occurs mid-conversation (e.g., transient DB failure during replay), `@grammyjs/conversations` removes the failed conversation handle (`conversations.splice(i, 1)`) and `bot.catch` logs redacted details (`bot.ts#L176-L185`), **without** automatically replying to tell the student to restart `/start` or `/submit`. Also, no scheduled job cleans up abandoned expired rows in `public.bot_sessions`.

---

## 3. Verification Token Security Audit

| Control Criterion | Audit Finding | Detailed Evidence |
|---|---|---|
| **Cryptographic Token Generation** | **PASS** | [`executeIssueStudentVerificationToken`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/lib/admin/student-approval-service.ts#L409) generates `randomBytes(8).toString('hex').toUpperCase()` via Node.js CSPRNG (`64` bits entropy, `16` hex characters). |
| **Hashed Token Storage** | **PASS (with minor UX normalization bug)** | Only `createHash('sha256').update(rawCode).digest('hex')` is stored (`token_hash VARCHAR(64) UNIQUE`). Plaintext `rawCode` is returned once in memory and never stored in DB. **UX bug:** Admin generates uppercase hex, whereas [`hashVerificationToken`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/registration.service.ts#L43-L45) runs `rawToken.trim()` without `.toUpperCase()`, causing valid tokens typed in lowercase to fail. |
| **Expiration & Single-Use Enforcement** | **PASS** | `ttlHours` is clamped `[1, 168]` (default `24h`). [`redeem_student_verification_token`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261112000001_critical_blockers_persistence_and_identity_hardening.sql#L286-L310) locks the token row (`FOR UPDATE`), requires `used_at IS NULL AND expires_at > clock_timestamp()`, and immediately sets `used_at` and `used_by_telegram_id`. *(Note: issuing a new token does not revoke prior unused tokens for the same student.)* |
| **Binding to Student & Telegram Account** | **PASS** | Token row enforces `student_id NOT NULL REFERENCES public.students(id)`; RPC verifies `v_student.hu_student_id` matches AND `t.student_id = v_student.id` (cannot redeem Student A's token for Student B), blocks `suspended` accounts, blocks already-bound Telegram accounts (`23505`), and blocks `roster_claim` tokens on already-linked students. |
| **Token Issuance Admin Workflow (UI)** | **ESSENTIAL GAP** | [`executeIssueStudentVerificationToken`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/lib/admin/student-approval-service.ts#L372-L440) has **zero callers in `apps/web/src/app`**. [`admin/students/page.tsx`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/admin/students/page.tsx) has **no UI form or Server Action** for System Owners to issue single-use verification/recovery tokens. |
| **Rate Limiting & Failed-Attempt Handling** | **MODERATE GAP** | All Telegram updates pass [`createRateLimiterMiddleware`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/bot.ts#L83-L89) (`10` updates per `10s` per `ctx.from.id`), backed by Postgres RPC in production. However, there is **no per-student failed-token attempt counter/lockout** and **no failed-attempt audit log**, so distributed retries across multiple Telegram IDs targeting one HU Student ID are not throttled per student record (mitigated in part by 64-bit token entropy). |
| **Log & Bot Response Redaction** | **PASS (with minor state-oracle note)** | Bot never logs `rawToken` or echoes it on errors; `audit_student_verification_token_issue` trigger logs only `token_id`, `purpose`, `expires_at`; [`sanitizeLogData`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/utils/error-handler.ts#L112-L148) redacts keys named `token`/`secret`/`bot_token`/etc.; zero PII (`full_name`, `maskedName`, department, section, suspension reason, or linked Telegram username/ID) is returned before verification. *(Minor note: [`registration.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/registration.conversation.ts#L237-L245) messages distinguish `unlinked` vs. `linked_to_another_user` vs. `not_found`, disclosing registration existence without PII.)* |
| **Can Account Recovery Hijack Linked Accounts?** | **BLOCKED (Admin/Token Gated) + DoS Note** | An attacker **cannot** hijack a linked account via self-service or guessing HU Student ID; re-linking `telegram_user_id` requires either a cryptographic `account_recovery` token or explicit System Owner approval in `/admin/students`. **Two operational nuances:** (1) An unlinked attacker guessing a linked HU ID can park a bogus pending `account_recovery` row in `registration_requests`, temporarily blocking legitimate pending requests for that `hu_student_id` via `uq_pending_registration_request_hu_id` until System Owner rejects it; (2) [`admin/students/page.tsx`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/admin/students/page.tsx#L77-L92) does not display the currently bound `target_student` record alongside `account_recovery` requests for side-by-side comparison. |

---

## 4. Database Migration Review (`20261112000001` & 9-Migration Clean-Install Sequence)

### 4.1 Clean Supabase Ordering & Cross-Migration Dependencies
All **`9`** migration files in [`supabase/migrations/`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations) sort monotonically with zero timestamp collisions and zero edits to prior migrations `01`–`05` or Track B `000001`–`000003`:
1. `20261110000001_initial_schema.sql` (defines `students`, `registration_requests`, `identity_change_history`, `audit_logs`, `profiles`, enums `student_registration_status`, `request_status`, `user_role`)
2. `20261110000002_row_level_security.sql`
3. `20261110000003_storage_setup.sql`
4. `20261110000004_delivery_items_rep_policy.sql`
5. `20261110000005_security_hardening.sql` (hardens `auth_is_system_owner()`, `record_scoped_audit_log`, table/default grants revoking `anon` & restricting `audit_logs`/`identity_change_history` writes)
6. `20261111000001_track_b_rep_active_profile_guard.sql`
7. `20261111000002_track_b_atomic_rpcs_and_db_parity.sql` (defines partial unique indexes `uq_pending_registration_request_*`, `approve_student_registration(UUID, TEXT)`, `reject_student_registration`, triggers)
8. `20261111000003_track_b_function_privilege_and_default_acl_hardening.sql` (sets `ALTER DEFAULT PRIVILEGES ... FUNCTIONS REVOKE ALL ... FROM PUBLIC, anon, authenticated` and verifies all 18 prior functions)
9. [`20261112000001_critical_blockers_persistence_and_identity_hardening.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261112000001_critical_blockers_persistence_and_identity_hardening.sql)

### 4.2 Review of `20261112000001` Internals
- **Schema & Column Compatibility:** Every referenced column (`students.is_locked`, `telegram_username`, `updated_at`, `registration_requests.reviewed_at`, `admin_notes`, `identity_change_history(student_id, changed_by, old_values, new_values, reason)`, `audit_logs(actor_id, actor_telegram_id, actor_role, action, entity_type, entity_id, metadata)`) matches `20261110000001` exact definitions.
- **Constraints & Indexes:** Enforces `CHECK (request_type IN ('new_registration', 'roster_claim', 'account_recovery'))`, `CHECK (purpose IN ('roster_claim', 'account_recovery'))`, `token_hash VARCHAR(64) NOT NULL UNIQUE`, FK `target_student_id REFERENCES public.students(id) ON DELETE CASCADE`, and partial index `idx_reg_requests_target_student`.
- **RLS, Grants & RPC Authorization:**
  - `public.bot_sessions` & `public.rate_limit_buckets`: RLS enabled with zero `anon`/`authenticated` policies; `REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT ALL TO service_role;`.
  - `public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT)` & `public.redeem_student_verification_token(TEXT, TEXT, BIGINT, TEXT)`: `SECURITY DEFINER SET search_path = ''`; internal guard verifies `auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin')`; `EXECUTE` revoked from `PUBLIC, anon, authenticated` and granted strictly to `service_role`.
  - `public.student_verification_tokens`: RLS enabled with `"System Owners manage student verification tokens"` (`public.auth_is_system_owner()`). `PUBLIC`/`anon` revoked. *(Minor hardening note: `GRANT SELECT, INSERT, UPDATE, DELETE` grants `UPDATE` to `authenticated`; revoking `UPDATE` for `authenticated` makes issued token hashes append-only outside `service_role` redemption.)*
  - `public.audit_student_verification_token_issue()`: `SECURITY DEFINER SET search_path = ''`, trigger `trg_audit_student_verification_token_issue` (`AFTER INSERT ON student_verification_tokens`). **Minor ACL parity note:** Revokes `PUBLIC, anon, authenticated` (`L224`) rather than `PUBLIC, anon, authenticated, service_role` used for the 9 trigger functions in `20261111000003`.
  - `public.approve_student_registration(UUID, TEXT)`: `SECURITY DEFINER SET search_path = ''`; internal guard checks `public.auth_is_system_owner()` for authenticated callers or `service_role` / `postgres` / `supabase_admin`; revokes `PUBLIC, anon`, grants `authenticated, service_role` (`authenticated` remains coupled to `admin/students/page.tsx` SSR client).
- **Transaction Safety & Rollback Implications:**
  - Uses standard transactional DDL (no `CREATE INDEX CONCURRENTLY`), so Supabase CLI applies/aborts `20261112000001` atomically on clean push.
  - Because `CREATE OR REPLACE FUNCTION public.approve_student_registration(UUID, TEXT)` replaces `20261111000002`'s definition in place, **rolling back after apply requires a full reverse migration script** that drops new tables/triggers/RPCs/columns **and** restores `20261111000002`'s `approve_student_registration` function. Note also there is no automated cleanup schedule yet for expired `bot_sessions` or `rate_limit_buckets` rows.

---

## 5. Final Testing Honesty Inventory

### 5.1 Mocked / Static Tests vs. Real Service Tests

| Test Scope / Suite | Count | What Actually Runs (100% Observed) | Real External Services Touched? |
|---|---|---|---|
| `@hu-asms/bot` (`apps/bot/test/*.test.ts`) | **98 tests / 30 suites** | [`critical-blockers.test.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/test/critical-blockers.test.ts) plus 9 service/middleware/webhook suites: tests registration, claim/recovery, `downloadTelegramDocument`, `validateSubmissionFileContent`, submission/group rollback, webhook HMAC secret guard, error redaction, rate limiter, and multi-step grammY conversations across 3 fresh `Bot` instances + `resetWebhookBotCache()`. | **None.** Uses in-memory mock DB clients, stubbed `fetch`/`api.getFile`, and Map-backed mock Postgres tables (`SupabaseSessionStorage` / `SupabaseRateLimitStore` tested against in-memory JS `Map` mocks, `PersistentMemorySessionStorage` JSON round-trips). |
| `@hu-asms/web` (`apps/web/test/*.test.ts`) | **113 tests / 29 suites** | [`critical-blockers-web.test.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/test/critical-blockers-web.test.ts), [`track-b-privilege-and-sql-hardening.test.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/test/track-b-privilege-and-sql-hardening.test.ts), and 10 other service/auth/migration suites: tests role guards, delivery manifests, approval/rejection/token generation services, distributed rate-limit wrapper, secret hygiene, `vercel.json`/`next.config.mjs`, and regex contracts across all 9 `.sql` migration files. | **None.** Uses mock `SupabaseClient` / `rpc` stubs and static filesystem regex checks (`migration-security.test.ts` & `track-b-privilege-and-sql-hardening.test.ts` do **not** execute SQL inside PostgreSQL). |
| `@hu-asms/database` (`packages/database/test/*.test.ts`) | **15 tests / 10 suites** | Academic & university structure unit tests (`academic-management.test.ts`, `university-structure.test.ts`). | **None.** Mocked `SupabaseClient`. |
| `@hu-asms/shared`, `@hu-asms/types`, `@hu-asms/validation` | Placeholder (`node --version`) | No standalone test suite (`validation` helpers are exercised via bot/web/database test suites). | **None.** |

**Explicit Statement on Live Services:** **Zero** tests in this repository connect to live PostgreSQL, live Supabase Auth/RLS/Storage (`'submission-files-vault'`), live Telegram Bot API (`api.telegram.org`), or live Vercel serverless infrastructure.

### 5.2 Build, Typecheck & Regression Status (Latest Observed Run Before Read-Only Audit Docs)
All local source checks passed with zero code modifications made during this audit:
- `npm run typecheck`: **PASS** across all 6 workspaces (`0` errors).
- `npm run lint`: **PASS** across all 6 workspaces (`tsc --noEmit`; ESLint is not configured).
- `npm test`: **226 / 226 PASS** (`69` suites, `0` failures, `0` skipped).
- `npm run test:coverage`: **226 / 226 PASS** (`76.62%` line / `74.25%` branch / `75.21%` function coverage overall).
- `npm run build`: **PASS** across all 6 workspaces (`Next.js 15.5.29` built `21/21` routes + `95 kB` middleware cleanly).
- `git diff --check` & frozen migration check: **PASS** (zero whitespace/conflict errors; `0` changes to `20261110000001`–`05` or `20261111000001`–`03`).

---

## 6. Blocking Items Required Before Authorizing GitHub Consolidation

To move from **NOT READY — ESSENTIAL FIXES REMAIN** to **READY FOR GITHUB CONSOLIDATION**, complete these targeted local fixes (and add regression tests for each):

1. **Enforce Standard Telegram 20 MB Cap & Clear Error Messaging (Essential):**
   - Cap `downloadTelegramDocument` ([`telegram-file.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/utils/telegram-file.ts#L69-L75)), [`submission.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/submission.conversation.ts), [`group-submission.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/group-submission.conversation.ts), `IndividualSubmissionService`, `GroupSubmissionService`, and `AcademicManagementService.createProject` at **`20 * 1024 * 1024` (20 MB)** whenever running on standard cloud Telegram Bot API, returning a clear size-limit message to the user before `api.getFile()` is called.
2. **Wire Single-Use Verification Token Issuance UI & Hardening in `/admin/students` (Essential):**
   - Add a System Owner Server Action + UI control on [`admin/students/page.tsx`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/admin/students/page.tsx) wired to [`executeIssueStudentVerificationToken`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/lib/admin/student-approval-service.ts#L372-L440) (including `assertDistributedRateLimit`, `roster_claim`/`account_recovery` selection, one-time token display, and side-by-side target student comparison on pending `account_recovery` / `roster_claim` requests).
   - Normalize token input case in [`hashVerificationToken`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/registration.service.ts#L43-L45) (`.trim().toUpperCase()`), and add per-student failed-token rate limiting / lockout + audit logging on failed redemption attempts.
3. **Recommended Alongside Fixes (Small Localized Safeguards):**
   - Scope [`getSessionKey`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/bot.ts#L97) by `${ctx.chat?.id}:${ctx.from?.id}` (or guard against non-private chats) so two students in a shared Telegram chat cannot collide on conversation state.
   - Revoke `UPDATE` on `public.student_verification_tokens` from `authenticated` and align `REVOKE ALL ON FUNCTION public.audit_student_verification_token_issue()` with `000003` (`PUBLIC, anon, authenticated, service_role`) in forward SQL.
