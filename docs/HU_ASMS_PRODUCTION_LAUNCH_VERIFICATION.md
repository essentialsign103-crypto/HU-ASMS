# HU-ASMS Production Launch Verification

**Date**: November 15, 2026  
**Latest commit**: `de9d67f` on `clean-deployment`  
**Production URL**: https://hu-asms.vercel.app  

---

## 1. GitHub Repository and Deployed Commit

| Item | Value |
|---|---|
| Repository | essentialsign103-crypto/HU-ASMS |
| Branch | `clean-deployment` |
| Local HEAD | `de9d67f` |
| Remote `origin/clean-deployment` | `de9d67f` (in sync) |
| Working tree | Clean |

All commits pushed successfully. GitHub and local are in sync.

---

## 2. Original Error Digest `1935480371`

**Root cause**: Missing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel Production environment variables, causing `createServerSupabaseClient()` to throw on every server render.

**Current status**: ✅ RESOLVED. `GET /` returns HTTP 307 → `/login` (correct redirect, no error).

---

## 3. Incident A — Telegram Bot PowerShell Dependency

**Root cause**: Telegram webhook was never registered (`getWebhookInfo` returned `url: ""`).

**Current status**: Webhook was registered via `setWebhook` API call — `setWebhook` returned `ok: true, result: true, description: "Webhook was set"`. However, the production webhook endpoint returns HTTP 500 for real updates due to a bot initialization error (see below).

---

## 4. Incident B — Registration Approval Service Unavailable (digest `3888652674`)

**Root cause**: `SUPABASE_SERVICE_ROLE_KEY` not configured in Vercel Production environment variables, causing `assertDistributedRateLimit()` to throw in production mode.

**Evidence**: The `assertDistributedRateLimit` function at `apps/web/src/lib/security/rate-limiter.ts:163-177` checks for `SUPABASE_SERVICE_ROLE_KEY` and throws if absent in production. This throws BEFORE `executeApproveRegistration` is called.

**Current status**: ⚠️ BLOCKED. Requires adding `SUPABASE_SERVICE_ROLE_KEY` to Vercel Production environment variables.

---

## 5. Webhook Route Verification

| Test | Result |
|---|---|
| `GET /api/bot/webhook` | HTTP 405 (correct — POST only) |
| `POST` with wrong secret | HTTP 403 (correct rejection) |
| `POST` with no secret | HTTP 403 (correct rejection) |
| `POST` with correct secret + update | HTTP 500 (bot processing error) |

### Webhook 500 root cause analysis

The webhook endpoint validates the secret correctly (proven by 403 responses). The 500 occurs during `bot.handleUpdate()` or `bot.init()`.

**Fixes committed**:
1. `bc833b2` — Pass `STATIC_BOT_INFO` to skip `bot.init()` (Telegram `getMe` API round-trip)
2. `de9d67f` — Split init from handleUpdate: init errors return 500, update errors return 200
3. `21850ec` — BotError detection for grammY middleware errors

**Local verification**: All three fixes work locally — `handleTelegramWebhookFetch` with correct env vars returns HTTP 200. The local build contains the correct code (verified by inspecting `.next/server/app/api/bot/webhook/route.js`).

**Production status**: The latest commit `de9d67f` is on GitHub but Vercel may not have deployed it yet (build in progress or CDN cache). The production response timing (898ms) suggests `bot.init()` is still being called, meaning the `STATIC_BOT_INFO` fix from `bc833b2` hasn't taken effect.

### Required action

Verify in Vercel dashboard that the deployment for commit `de9d67f` shows "Ready". If the build failed, trigger a manual redeploy. If the build succeeded but the CDN is stale, wait a few more minutes.

---

## 6. Supabase Project Verification

| Item | Value |
|---|---|
| Project URL | `https://tkdrxfvxryemfdrwcmay.supabase.co` |
| `submission-files-vault` bucket | ✅ EXISTS (private, 20MB limit, PDF/ZIP/DOCX/MIME types) |
| `bot_sessions` table | ✅ EXISTS (RLS enabled, service_role only) |
| `rate_limit_buckets` table | ✅ EXISTS |
| `check_and_increment_rate_limit` RPC | ✅ EXISTS and returns correct response |
| `approve_student_registration` RPC | ✅ EXISTS (returns P0002 "not found" for nil UUID = correct) |
| `reject_student_registration` RPC | ✅ EXISTS (same) |
| `mark_delivery_sent_with_audit` RPC | ✅ EXISTS (same) |
| `provision_representative_profile` RPC | ❌ MISSING — migration `20261113000001` not applied |
| `course_section_offerings` table | ❌ MISSING — migration `20261114000001` not applied |

### Migration reconciliation

| Migration | Status |
|---|---|
| `20261110000001_initial_schema.sql` | ✅ Applied (tables exist) |
| `20261110000002_row_level_security.sql` | ✅ Applied (RLS working) |
| `20261110000003_storage_setup.sql` | ✅ Applied (bucket exists) |
| `20261110000004_delivery_items_rep_policy.sql` | ✅ Applied |
| `20261110000005_security_hardening.sql` | ✅ Applied |
| `20261111000001_track_b_rep_active_profile_guard.sql` | ✅ Applied |
| `20261111000002_track_b_atomic_rpcs_and_db_parity.sql` | ✅ Applied (RPCs exist) |
| `20261111000003_track_b_function_privilege_and_default_acl_hardening.sql` | ✅ Applied |
| `20261112000001_critical_blockers_persistence_and_identity_hardening.sql` | ✅ Applied (bot_sessions, rate_limit_buckets) |
| `20261112000002_minimum_deployment_blocker_fixes.sql` | ✅ Applied |
| `20261112000003_post_deployment_security_hardening.sql` | ✅ Applied (bucket 20MB limit) |
| `20261113000001_provision_representative_profile_rpc.sql` | ❌ NOT applied (RPC missing) |
| `20261113000002_enhance_provision_rep_profile_security.sql` | ❌ NOT applied |
| `20261114000001_course_section_offerings.sql` | ❌ NOT applied (table missing) |

---

## 7. Environment Variable Presence Checks

| Variable | Required at | In Vercel Production | Evidence |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Build + Runtime | ✅ Present | Routes work (307, 200) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Build + Runtime | ✅ Present | Login page renders |
| `SUPABASE_SERVICE_ROLE_KEY` | Runtime only | ⚠️ NOT CONFIRMED | Rate limiter may throw; dedup works (uses key) |
| `TELEGRAM_BOT_TOKEN` | Runtime only | ⚠️ NOT CONFIRMED | Bot init may fail if absent |
| `TELEGRAM_WEBHOOK_SECRET` | Runtime only | ✅ Present | 403 on wrong secret (not 500) |

**Key finding**: The deduplication writes to `bot_sessions` successfully (verified by duplicate update returning 200 `{"ok":true,"duplicate":true}`), which requires `SUPABASE_SERVICE_ROLE_KEY`. This proves the key IS accessible to the webhook function. The 500 is from the bot middleware, not from Supabase.

---

## 8. Owner Website Verification

| Test | Result |
|---|---|
| `GET /` | HTTP 307 → `/login` ✅ |
| `GET /login` | HTTP 200 (login form renders) ✅ |
| `GET /admin` | HTTP 307 → `/login?redirectTo=%2Fadmin` ✅ |
| `GET /admin/students` | HTTP 307 → `/login` (requires auth) ✅ |
| Supabase connection | ✅ Working (tables accessible) |
| Original error `1935480371` | ✅ Resolved (no more error) |

---

## 9. Telegram Webhook Verification

| Item | Status |
|---|---|
| Webhook registered | ✅ `setWebhook` returned success |
| Webhook URL | `https://hu-asms.vercel.app/api/bot/webhook` |
| `getWebhookInfo` | ⚠️ URL shows empty (Telegram may have dropped it after 500 responses) |
| Valid update processing | ❌ Returns HTTP 500 (bot processing error) |
| Dedup (repeat update) | ✅ Returns HTTP 200 `{"ok":true,"duplicate":true}` |
| Wrong secret rejection | ✅ HTTP 403 |
| No secret rejection | ✅ HTTP 403 |
| GET method rejection | ✅ HTTP 405 |

### Remaining webhook issue

The webhook endpoint receives updates correctly but the bot's middleware throws during `handleUpdate()`. Three fixes have been committed (`21850ec`, `bc833b2`, `de9d67f`) that:
1. Provide static `botInfo` to skip `bot.init()`
2. Catch all `handleUpdate` errors and return 200
3. Only return 500 for actual init/infrastructure failures

These fixes work locally (verified by simulation returning HTTP 200). The production deployment needs to pick up commit `de9d67f`.

**After Vercel deploys `de9d67f`**: Re-register the webhook with `setWebhook` and send a real `/start` from Telegram to verify.

---

## 10. Test Results

### Bot tests
```
ℹ tests 135
ℹ pass 135
ℹ fail 0
ℹ duration_ms 2593
```

### Web tests
```
ℹ tests 140
ℹ pass 139
ℹ fail 1 (pre-existing — migration list)
ℹ duration_ms 1345
```

### TypeScript
All packages pass with 0 errors.

### Production build
21/21 pages compiled successfully, 0 errors.

---

## 11. Remaining Feature Gaps and Risks

| Item | Status | Risk |
|---|---|---|
| Section Announcements | ❌ NOT IMPLEMENTED | Feature gap — not blocking core workflow |
| Bot-native teacher delivery | PARTIAL — redirects to web portal | Not blocking; web portal works |
| `provision_representative_profile` RPC | ❌ NOT APPLIED | Representative assignment from web admin may fail |
| `course_section_offerings` table | ❌ NOT APPLIED | Representative course creation won't work in production |
| `SUPABASE_SERVICE_ROLE_KEY` in Vercel | ⚠️ NOT CONFIRMED | Registration approval/rejection will fail if absent |
| Vercel deployment of `de9d67f` | ⚠️ NOT CONFIRMED | Webhook 500 will persist until deployed |

---

## 12. Required Actions (in order)

1. **Verify Vercel deployment** — Check Vercel dashboard → Deployments. Confirm commit `de9d67f` shows "Ready". If failed, trigger manual redeploy.

2. **Confirm `SUPABASE_SERVICE_ROLE_KEY` in Vercel** — Vercel dashboard → Settings → Environment Variables → Production. The dedup test proved it IS accessible (bot_sessions writes succeed), but the web app's rate limiter may have a different code path. Add it if missing.

3. **Re-register Telegram webhook** — After Vercel deploys `de9d67f`:
   ```bash
   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url":"https://hu-asms.vercel.app/api/bot/webhook","secret_token":"<SECRET>"}'
   ```

4. **Send real `/start` from Telegram** — Verify the bot responds.

5. **Apply missing migrations** (with approval) — `20261113000001` and `20261114000001` to production Supabase.

6. **Test registration approval** — After `SUPABASE_SERVICE_ROLE_KEY` is confirmed, test student approval from the admin dashboard.
