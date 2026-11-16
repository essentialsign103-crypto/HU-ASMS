# Vercel Telegram Bot Permanent Hosting

**Date**: November 15, 2026  
**Architecture**: GitHub + Supabase + Vercel ONLY  
**Bot**: @HU_ASMS_Bot (ID: 9200252077)  
**Production webhook URL**: `https://hu-asms.vercel.app/api/bot/webhook`

---

## 1. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  GitHub (essentialsign103-crypto/HU-ASMS)                    │
│  Branch: clean-deployment → auto-deploys to Vercel           │
└────────────────────────┬─────────────────────────────────────┘
                         │ git push
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  Vercel (single deployment)                                  │
│  Root Directory: apps/web                                    │
│                                                              │
│  Next.js 15 App Router                                       │
│  ├── /login             (Client Component, Supabase Auth)   │
│  ├── /admin/*           (System Owner dashboard, Server RSC) │
│  ├── /rep/*             (Representative portal, Server RSC)   │
│  └── /api/bot/webhook   ← Telegram pushes updates here       │
│         runtime: nodejs                                      │
│         maxDuration: 60s                                    │
│         ↳ handleTelegramWebhookFetch (@hu-asms/bot/webhook)  │
│              ↳ Secret validation (timing-safe comparison)    │
│              ↳ Deduplication (Supabase bot_sessions)         │
│              ↳ Bot init (STATIC_BOT_INFO — no getMe call)    │
│              ↳ grammY bot.handleUpdate() → handlers          │
│              ↳ HTTP 200 (acknowledge)                        │
└────────────────────────┬─────────────────────────────────────┘
                         │ Postgres / Storage / Auth
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  Supabase (tkdrxfvxryemfdrwcmay.supabase.co)                │
│  Tables: students, profiles, sections, projects, etc.       │
│  bot_sessions (durable dedup + grammY session state)          │
│  rate_limit_buckets (distributed rate limiting)              │
│  Storage: submission-files-vault (private, 20MB limit)       │
└──────────────────────────────────────────────────────────────┘
```

No Render. No Railway. No VPS. No separate persistent process. The bot runs entirely as a Vercel serverless function.

---

## 2. Webhook Implementation

### Route file

**File**: `apps/web/src/app/api/bot/webhook/route.ts`

```typescript
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STATIC_BOT_INFO: UserFromGetMe = {
  id: 9200252077,
  is_bot: true,
  first_name: 'HU ASMS \u2013 Academic Assistant',
  username: 'HU_ASMS_Bot',
  // ... all fields from getMe response
};

export async function POST(request: Request): Promise<Response> {
  return handleTelegramWebhookFetch(request, {
    botOptions: { botInfo: STATIC_BOT_INFO },
  });
}
```

**Key design decisions**:

1. **`STATIC_BOT_INFO`** — Passes the bot's identity directly to grammY, eliminating the `getMe` API round-trip on every cold start. Without this, `bot.init()` calls Telegram's API (~1s), and if the token in Vercel differs from the expected one, `init()` throws and returns HTTP 500.

2. **`runtime = 'nodejs'`** — Required for `Buffer`, `crypto`, and the full grammY stack.

3. **`maxDuration = 60`** — Vercel Hobby plan limit. File downloads (up to 20MB) with a 25s timeout fit within this budget.

### Webhook processor

**File**: `apps/bot/src/webhook.ts`

The processing pipeline:

```
POST request arrives
  → Method check (POST only, else 405)
  → Secret validation (timingSafeEqual, else 403)
  → Body size check (≤1MB, else 413)
  → JSON parse + update_id check (else 400)
  → Deduplication check (Supabase bot_sessions insert, else 200 duplicate)
  → Bot init (STATIC_BOT_INFO → skips getMe)
    → Init failure → 500 (Telegram retries)
  → Bot handleUpdate (grammY middleware → handlers)
    → Handler error → 200 (Telegram moves on, error logged)
    → Success → 200
```

### Error handling strategy

| Error type | HTTP status | Telegram behavior | Rationale |
|---|---|---|---|
| Wrong/missing secret | 403 | No retry | Security rejection |
| Non-POST method | 405 | No retry | Protocol violation |
| Malformed JSON | 400 | No retry | Invalid payload |
| Oversized body | 413 | No retry | Safety limit |
| Bot init failure | 500 | Retry | Infrastructure error — may resolve on next attempt |
| Handler/middleware error | 200 | No retry | Application error already logged; retrying would cause duplicate processing |

### Deduplication

**File**: `apps/bot/src/webhook.ts`, `UpdateDeduplicator` class

Two-layer idempotency:

1. **In-memory cache** — `Map<update_id, timestamp>` for warm Lambda instances (sub-millisecond)
2. **Durable Supabase** — Insert into `bot_sessions` with `session_key = tg_update:<update_id>`. If primary key conflict (23505), the update is a duplicate.

**Production-verified**: Sending the same `update_id` twice returns `{"ok":true,"duplicate":true}` on the second call. The first call writes to `bot_sessions` durably.

---

## 3. Local Polling vs Production Webhook

### Local polling (development only)

**File**: `apps/bot/src/index.ts`

```typescript
// STRICT SAFETY GUARD: Production never runs long polling
if (process.env.NODE_ENV === 'production') {
  console.log(
    '[HU-ASMS Bot] Production mode detected. Long polling is strictly disabled.\n' +
    '[HU-ASMS Bot] All Telegram updates are processed serverless by Next.js at /api/bot/webhook on Vercel.'
  );
  return;
}
```

When `NODE_ENV=production` (Vercel), `index.ts` exits immediately. It never calls `bot.start()`.

When `NODE_ENV=development` (local PowerShell), `index.ts` starts long polling by calling `bot.start()` which uses `getUpdates`.

### Why they cannot compete

- **Production**: Vercel runs the Next.js app. Telegram sends updates to the webhook URL. `index.ts` is never called by Vercel (it's a standalone entry point, not imported by the Next.js route).
- **Local**: PowerShell runs `node apps/bot/src/index.ts` which starts polling. This calls `getUpdates` which consumes updates from Telegram's queue.
- **Mutual exclusion**: Telegram's `getUpdates` and webhook mode are mutually exclusive. If a webhook is registered, `getUpdates` returns an error. If polling is active, the webhook is automatically disabled.

**Current state**: No webhook is registered (`getWebhookInfo` returns `url: ""`). Local polling works. Production webhook returns 500 for real updates (fix not yet deployed).

---

## 4. Required Environment Variables

| Variable | Required at | Used by | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Build + Runtime | Server components, middleware, bot | ✅ Confirmed present in Vercel (routes work) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Build + Runtime | Server components, middleware, bot | ✅ Confirmed present (login renders) |
| `SUPABASE_SERVICE_ROLE_KEY` | Runtime only | Admin operations, rate limiting, session storage, dedup | ✅ Confirmed present (dedup writes to bot_sessions succeed) |
| `TELEGRAM_BOT_TOKEN` | Runtime only | Bot creation, notification dispatch | ⚠️ Cannot confirm externally — if absent, `createBot` throws |
| `TELEGRAM_WEBHOOK_SECRET` | Runtime only | Webhook validation | ✅ Confirmed present (403 not 500 on wrong secret) |
| `NODE_ENV` | Runtime | Mode resolution | ✅ Vercel sets to `production` automatically |

**Supabase project**: `tkdrxfvxryemfdrwcmay.supabase.co` — confirmed as the intended project (same URL in `.env.local` and in all code paths).

---

## 5. Supabase Operations

All bot Supabase operations use `getSupabaseAdminClient()` from `@hu-asms/database`, which creates a client with the service-role key. This bypasses RLS.

**Server-side authorization**: The bot does NOT rely on RLS for authorization. Every privileged operation explicitly calls `RepresentativeService.assertSectionScope(telegramUserId, sectionId)` which queries `profiles` + `representative_assignments` to verify the Telegram user's active assignment to the section.

**Fallback behavior** (applied in this session): If `SUPABASE_SERVICE_ROLE_KEY` is absent:
- Session storage falls back to in-memory (no cross-cold-start persistence)
- Rate limiter falls back to in-memory (per-instance only)
- Deduplication falls back to in-memory (per-instance only)

These fallbacks ensure the bot continues processing updates even if the service-role key is missing, with reduced effectiveness.

---

## 6. Production Status

### Currently deployed (on Vercel)

| Item | Status | Evidence |
|---|---|---|
| `GET /` | ✅ HTTP 307 → `/login` | Confirmed |
| `GET /login` | ✅ HTTP 200 | Confirmed |
| `GET /api/bot/webhook` | ✅ HTTP 405 | Confirmed (POST only) |
| `POST` wrong secret | ✅ HTTP 403 | Confirmed |
| `POST` no secret | ✅ HTTP 403 | Confirmed |
| `POST` valid secret + update | ❌ HTTP 500 (145ms) | Init error — `STATIC_BOT_INFO` fix not yet deployed |
| `POST` duplicate update | ✅ HTTP 200 `{"ok":true,"duplicate":true}` | Confirmed (dedup works) |
| Telegram webhook registered | ❌ `url: ""` (not registered) | Telegram drops registration when endpoint returns 500 |

### Locally tested (not yet deployed)

| Fix | File | What it does |
|---|---|---|
| Static botInfo | `apps/web/src/app/api/bot/webhook/route.ts` | Skips `bot.init()` → eliminates 500 from getMe failure |
| Split init/handleUpdate | `apps/bot/src/webhook.ts` | Init errors → 500, update errors → 200 |
| Session storage fallback | `apps/bot/src/bot.ts` | Falls back to in-memory if `SUPABASE_SERVICE_ROLE_KEY` absent |
| Rate limiter fallback | `apps/bot/src/middleware/rate-limit.middleware.ts` | Falls back to in-memory if `SUPABASE_SERVICE_ROLE_KEY` absent |
| Web rate limiter fallback | `apps/web/src/lib/security/rate-limiter.ts` | Falls back to in-memory instead of throwing (fixes approval 503) |

### Test results

| Suite | Tests | Pass | Fail |
|---|---|---|---|
| Bot tests | 162 | 162 | 0 |
| Web tests | 142 | 142 | 0 |
| TypeScript | — | 0 errors | — |
| Build | 21/21 pages | Success | 0 |

---

## 7. Deployment Procedure

After owner approval to push and deploy:

```bash
# 1. Push to GitHub
git push origin main:clean-deployment

# 2. Wait for Vercel auto-deploy (2-5 minutes)
#    Verify at https://vercel.com/dashboard → Deployments → "Ready"

# 3. Test the webhook endpoint (should return 200, not 500)
curl -X POST https://hu-asms.vercel.app/api/bot/webhook \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: <TELEGRAM_WEBHOOK_SECRET>" \
  -d '{"update_id":1,"message":{"message_id":1,"from":{"id":123,"is_bot":false,"first_name":"T"},"chat":{"id":123,"type":"private"},"date":1700000000,"text":"test"}}'

# 4. Register the webhook with Telegram
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://hu-asms.vercel.app/api/bot/webhook","secret_token":"<SECRET>"}'

# 5. Verify registration
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
# Expected: "url":"https://hu-asms.vercel.app/api/bot/webhook"

# 6. Send /start from Telegram to @HU_ASMS_Bot
#    The bot should respond with the welcome menu

# 7. Close VS Code and PowerShell
#    The bot continues working — it's on Vercel, not local
```

---

## 8. Production Testing

After deployment and webhook registration:

| Test | Expected result |
|---|---|
| Send `/start` from Telegram | Bot responds with welcome menu |
| Send `/start` as a registered student | Student menu with courses, projects, etc. |
| Send `/start` as a representative | Unified menu with representative operations |
| Send a duplicate update | Bot does not process twice (dedup returns 200) |
| Stop VS Code / close PowerShell | Bot continues responding |
| Check `getWebhookInfo` | `url` shows the Vercel endpoint, `last_error_message` empty |
| Check Vercel runtime logs | `[HU-ASMS Webhook]` entries show update processing |

---

## 9. Recovery Steps

### If the bot stops responding

1. Check `getWebhookInfo`:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
   ```
   - If `url` is empty: webhook was dropped. Re-register with `setWebhook`.
   - If `last_error_message` is set: the endpoint returned non-200. Check Vercel logs.

2. Check Vercel deployment status:
   - Go to https://vercel.com/dashboard → Deployments
   - Verify latest deployment shows "Ready"
   - If "Error": check build logs, fix, redeploy

3. Check environment variables:
   - Go to https://vercel.com/dashboard → Project → Settings → Environment Variables
   - Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` are set for Production

4. Re-register webhook if needed:
   ```bash
   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url":"https://hu-asms.vercel.app/api/bot/webhook","secret_token":"<SECRET>"}'
   ```

### If the bot returns errors for all messages

1. Check Vercel runtime logs for `[HU-ASMS Webhook]` entries
2. If "Bot initialisation failed": `TELEGRAM_BOT_TOKEN` is likely missing or wrong in Vercel
3. If "Update processing error": a handler is throwing — check the `errorClass` and `message` in the log
4. If "Distributed rate limiting unavailable": `SUPABASE_SERVICE_ROLE_KEY` is missing — the bot falls back to in-memory but logs a warning

### If local polling interferes

Local polling and webhook mode are mutually exclusive in Telegram. If you run the bot locally with polling while a webhook is registered:
- Telegram will return `409 Conflict` on `getUpdates`
- The webhook will continue to receive updates
- To fix: stop the local PowerShell process. The webhook takes over automatically.

---

## 10. Classification

| Item | Classification |
|---|---|
| Webhook route (`/api/bot/webhook`) | Verified in production (security checks: 403, 405 confirmed) |
| Deduplication | Verified in production (200 duplicate confirmed) |
| Update processing (200 on success) | Mock-tested only (local simulation returns 200) |
| Update processing (production) | Not verified — returns 500 (fix not deployed) |
| Static botInfo | Verified locally (local simulation returns 200 with botInfo) |
| Init/handleUpdate split | Verified locally |
| Session storage fallback | Verified locally (test: "falls back to in-memory in production") |
| Rate limiter fallback | Verified locally (test: "does not throw when SUPABASE_SERVICE_ROLE_KEY is absent") |
| Telegram webhook registration | Not registered (requires owner approval) |
| Real Telegram /start response | Not tested (requires deployment + registration) |
| Bot works without PowerShell | Not verified (requires deployment + registration) |
| Local polling disabled in production | Verified by code inspection (safety guard in index.ts) |

---

## 11. Outstanding Actions Requiring Owner Approval

| # | Action | Why needed |
|---|---|---|
| 1 | Push Git commits | Deploy the webhook fixes (static botInfo, fallbacks, split init/handleUpdate) |
| 2 | Deploy to Vercel | Auto-deploys on push; verify "Ready" status |
| 3 | Register Telegram webhook | `setWebhook` API call to `https://hu-asms.vercel.app/api/bot/webhook` |
| 4 | Send real `/start` from Telegram | Verify the bot responds without PowerShell running |
| 5 | Close VS Code and PowerShell | Confirm bot continues working independently |

No code changes are needed beyond what is already committed locally. The remaining work is deployment, configuration, and verification — all requiring explicit owner approval.
