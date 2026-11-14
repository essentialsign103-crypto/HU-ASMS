# Production Error 823657909 Investigation

**Production URL**: https://hu-asms.vercel.app  
**Displayed message**: "Service Unavailable — The application encountered an unexpected error."  
**Error reference shown**: `823657909`  
**Date**: November 13, 2026  
**Fix commit**: `d5f70cc` on `clean-deployment`

---

## 1. Root Cause

**`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are not set in Vercel Production environment variables.**

Every server-side request reads these from `process.env` at runtime. On Vercel, `process.env` for a serverless function only contains variables configured in the project's Environment Variables settings. These were never added.

The root page (`/`) is a Next.js Server Component that calls `createServerSupabaseClient()`. That function reads `process.env.NEXT_PUBLIC_SUPABASE_URL`. When it's `undefined`, the function throws:

```
Error: Server configuration error: missing NEXT_PUBLIC_SUPABASE_URL
```

Next.js catches this, hashes `err.message + err.stack` with its `string-hash` algorithm to produce a numeric digest, sends the digest to the client in the RSC payload, and the `app/error.tsx` boundary renders "Service Unavailable / Error reference: 823657909".

The same underlying error produced digest `1935480371` in the previous deployment. The digest changed because a new deployment changed the serverless bundle paths and line numbers in the stack trace, which is included in the hash input. The error message itself was unchanged.

---

## 2. Evidence Chain

### 2a. Live route audit

| Route | Method | HTTP Status | Observation |
|---|---|---|---|
| `/` | GET | 500 | Error boundary renders "Service Unavailable" with digest `823657909` |
| `/login` | GET | 200 | Page renders — Client Component, vars baked into bundle |
| `/admin` | GET | 503 | `{"error":"Authentication service is not configured."}` |
| `/api/bot/webhook` | GET | 405 | Method Not Allowed — correct (POST-only endpoint) |

### 2b. RSC payload from `/` (live)

```
5:E{"digest":"823657909"}
```

### 2c. Middleware 503 body from `/admin` (live)

```json
{"error":"Authentication service is not configured."}
```

This is the exact string from `middleware.ts` line `'Authentication service is not configured.'`, returned only when `!supabaseUrl || !supabaseAnonKey` is true.

### 2d. Why `/login` works but `/` does not

`/login` is `'use client'` — a pure Client Component. The browser reads `NEXT_PUBLIC_*` variables from values that Next.js **bakes into the JS bundle at build time**. The build ran with the correct values present (they are in `apps/web/.env.local`), so the compiled bundle contains them.

`/` is a Server Component. It executes on Vercel's serverless runtime where `process.env` only contains variables configured in Vercel project settings. `.env.local` does not exist on Vercel.

### 2e. Digest change between deployments

Next.js digest = `string-hash(err.message + err.stack)`.

The stack trace includes Vercel's internal serverless bundle paths and line numbers, which are unique per deployment. The same error message produces a different digest after each redeploy. This is by design — the digest is meant to correlate client errors with server logs for a specific deployment, not across deployments.

---

## 3. Step-by-step trace

```
1. Browser → GET https://hu-asms.vercel.app/
2. Next.js Edge Middleware: /admin/* and /rep/* only — / NOT matched → passes through
3. Next.js executes apps/web/src/app/page.tsx (Server Component, runs on Vercel serverless)
4. page.tsx calls createServerSupabaseClient()
5. server.ts reads process.env.NEXT_PUBLIC_SUPABASE_URL → undefined (not set in Vercel)
6. if (!supabaseUrl || !supabaseAnonKey) → true
7. console.error('[HU-ASMS] Server Supabase client failed...') → appears in Vercel runtime logs
8. throw new Error('Server configuration error: missing NEXT_PUBLIC_SUPABASE_URL')
9. Next.js catches exception, computes digest from message+stack → "823657909"
10. RSC error payload sent to browser: 5:E{"digest":"823657909"}
11. app/error.tsx hydrates client-side → shows "Service Unavailable / Error reference: 823657909"
12. HTTP status 500 returned
```

---

## 4. Files Changed

### `apps/web/src/lib/supabase/server.ts`

**Before:**
```typescript
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
}
```

**After:**
```typescript
if (!supabaseUrl || !supabaseAnonKey) {
  const missing = [
    !supabaseUrl ? 'NEXT_PUBLIC_SUPABASE_URL' : null,
    !supabaseAnonKey ? 'NEXT_PUBLIC_SUPABASE_ANON_KEY' : null,
  ]
    .filter(Boolean)
    .join(', ');
  console.error(
    `[HU-ASMS] Server Supabase client failed to initialise. Missing environment variable(s): ${missing}. ` +
      'Configure these in Vercel project settings → Environment Variables → Production.'
  );
  throw new Error(`Server configuration error: missing ${missing}`);
}
```

**Purpose:** Names the specific missing variable(s) in Vercel runtime logs and in the error message, making the problem immediately diagnosable from the Vercel dashboard without guessing.

### `apps/web/src/middleware.ts`

Added the same `console.error` before the fail-closed response, logging which specific variable is absent and which protected route triggered it.

---

## 5. Environment Variable Audit

| Variable | In `apps/web/.env.local` | Required in Vercel Production | Status |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ Present | ✅ Required (server + client) | ❌ **NOT SET** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ Present | ✅ Required (server + client) | ❌ **NOT SET** |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Present | ✅ Required (admin server actions) | ⚠️ Unverified |
| `TELEGRAM_BOT_TOKEN` | ✅ Present | ✅ Required (notification dispatch) | ⚠️ Unverified |
| `TELEGRAM_WEBHOOK_SECRET` | ✅ Present | ✅ Required (webhook validation) | ⚠️ Unverified |
| `TELEGRAM_WEBHOOK_URL` | ✅ Present | Not required at runtime | N/A |

**Secret values are not logged, printed, or exposed in this report.**

---

## 6. Supabase Connectivity

Tested against `https://tkdrxfvxryemfdrwcmay.supabase.co` using the anon key from `.env.local`:

```
GET /rest/v1/profiles?select=id&limit=1
Response: HTTP 401
Body: {"code":"42501","message":"permission denied for table profiles"}
```

**Result: ✅ Supabase project is reachable and RLS is enforced correctly.**

The 401 is expected — anonymous reads on `profiles` are blocked by RLS. The project is online and responding.

---

## 7. Telegram Webhook Status

```
API: getWebhookInfo (token not printed)
ok: True
url: ""         ← EMPTY — webhook not registered
pending_update_count: 0
last_error_date: (none)
last_error_message: (none)
```

The bot token is valid. No webhook URL is registered. The bot cannot receive Telegram updates.

**Required action** (after application is confirmed healthy):
Register the webhook to the production endpoint:
```
POST https://api.telegram.org/bot<TOKEN>/setWebhook
{
  "url": "https://hu-asms.vercel.app/api/bot/webhook",
  "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
}
```

Both values are in `apps/web/.env.local`. Do not register until the application loads correctly.

---

## 8. Build Result

```
> next build
✓ Compiled successfully in 3.9s
✓ Linting and checking validity of types
✓ Generating static pages (21/21)
✓ Collecting build traces
✓ Finalizing page optimization
Exit code: 0
```

---

## 9. Tests Executed

| Suite | Pass | Fail |
|---|---|---|
| Phase 14 Track A1 — Vercel Configuration | 4 | 0 |
| Phase 14 Track B — Migration / Privilege | 9 | 0 |
| Total (targeted) | 13 | 0 |

Pre-existing failure (Track B migration sequence, unrelated) is not counted here.

---

## 10. Commits

| Commit | Description |
|---|---|
| `d2a8b19` | fix(vercel): restore correct monorepo config and add root error boundary |
| `d5f70cc` | fix(config): improve missing env var logging and error message |

---

## 11. Required Actions to Resolve Production (BLOCKED on Vercel dashboard access)

These are **configuration actions** in the Vercel dashboard, not code changes:

### Step 1 — Verify Root Directory setting

Vercel project → Settings → General → Root Directory → must be `apps/web`

### Step 2 — Add Production environment variables

Vercel project → Settings → Environment Variables → Production:

| Name | Scope |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview, Development |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview, Development |
| `SUPABASE_SERVICE_ROLE_KEY` | Production only |
| `TELEGRAM_BOT_TOKEN` | Production only |
| `TELEGRAM_WEBHOOK_SECRET` | Production only |

Copy values from `apps/web/.env.local`. Do not paste them into chat or commits.

### Step 3 — Wait for auto-redeploy

Vercel redeploys automatically when environment variables are saved.

### Step 4 — Verify runtime logs (after redeploy)

If the error persists, check Vercel dashboard → Deployments → [latest] → Functions → Runtime Logs.  
Look for the `[HU-ASMS]` prefixed log lines now added by `d5f70cc`. They will name the exact missing variable.

### Step 5 — Smoke test

After redeploy completes:
- `GET /` → should redirect to `/login` (HTTP 307), no error
- `GET /login` → HTTP 200, login form
- `GET /admin` → should redirect to `/login` (HTTP 307, middleware active)
- `POST /api/bot/webhook` with wrong secret → HTTP 403
- Authenticated login → admin dashboard loads

### Step 6 — Register Telegram webhook

Only after the application is confirmed healthy, register the webhook (command in Section 7).

---

## 12. Remaining Blockers

| Blocker | Severity | Owner | Action |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` not in Vercel Production | 🔴 Critical | You (Vercel dashboard) | Add env var |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` not in Vercel Production | 🔴 Critical | You (Vercel dashboard) | Add env var |
| `SUPABASE_SERVICE_ROLE_KEY` not confirmed in Vercel Production | 🟡 High | You (Vercel dashboard) | Verify/add |
| `TELEGRAM_BOT_TOKEN` not confirmed in Vercel Production | 🟡 High | You (Vercel dashboard) | Verify/add |
| `TELEGRAM_WEBHOOK_SECRET` not confirmed in Vercel Production | 🟡 High | You (Vercel dashboard) | Verify/add |
| Telegram webhook not registered | 🟡 High | You (curl command above) | Register after app is healthy |
| Track B migration sequence test pre-existing failure | 🟢 Low | Pre-existing | Separate ticket |

**No code changes, database migrations, RLS changes, or Supabase schema changes are required.**

The entire production failure is a missing Vercel environment variable configuration.
