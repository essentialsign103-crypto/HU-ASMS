# HU-ASMS — Critical Blockers Remediation Report

**Status:** **LOCAL IMPLEMENTATION COMPLETE — ESSENTIAL FIXES REMAIN PER FINAL PRE-DEPLOYMENT AUDIT (Deployment Freeze Active)**  
**Reference Reviews:** [`CLEAN_DEPLOYMENT_READINESS.md`](file:///d:/HU-ASMS%20%E2%80%94%20University/docs/CLEAN_DEPLOYMENT_READINESS.md) | [`FINAL_PRE_DEPLOYMENT_AUDIT.md`](file:///d:/HU-ASMS%20%E2%80%94%20University/docs/FINAL_PRE_DEPLOYMENT_AUDIT.md)  
**Target Deployment Architecture:** Clean GitHub Repository + Clean Supabase Project + Vercel (`apps/web`)  
**Freeze Compliance:** All changes are strictly local. Zero Git commits/pushes, zero remote Supabase migrations/writes, zero Vercel deployments, and zero modifications to previously staged/applied migrations (`20261110000001`–`05` and `20261111000001`–`03`) were performed.

---

## 1. Overview & Status of the Three Critical Blockers

All three critical release blockers identified in [`CLEAN_DEPLOYMENT_READINESS.md`](file:///d:/HU-ASMS%20%E2%80%94%20University/docs/CLEAN_DEPLOYMENT_READINESS.md#L10-L18) have been remediated in core service and migration code, **with two essential pre-GitHub gaps identified during the final read-only audit** ([`FINAL_PRE_DEPLOYMENT_AUDIT.md`](file:///d:/HU-ASMS%20%E2%80%94%20University/docs/FINAL_PRE_DEPLOYMENT_AUDIT.md)):

| Blocker | Original Risk | Remediated Control | Final Audit Status |
|---|---|---|---|
| **Phase A — Unlinked Roster Account Hijacking & PII Leak** | Any Telegram user entering a guessable unlinked HU Student ID received masked name + department/year/section PII and could immediately bind/lock the record without verification. | Pre-verification lookups leak **zero** student PII; self-service roster binding is disabled (`throws`); claim and account recovery require either a single-use SHA-256 verification token or an admin-reviewed `roster_claim` / `account_recovery` request; duplicate Telegram bindings are blocked in app & DB layers. | **Gap Remains:** [`executeIssueStudentVerificationToken`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/lib/admin/student-approval-service.ts#L372-L440) has **zero UI/Server Action callers** in [`admin/students/page.tsx`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/admin/students/page.tsx); token hashing is case-sensitive (`trim()` only); recovery UI lacks bound target comparison & per-student lockout. |
| **Phase B — Missing Telegram File Download & Spoofed / Dangling Metadata** | Bot submission conversations passed `telegramFileId` without `buffer`, skipping `'submission-files-vault'` uploads while writing dangling `submission_files.storage_path` rows. | Real byte download via Telegram `getFile` + size-bounded streaming fetch (`downloadTelegramDocument`); deep magic-byte / OOXML / executable content inspection (`validateSubmissionFileContent`); vault upload **before** DB supersession; real `checksum_sha256` & byte length stored; orphaned storage cleanup + prior active version/status restoration on DB failures. | **Gap Remains:** [`telegram-file.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/utils/telegram-file.ts#L69-L75) enforces a `50 MB` `vaultHardLimit` instead of standard Telegram Bot API's **`20 MB`** `getFile` download cap; projects configuring `> 20 MB` fail mid-download with raw `getFile` errors instead of clean `20 MB` rejection. |
| **Phase C — Stateless Vercel Serverless Bot Sessions & Local Rate Limits** | `createBot` used in-memory `session()` / conversations state and process-local rate limit maps, breaking multi-step bot flows across cold starts and serverless instances. | Postgres-backed `SupabaseSessionStorage` (`public.bot_sessions`) wired into grammY `session()` + `@grammyjs/conversations` (`v1.2.0` `ctx.session.conversation`); distributed sliding-window rate limiting (`public.rate_limit_buckets` + `check_and_increment_rate_limit` RPC) wired into bot middleware and web Server Actions; `NODE_ENV=production` fails closed if persistent credentials are unavailable. | **Core Verified + Hardening Notes:** Conversation replay state persists via `listify`/`delistify` inside JSONB, **but** `getSessionKey` uses `chat.id` (group-chat multi-user collision risk) and `SupabaseSessionStorage` lacks optimistic concurrency locking on parallel updates. |

---

## 2. Phase A — Secure Student Identity Linking, Verification, Claim & Recovery Controls

### 2.1 Pre-Verification PII Removal & Anti-Enumeration
- In [`registration.service.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/registration.service.ts) and [`registration.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/registration.conversation.ts):
  - Removed pre-verification `maskedInfo` (`maskedName`, department, academic year, section) from lookup responses and removed `student` / `pendingRequest` object leakage before verification succeeds.
  - Entering an existing registered or pre-seeded HU Student ID no longer discloses whether the account is linked, unlinked, suspended, pending approval, or assigned to a specific department/section.
  - Direct self-service linking (`linkRosterStudentToTelegram`) is disabled and fails closed by throwing an explicit authorization error if invoked.
  - [`commands/start.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/commands/start.ts) guards against suspended student records so suspended accounts cannot invoke protected flows.

### 2.2 Single-Use Hashed Verification Tokens
- **Schema & Atomic Redemption RPC ([`20261112000001_critical_blockers_persistence_and_identity_hardening.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261112000001_critical_blockers_persistence_and_identity_hardening.sql#L167-L384)):**
  - `public.student_verification_tokens` stores SHA-256 `token_hash` (64 hex characters, `UNIQUE`), `purpose` (`'roster_claim'` | `'account_recovery'`), `issued_by`, `expires_at`, `used_at`, and `used_by_telegram_id`.
  - Protected by RLS (`System Owners manage student verification tokens` via `public.auth_is_system_owner()`), `PUBLIC`/`anon` privileges revoked, and audited on insert by trigger `trg_audit_student_verification_token_issue` (`STUDENT_VERIFICATION_TOKEN_ISSUED`).
  - `public.redeem_student_verification_token(TEXT, TEXT, BIGINT, TEXT)` is `SECURITY DEFINER SET search_path = ''`, restricted strictly to `service_role`. It rejects duplicate Telegram IDs already bound to another student (`23505`), blocks `suspended` accounts, locks and consumes valid unexpired tokens (`used_at`, `used_by_telegram_id`), rejects `roster_claim` tokens if the student row is already linked to a Telegram ID, records `public.identity_change_history`, approves any matching pending request by the same Telegram user for that HU ID, and logs `STUDENT_TOKEN_CLAIM_VERIFIED` or `STUDENT_TOKEN_RECOVERY_VERIFIED` in `public.audit_logs`.
- **Service & UI Support (Incomplete UI Wiring):**
  - Bot service [`redeemVerificationToken`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/registration.service.ts#L177-L222) hashes the user-provided verification token (`rawToken.trim()`, currently case-sensitive vs. uppercase issued tokens) and executes redemption atomically via backend service role.
  - Web admin service [`executeIssueStudentVerificationToken`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/lib/admin/student-approval-service.ts#L372-L440) generates CSPRNG 8-byte uppercase hex tokens (`randomBytes(8)` = 64-bit entropy) and stores only the SHA-256 hash; **however, [`admin/students/page.tsx`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/admin/students/page.tsx) does not yet import or wire a UI form/Server Action to issue tokens**, leaving System Owners unable to generate claim/recovery tokens from the web dashboard without adding that Server Action/UI control.
  - Per-student failed-token attempt lockout/auditing and automatic invalidation of prior unused tokens on re-issuance are not yet implemented (global per-user Telegram rate limiting applies at `10` req / `10s`).

### 2.3 Admin-Reviewed Claim, Account Recovery & Registration Approval
- **Data Model (`packages/types/src/index.ts` & Migration `20261112000001`):**
  - Extended `registration_requests` with `request_type` (`'new_registration'` | `'roster_claim'` | `'account_recovery'`), `target_student_id`, and `recovery_reason` + partial index `idx_reg_requests_target_student`.
  - Bot method [`submitVerifiedClaimOrRecoveryRequest`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/registration.service.ts) queues verified-review claim/recovery requests without granting immediate account access.
- **Approval Safeguards (`approve_student_registration(UUID, TEXT)` & [`student-approval-service.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/lib/admin/student-approval-service.ts)):**
  - Rejects `roster_claim` when the target student already has a non-null `telegram_user_id` (requiring explicit `account_recovery`).
  - Rejects claiming/recovering `suspended` student records (`P0001`).
  - Prevents any Telegram user ID from linking to more than one `students` record (`23505`).
  - Logs `identity_change_history` and `audit_logs` (`STUDENT_REGISTRATION_APPROVED`, `STUDENT_ROSTER_CLAIM_APPROVED`, `STUDENT_ACCOUNT_RECOVERY_APPROVED`), and preserves compensation rollback if approval writes encounter a non-production partial failure.
  - [`admin/students/page.tsx`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/admin/students/page.tsx) surfaces request type badges (`neutral`, `info`, `warning`) and enforces distributed rate limiting.

---

## 3. Phase B — Real Telegram File Downloads, Content Inspection, Vault Storage & Failure Rollback

### 3.1 Bounded Real Telegram File Download & 20 MB Bot API Limit Audit Finding
- Implemented [`downloadTelegramDocument`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/utils/telegram-file.ts#L58-L225):
  1. Validates `fileId`, pre-checks `declaredSizeBytes` against the effective `maxSizeBytes` (**currently capped at `vaultHardLimit = 50 * 1024 * 1024`**, matching `'submission-files-vault'` rather than Telegram Cloud Bot API's `20 MB` `getFile` limit), and calls `api.getFile(fileId)`.
  2. Rejects unsafe/traversal `file_path` strings (`isSafeTelegramRelativePath`), `0`-byte metadata (`file_size <= 0`), and oversized `file_size`.
  3. Streams bytes from `https://api.telegram.org/file/bot<token>/<file_path>` with a `25_000 ms` abort timeout (`AbortSignal.timeout`), checking `Content-Length` and aborting stream reads immediately if accumulated bytes exceed `maxSizeBytes` or total `0` bytes.
  4. Computes `computeSha256Hex(buffer)` and redacts bot tokens via [`redactBotTokens`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/utils/telegram-file.ts#L37-L43) before rethrowing errors (`TelegramFileDownloadError`).
- **Audit Finding on `50 MB` vs `20 MB`:** Standard Telegram Bot API (`https://api.telegram.org`) restricts `getFile` downloads to **20 MB** (`20 * 1024 * 1024`). Default `20 MB` projects reject files `> 20 MB` cleanly with a clear error message via [`validateSubmissionFile`](file:///d:/HU-ASMS%20%E2%80%94%20University/packages/validation/src/index.ts#L121-L128), **but** if `project_file_rules.max_file_size_bytes` is configured above `20 MB` (e.g., `25–50 MB`), conversations accept the file into `downloadTelegramDocument` and fail on `api.getFile()` with `"Failed to resolve file metadata from Telegram: ..."` unless capped at `20 MB` or backed by a Local Bot API Server (`--local`). See [`FINAL_PRE_DEPLOYMENT_AUDIT.md`](file:///d:/HU-ASMS%20%E2%80%94%20University/docs/FINAL_PRE_DEPLOYMENT_AUDIT.md#L1-L60) Section 1.
- Both [`submission.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/submission.conversation.ts) and [`group-submission.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/group-submission.conversation.ts) now download real document bytes via `downloadTelegramDocument` before invoking submission services.

### 3.2 Binary Magic-Byte, Structural & Executable Content Screening
- Added [`validateSubmissionFileContent`](file:///d:/HU-ASMS%20%E2%80%94%20University/packages/validation/src/index.ts#L233-L403), invoked alongside filename/MIME checks inside [`validateAndPrepareSubmissionBinary`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/utils/submission-storage.ts#L59-L109):
  - Rejects missing/empty (`0`-byte) or oversized buffers (`FILE_DOWNLOAD_REQUIRED` / `INVALID_FILE`).
  - Explicitly blocks executable binaries (PE/MZ, ELF, `#!` shell scripts, Mach-O/Java headers) and leading HTML/script/PHP payloads (`<!doctype html`, `<html`, `<script`, `<?php`) regardless of extension.
  - Verifies magic signatures and container markers per extension:
    - `.pdf`: `%PDF-` header + `application/pdf` MIME consistency.
    - `.zip`, `.docx`, `.xlsx`, `.pptx`: `PK\x03\x04` signature + OOXML structure markers (`word/`, `xl/`, `ppt/`, or `[Content_Types].xml`).
    - `.doc`, `.xls`, `.ppt`: OLE2 binary header (`d0 cf 11 e0 a1 b1 1a e1`).
    - `.png` / `.jpg` / `.jpeg`: standard PNG and JPEG headers.
    - `.txt`, `.md`, `.csv`, `.json`: null-byte rejection, fatal UTF-8 decode check, and `JSON.parse` validation for `.json`.

### 3.3 Fail-Closed Vault Upload & Post-Upload Rollback
- In [`submission-storage.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/utils/submission-storage.ts#L115-L173), [`IndividualSubmissionService`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/submission.service.ts), and [`GroupSubmissionService`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/services/group-submission.service.ts):
  1. Actual validated file bytes are uploaded to `'submission-files-vault'` (`SYSTEM_CONSTANTS.STORAGE_BUCKET_NAME`) via [`uploadSubmissionToVault`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/utils/submission-storage.ts#L115-L149) **before** superseding prior active submissions or mutating database state.
  2. Persisted `submission_files` records store the real uploaded `storage_path`, actual byte size, MIME type, and `checksum_sha256`.
  3. On any post-upload database failure (`submissions`, `submission_members`, `submission_files`, or group submission status updates), [`cleanupOrphanedVaultObject`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/utils/submission-storage.ts#L154-L173) removes the newly uploaded vault object, deletes partial newly inserted DB rows, and restores the prior active submission (`status = 'active'`) so neither orphan objects nor lost prior submissions remain.

---

## 4. Phase C — Persistent Bot Sessions & Distributed Rate Limiting

### 4.1 Architecture Decision: DB-Backed Vercel Webhook vs. Standalone Persistent Node Worker

| Evaluation Dimension | Option 1 (Chosen): DB-Backed Vercel Webhook (`apps/web` `/api/bot/webhook` + Supabase Postgres) | Option 2 (Rejected): Standalone Always-On Node Worker (`apps/bot/src/index.ts`) |
|---|---|---|
| **Session Continuity Across Restarts / Scaling** | **Solved.** [`SupabaseSessionStorage`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/storage/supabase-session-storage.ts#L17-L76) persists grammY session & `@grammyjs/conversations` state in `public.bot_sessions` across concurrent serverless invocations, scale-outs, and cold starts. | Single-process `MemorySessionStorage` still loses all mid-conversation state on container restarts/redeploys and cannot scale horizontally without adding external Postgres/Redis anyway. |
| **Deployment & Operations Footprint** | **Preserves existing monorepo Vercel deployment** (`apps/web/vercel.json`) with zero additional VM/container hosting, process manager, or TLS webhook ingress setup. | Requires provisioning and monitoring a separate always-on Node host/service, TLS termination, and zero-downtime restart orchestration. |
| **Rate-Limit Consistency** | [`SupabaseRateLimitStore`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/middleware/rate-limit.middleware.ts) and [`assertDistributedRateLimit`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/lib/security/rate-limiter.ts) share one atomic Postgres sliding-window table across both bot webhooks and web Server Actions. | Separate worker still requires external DB/Redis to synchronize rate-limit state with `apps/web` Server Actions. |
| **Tradeoff Accepted** | Adds ~1–2 indexed Postgres round-trips per webhook update (`bot_sessions` + `check_and_increment_rate_limit`). Acceptable given low-latency co-located serverless/Postgres traffic and student-scale concurrency. | Avoided separate infrastructure & cold/redeploy state fragility at this stage; `apps/bot/src/index.ts` remains intact if traffic ever warrants a dedicated worker alongside the same `SupabaseSessionStorage`. |

### 4.2 Session Persistence, Conversation Replay & Fail-Closed Production Wiring
- **Verified `@grammyjs/conversations` (`v1.2.0`) State Persistence:** By inspecting `conversations()` and `createConversation()` in `@grammyjs/conversations` v1.2.0, active conversation replay logs (`ctx.session.conversation[id]`) are transformed into JSON-compatible arrays (`listify` / `delistify`) directly inside `ctx.session`. Installing `session({ storage })` before `conversations()` persists both `SessionData` and multi-step conversation state inside `public.bot_sessions.session_data` (JSONB).
- [`SupabaseSessionStorage`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/storage/supabase-session-storage.ts#L17-L76) implements grammY's `StorageAdapter<SessionData>` over `public.bot_sessions` with a `24`-hour sliding expiration (`DEFAULT_SESSION_TTL_MS`), auto-deleting expired rows on read and throwing on DB errors instead of silently resetting mid-flow state.
- [`createBot`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/bot.ts#L92-L106) wires `resolveSessionStorage` into `session({ storage })` and `@grammyjs/conversations` (`conversations()`), and [`createRateLimiterMiddleware`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/middleware/rate-limit.middleware.ts) attaches the distributed rate-limit store.
- When `NODE_ENV === 'production'`, bot creation **fails closed** if `SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` (and persistent external session/rate-limit stores) are missing, preventing silent fallback to per-process memory on Vercel.
- **Audit Hardening Notes:** `getSessionKey` (`ctx.chat?.id?.toString() ?? ctx.from?.id?.toString()`) isolates distinct students in private 1-on-1 DMs (`chat.id === from.id`) **but would collide if used by multiple students in a shared Telegram group chat**; `SupabaseSessionStorage` `upsert` lacks optimistic concurrency locking across concurrent same-user webhook updates; and mid-conversation exceptions cleared by `bot.catch` do not proactively instruct the user to restart. See [`FINAL_PRE_DEPLOYMENT_AUDIT.md`](file:///d:/HU-ASMS%20%E2%80%94%20University/docs/FINAL_PRE_DEPLOYMENT_AUDIT.md) Section 2.
- [`PersistentMemorySessionStorage`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/storage/supabase-session-storage.ts#L87-L113) performs deep JSON serialization round-tripping in unit tests and non-production local testing to verify conversation state survival across independent webhook calls and simulated cold starts.

### 4.3 Distributed Sliding-Window Rate Limiting (Bot & Web Server Actions)
- **Postgres Atomic Sliding Window ([`check_and_increment_rate_limit(TEXT, INTEGER, BIGINT)`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261112000001_critical_blockers_persistence_and_identity_hardening.sql#L61-L151)):**
  - `SECURITY DEFINER SET search_path = ''`, callable **only** by `service_role`.
  - Uses `FOR UPDATE` row locking on `public.rate_limit_buckets` to filter timestamps within `[now - window_ms, now]`, enforce `p_max_requests`, and return `(allowed, remaining, retry_after_ms)`.
- **Bot & Web Integration:**
  - Bot updates use `SupabaseRateLimitStore` inside `createRateLimiterMiddleware`, failing closed when RPC calls fail (`retryAfterSeconds` / error suppression without leaking stack traces).
  - Web Server Actions enforce [`assertDistributedRateLimit`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/lib/security/rate-limiter.ts) across:
    - [`apps/web/src/app/admin/students/page.tsx`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/admin/students/page.tsx)
    - [`apps/web/src/app/rep/deliveries/actions.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/rep/deliveries/actions.ts)
    - [`apps/web/src/app/rep/groups/actions.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/rep/groups/actions.ts)
    - [`apps/web/src/app/rep/submissions/actions.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/rep/submissions/actions.ts)
  - In `NODE_ENV=production`, `assertDistributedRateLimit` fails closed if Postgres RPC credentials are missing or RPC execution fails rather than silently reverting to local `MemoryRateLimiter`.

---

## 5. Database Schema & Forward Migration Summary

All **`9`** migration files in [`supabase/migrations/`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations) now form a strict monotonic clean-install chain (`20261110000001`–`05` + `20261111000001`–`03` + `20261112000001`), with **zero modifications** to frozen migrations `01`–`05` or Track B `000001`–`000003`:

| Migration File | Status | Purpose |
|---|---|---|
| `20261110000001` – `20261110000005` | Unchanged (Frozen) | Core 23 tables, RLS helpers/policies, `'submission-files-vault'` bucket, delivery item policy, `search_path` & profile/audit hardening. |
| `20261111000001` – `20261111000003` | Unchanged (Frozen) | Track B active rep RLS guard, atomic approval/rejection/delivery RPCs & integrity triggers, least-privilege 4-bucket `REVOKE`/`GRANT` & `ALTER DEFAULT PRIVILEGES`. |
| [`20261112000001_critical_blockers_persistence_and_identity_hardening.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/migrations/20261112000001_critical_blockers_persistence_and_identity_hardening.sql) | **New Forward Migration (Local Staged)** | Adds persistent sessions (`bot_sessions`), distributed rate limiting (`rate_limit_buckets` + `check_and_increment_rate_limit`), `registration_requests` claim/recovery columns, hashed single-use `student_verification_tokens` + audit trigger (`trg_audit_student_verification_token_issue`), `redeem_student_verification_token` RPC, and updated `approve_student_registration(UUID, TEXT)`. |

### Objects Introduced / Updated in `20261112000001`

| Object | Kind | Privilege & Security Model |
|---|---|---|
| `public.bot_sessions` (+ `idx_bot_sessions_expires_at`) | Table / Index | RLS enabled, `PUBLIC`/`anon`/`authenticated` revoked; `service_role` only. |
| `public.rate_limit_buckets` (+ `idx_rate_limit_buckets_expires_at`) | Table / Index | RLS enabled, `PUBLIC`/`anon`/`authenticated` revoked; `service_role` only. |
| `public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT)` | `SECURITY DEFINER` RPC (`search_path = ''`) | Verifies `auth.role() = 'service_role'` (or `postgres`/`supabase_admin`); `PUBLIC`/`anon`/`authenticated` revoked; `EXECUTE` granted to `service_role` only. |
| `public.registration_requests` (`request_type`, `target_student_id`, `recovery_reason` + `idx_reg_requests_target_student`) | Table Alterations | `request_type` constrained to `('new_registration', 'roster_claim', 'account_recovery')`; FK to `students(id)` on `target_student_id`. |
| `public.student_verification_tokens` (+ `idx_student_verif_tokens_student`) | Table / Index | RLS enabled; `"System Owners manage student verification tokens"` (`auth_is_system_owner()`); `PUBLIC`/`anon` revoked; 64-char unique SHA-256 `token_hash`. |
| `public.audit_student_verification_token_issue()` & `trg_audit_student_verification_token_issue` | Trigger Function / Trigger | `SECURITY DEFINER SET search_path = ''`; `PUBLIC`/`anon`/`authenticated` revoked (note: `000003` also revokes `service_role` on triggers); logs `STUDENT_VERIFICATION_TOKEN_ISSUED`. |
| `public.redeem_student_verification_token(TEXT, TEXT, BIGINT, TEXT)` | `SECURITY DEFINER` RPC (`search_path = ''`) | `service_role` only; prevents duplicate Telegram links, enforces unexpired unused token & non-suspended status, updates student lock state, writes `identity_change_history` + `audit_logs`. |
| `public.approve_student_registration(UUID, TEXT)` | `SECURITY DEFINER` RPC (`search_path = ''`) | `authenticated` (with internal `auth_is_system_owner()` gate) and `service_role` only (`PUBLIC`/`anon` revoked); replaces `20261111000002` version in-place (rollback requires restoring `000002` function definition + reverse DDL). |

---

## 6. Automated Verification Results

All automated checks below were executed locally **after the final code and test edits**, with **zero failures** (`0` skipped, `0` cancelled):

| Check Command | Outcome | Observed Result Details |
|---|---|---|
| `npm run typecheck` | **PASS** | `tsc --noEmit` exited `0` across all 6 workspaces (`@hu-asms/bot`, `@hu-asms/web`, `@hu-asms/database`, `@hu-asms/shared`, `@hu-asms/types`, `@hu-asms/validation`). |
| `npm run lint` | **PASS** | Ran `tsc --noEmit` across all 6 workspaces (`0` errors; note ESLint is not configured in workspace scripts). |
| `npm test` | **PASS (`226 / 226`)** | `69` suites, `0` failures, `0` skipped: `@hu-asms/bot` **98/98** (`30` suites), `@hu-asms/web` **113/113** (`29` suites), `@hu-asms/database` **15/15** (`10` suites). (`@hu-asms/shared`, `@hu-asms/types`, and `@hu-asms/validation` run `node --version` placeholder scripts.) |
| `npm run test:coverage` | **PASS (`226 / 226`)** | Line coverage **`76.62%`**, branch **`74.25%`**, functions **`75.21%`** overall across tested sources. Notable modules: `submission.service.ts` (`98.68%`), `group-submission.service.ts` (`96.22%`), `submission-storage.ts` (`95.95%`), `rate-limit.middleware.ts` (`98.49%`), `student-approval-service.ts` (`95.45%`), `delivery-service.ts` (`97.10%`), `roles.ts` (`95.41%`), `rate-limiter.ts` (`91.75%`), `supabase-session-storage.ts` (`87.61%`), `telegram-file.ts` (`74.22%`), `packages/validation/src/index.ts` (`75.93%`). |
| `npm run build` | **PASS** | Full build exited `0` across all 6 workspaces (`@hu-asms/types`, `@hu-asms/shared`, `@hu-asms/validation`, `@hu-asms/database`, `@hu-asms/bot`, `@hu-asms/web`). `Next.js 15.5.29` compiled in `10.9s`, building **`21/21`** routes (including `/api/bot/webhook`, `/admin/students`, `/rep/submissions`, `/rep/groups`, `/rep/deliveries`) + `95 kB` middleware. |
| `git diff --check` & frozen migration check | **PASS** | Exit code `0` (zero whitespace/conflict markers); `git diff --name-only -- supabase/migrations/2026111000000* supabase/migrations/2026111100000*` returned empty (`0` frozen migrations modified). |

### Important Scope Limitation (Mocked vs. Live Execution)
All unit tests in [`critical-blockers.test.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/test/critical-blockers.test.ts), [`critical-blockers-web.test.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/test/critical-blockers-web.test.ts), [`track-b-privilege-and-sql-hardening.test.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/test/track-b-privilege-and-sql-hardening.test.ts), and existing test suites use **mocked Supabase clients, mocked `fetch` / Telegram API stubs, `PersistentMemorySessionStorage`, and static SQL contract assertions**. Under the active deployment freeze:
- **Zero** migrations were pushed to a live PostgreSQL / Supabase instance.
- **Zero** live Telegram Bot API `getFile` / webhook HTTP round-trips were executed.
- **Zero** real `'submission-files-vault'` uploads or signed URL downloads were executed against Supabase Storage.
- **Zero** live Vercel multi-instance cold-start runtime tests were executed.

---

## 7. Manual Integration Tests Required Upon Clean Deployment

Execute the following end-to-end smoke verification checklist immediately after pushing all 9 migrations to the clean Supabase project and deploying `apps/web` to Vercel:

1. **Supabase Schema & RPC Smoke Check:**
   - Apply all 9 migrations in order (`20261110000001` through `20261112000001`) on the clean Supabase database.
   - Verify `public.bot_sessions` and `public.rate_limit_buckets` return permission denied for `anon` and `authenticated`, and that `check_and_increment_rate_limit` / `redeem_student_verification_token` are executable only by `service_role`.
   - Bootstrap the initial System Owner in Supabase Auth + `public.profiles` (`role = 'system_owner'`, `is_active = true`).
2. **Phase A Live Identity Verification & Recovery Test:**
   - Send `/start` with an unlinked HU Student ID -> verify the bot exposes **no** student name, department, year, or section and provides **no** instant self-bind button.
   - From `/admin/students`, issue a single-use `roster_claim` token for a test unlinked student -> redeem it via Telegram -> verify `students.telegram_user_id` binds, token `used_at` populates, `STUDENT_TOKEN_CLAIM_VERIFIED` logs to `audit_logs`, and reusing the token fails.
   - Test a second Telegram account attempting to redeem or claim an already-bound Telegram ID -> verify rejection without overwriting existing ownership.
   - Test admin-approved `account_recovery` via `/admin/students` -> verify `identity_change_history` and `STUDENT_ACCOUNT_RECOVERY_APPROVED` log cleanly.
3. **Phase B Live Telegram File Upload & Inspection Test:**
   - Submit a valid `.pdf` and `.docx` via `/submit` and `/submit_group` in Telegram -> verify real objects exist in private bucket `'submission-files-vault'`, `submission_files.checksum_sha256` and `file_size_bytes` match the uploaded bytes, and `/rep/submissions` generates working 15-minute signed download URLs.
   - Rename an executable (`MZ...`) or HTML script to `.pdf` and submit via Telegram -> verify immediate rejection with clean user feedback and zero dangling storage/DB records.
   - Confirm application logs never expose `TELEGRAM_BOT_TOKEN`.
4. **Phase C Live Vercel Serverless Persistence & Rate-Limit Test:**
   - Start a multi-step `/submit` or `/start` conversation in Telegram, confirm an active row appears in `public.bot_sessions`, wait or trigger a fresh Vercel serverless cold start (e.g., new deployment instance / concurrent session), and finish the conversation step without losing context.
   - Exceed the sliding-window request threshold rapidly from Telegram and via `/admin/students` or `/rep/submissions` Server Actions -> verify HTTP/rate-limit enforcement persists cleanly in `public.rate_limit_buckets` across serverless invocations.

---

## 8. Remaining Non-Blocking Operational Recommendations & Clean-Deployment Checklist

### Clean-Deployment Checklist
1. **Git Consolidation & Hygiene (when authorized):** Review and commit the consolidated changes on `phase-14-security-hardening` cleanly to the new GitHub repository, ensuring `.env`, `.env.local`, and `supabase/.temp` stay ignored.
2. **Clean Supabase Setup:** Link to the new Supabase project, push all `9` migrations, bootstrap the initial System Owner user + active profile, and load clean non-demo institutional setup rows (`departments`, `academic_years`, `sections`, `courses`, `teachers`, `projects`, `project_targets`, `project_file_rules`, `representative_assignments`) rather than blindly seeding demo students from [`seed.sql`](file:///d:/HU-ASMS%20%E2%80%94%20University/supabase/seed.sql).
3. **Vercel Deployment & Webhook Registration:** Configure Vercel Project **Root Directory = `apps/web`**, set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_WEBHOOK_SECRET`, deploy, and register Telegram `setWebhook` targeting `https://<domain>/api/bot/webhook` with matching `secret_token`.

### Non-Blocking Post-Launch Hardening (Safe to Schedule After Go-Live)
- Add a scheduled cleanup job (e.g., `pg_cron` or maintenance RPC) to purge expired rows in `public.bot_sessions` and `public.rate_limit_buckets` beyond their TTLs.
- Configure real ESLint rules across workspaces (currently `npm run lint` runs `tsc --noEmit`).
- Address deferred low-severity items noted in [`CLEAN_DEPLOYMENT_READINESS.md`](file:///d:/HU-ASMS%20%E2%80%94%20University/docs/CLEAN_DEPLOYMENT_READINESS.md#L48-L58) (`private` schema relocation for SQL auth helpers, active-staff `SELECT` tightening on catalog tables, fixing `NotificationService` pre-send status update, and authorization check in `handleProjectDetailsCallback`).
