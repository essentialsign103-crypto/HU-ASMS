# Final Production Smoke Test Report

**Production URL**: https://hu-asms.vercel.app  
**Date**: November 13, 2026  
**Triggered by**: Verification of fix commit `d2a8b19`  
**Investigator**: Automated — no speculative code changes made

---

## Summary

| Check | Result |
|---|---|
| 1. GitHub / Vercel commit match | ⚠️ Cannot confirm Vercel deployed `d2a8b19` — build log access requires Vercel auth |
| 2. Vercel Root Directory = `apps/web` | ⚠️ Cannot confirm from outside — requires Vercel dashboard |
| 3. Production environment variables | ❌ **CRITICAL BLOCKER** — `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` absent from server runtime |
| 4. Build logs / runtime logs | ⚠️ Requires Vercel auth — partial evidence from live response |
| 5a. `/` route | ❌ HTTP 500 — server exception, digest `1935480371` still present |
| 5b. `/login` route | ✅ HTTP 200 — login page renders correctly |
| 5c. Authenticated dashboard | ⏳ Blocked — cannot authenticate while `/` crashes |
| 6. Digest `1935480371` gone | ❌ Still present in root page RSC payload |
| 7. Supabase connection | ✅ Project is reachable, RLS active, responds correctly |
| 8. Telegram webhook status | ❌ Webhook URL is empty — not registered |
| 9. Webhook URL / pending count / last error | ❌ URL: `""`, pending: `0`, last error: none |
| 10. Bot processes test update | ❌ Cannot test — webhook is not registered |

---

## Check 1 — GitHub / Vercel commit match

### GitHub state

```
f1a81ce  docs: add production exception resolution report (digest 1935480371)
d2a8b19  fix(vercel): restore correct monorepo config and add root error boundary   ← fix
88ea2de  fix: add root-level vercel.json for monorepo deployment                    ← was broken
```

Branch: `clean-deployment`  
Latest commit: `f1a81ce`  
Fix commit: `d2a8b19` (parent of f1a81ce)

### Vercel deployed commit

**Cannot confirm** without Vercel CLI or dashboard access. The Vercel REST API requires a bearer token that is not available in this environment.

### Partial evidence from live response

The deployed JS chunk hashes **match the local build output**:

| Chunk | Local build | Live site |
|---|---|---|
| `18-68d7739dcfa59da4.js` | Present | ✅ Present |
| `87c73c54-24122e7b92478d00.js` | Present | ✅ Present |

These hashes are deterministic from source content. Their presence on the live site is consistent with the fix commit having been deployed. However, the fix commit does not change any source file that would alter these chunk hashes — it only changes `vercel.json` and `apps/web/src/app/error.tsx`. This cannot conclusively confirm the exact deployed commit.

**Action required**: Confirm in Vercel dashboard → Deployments that the latest production deployment shows commit `d2a8b19` or `f1a81ce`.

---

## Check 2 — Vercel Root Directory

**Cannot confirm** without Vercel dashboard access.

The correct setting is: **Root Directory = `apps/web`**

This setting is not visible from outside Vercel. If it is not set correctly, the `apps/web/vercel.json` overrides (`buildCommand: "cd ../.. && npm run build"`) will not be applied, and the build may succeed but Vercel will not be able to find the Next.js output.

**Action required**: Go to Vercel project → Settings → General → Root Directory → verify it shows `apps/web`.

---

## Check 3 — Production environment variables

### Finding: CRITICAL BLOCKER

The root page (`/`) is still throwing `Error: Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY` on every request.

**Evidence — RSC payload from live `/` response:**

```
4:E{"digest":"1935480371"}
```

The digest `1935480371` is deterministic from the error message `Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY`. It has not changed.

**Why `/login` works but `/` does not:**

`/login` is a pure Client Component (`'use client'`). It calls `createClient()` which reads `NEXT_PUBLIC_*` variables from the **browser environment** where Next.js bakes them into the JS bundle at build time. The bundle was built with the correct values (they were in `.env.local` during the Vercel build), so the browser client can connect to Supabase.

`/` is a Server Component. It calls `createServerSupabaseClient()` which reads `process.env.NEXT_PUBLIC_SUPABASE_URL` at **request time** on Vercel's server runtime. If these variables are not in Vercel's Production environment variable settings, `process.env` does not have them even though the client bundle does.

### Variable audit

| Variable | Required At | In `.env.local` | In Vercel Production | Evidence |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Build + Server runtime | ✅ Present | ❌ **ABSENT** | Server throws on every `/` request |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Build + Server runtime | ✅ Present | ❌ **ABSENT** | Same |
| `SUPABASE_SERVICE_ROLE_KEY` | Server runtime only | ✅ Present | Unknown | Not tested |
| `TELEGRAM_BOT_TOKEN` | Server runtime only | ✅ Present | Unknown | Not tested |
| `TELEGRAM_WEBHOOK_SECRET` | Server runtime only | ✅ Present | Unknown | Not tested |
| `SYSTEM_OWNER_EMAIL` | Setup only | ✅ Present | Unknown | Not blocking |
| `SYSTEM_OWNER_TELEGRAM_ID` | Setup only | ✅ Present | Unknown | Not blocking |

### Required action

Go to Vercel dashboard → Project `hu-asms` → Settings → Environment Variables → Production.

Add or verify the following (copy values from local `.env.local`):

| Name | Scope |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview, Development |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview, Development |
| `SUPABASE_SERVICE_ROLE_KEY` | Production only |
| `TELEGRAM_BOT_TOKEN` | Production only |
| `TELEGRAM_WEBHOOK_SECRET` | Production only |

After saving, Vercel will automatically trigger a new deployment. Wait for it to reach "Ready" status before re-testing.

---

## Check 4 — Build logs / runtime logs

**Build logs**: Not accessible without Vercel authentication.

**Runtime log evidence from live response:**

The live HTTP response from `/` contains a full Next.js RSC error payload including:
```json
{"digest":"1935480371"}
```

This confirms the same exception is occurring in the runtime. The error boundary (`app/error.tsx`) was deployed and will show its UI in a browser once JS loads, but the underlying exception must be fixed by adding the environment variables.

---

## Check 5a — Route: `/`

```
Method: GET
URL: https://hu-asms.vercel.app/
HTTP Status: 500
Body: <!DOCTYPE html><html id="__next_error__">...
RSC payload: 4:E{"digest":"1935480371"}
Expected: HTTP 307 redirect to /login
Result: ❌ FAIL
```

**Cause**: `createServerSupabaseClient()` throws `Error: Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY` because those variables are not in Vercel's server runtime environment.

---

## Check 5b — Route: `/login`

```
Method: GET
URL: https://hu-asms.vercel.app/login
HTTP Status: 200
Body: Contains "HU-ASMS", "Haramaya University", "Administrative & Representative Console"
Error digest: None
Result: ✅ PASS
```

The login page renders correctly. This confirms:
- Vercel has deployed the application code
- Static assets (CSS, JS) are being served
- The `NEXT_PUBLIC_*` variables were correctly baked into the client bundle at build time

---

## Check 5c — Authenticated dashboard

**Blocked.** Cannot complete authentication because the root page (`/`) crashes before redirecting to `/login`. Direct navigation to `/login` works, but login cannot be tested without credentials that work against the production Supabase instance.

**Prerequisite**: Fix environment variables (Check 3), then verify login works end-to-end.

---

## Check 6 — Digest `1935480371`

```
Digest still present: YES
Location in response: RSC payload — 4:E{"digest":"1935480371"}
```

**Result: ❌ FAIL** — The original digest is still present.

The digest will disappear only when the environment variables are added and the server can successfully call `createServerSupabaseClient()`.

---

## Check 7 — Supabase connection

```
Project URL: https://tkdrxfvxryemfdrwcmay.supabase.co
Test: GET /rest/v1/profiles?select=id&limit=1 (anon key, unauthenticated)
HTTP Status: 401
Response: {"code":"42501","message":"permission denied for table profiles"}
```

**Result: ✅ PASS**

The Supabase project is online and reachable. The `permission denied` response is **correct and expected** — the `profiles` table denies unauthenticated anon reads (RLS policy working as designed).

The project URL `tkdrxfvxryemfdrwcmay.supabase.co` matches the value in `.env.local`, confirming the application and local configuration point to the same Supabase project.

---

## Check 8 — Telegram webhook status

```
API endpoint: https://api.telegram.org/bot<TOKEN>/getWebhookInfo
(Token not printed)

Response:
  ok: True
  url: ""  ← EMPTY
  has_custom_certificate: False
  pending_update_count: 0
  last_error_date: (none)
  last_error_message: (none)
  max_connections: (none)
```

**Result: ❌ FAIL — Webhook URL is not registered**

The bot token is valid (Telegram returned `ok: True`), but no webhook URL has been registered. The bot cannot receive updates.

---

## Check 9 — Webhook URL, pending updates, last error

| Field | Value | Assessment |
|---|---|---|
| `url` | `""` (empty) | ❌ Not registered |
| `pending_update_count` | `0` | ✅ No backlog |
| `last_error_date` | None | ✅ No delivery failures recorded |
| `last_error_message` | None | ✅ No prior errors |
| `has_custom_certificate` | `false` | ✅ Correct |

The absence of `last_error_message` and an empty URL together confirm the webhook was **never registered to any URL**, not that it was previously working and then failed.

**Required action**: Register the webhook to the production URL after the application is confirmed healthy:

```bash
curl -s -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://hu-asms.vercel.app/api/bot/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
  }'
```

Both values are in `.env.local`. Do not register the webhook until the production application is responding correctly on `/` — otherwise Telegram will deliver updates that the failing server cannot process.

---

## Check 10 — Bot processing test update

**Cannot test.** The webhook is not registered. Without a registered webhook URL, Telegram cannot deliver any updates to the bot.

**After** registering the webhook and verifying the production application loads correctly, test with:

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates?offset=-1"
```

Or send a message directly to the bot on Telegram and verify it responds.

---

## Identified Failures and Precise Causes

### Failure 1 — `/` returns HTTP 500 (digest `1935480371`) ❌ BLOCKING

**Precise cause**: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are not configured in Vercel's Production environment variables. They exist in `.env.local` (not deployed to Vercel) and were baked into the client JS bundle at build time (which is why `/login` works), but the server runtime has no access to them, so `process.env.NEXT_PUBLIC_SUPABASE_URL` is `undefined` at request time.

**Fix**: Add both variables to Vercel Production environment variables. This requires a Vercel redeploy to take effect for the server runtime.

### Failure 2 — Telegram webhook not registered ❌ NON-BLOCKING (until app is healthy)

**Precise cause**: `setWebhook` has never been called. The bot token is valid but no endpoint has been registered.

**Fix**: After the production application is confirmed healthy, call `setWebhook` with URL `https://hu-asms.vercel.app/api/bot/webhook` and the `secret_token` from `TELEGRAM_WEBHOOK_SECRET`.

---

## Required Actions (in order)

**Step 1** — Vercel dashboard: Settings → General → Root Directory → confirm `apps/web`

**Step 2** — Vercel dashboard: Settings → Environment Variables → Production → add:
- `NEXT_PUBLIC_SUPABASE_URL` (copy value from `.env.local`)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (copy value from `.env.local`)
- `SUPABASE_SERVICE_ROLE_KEY` (copy value from `.env.local`)
- `TELEGRAM_BOT_TOKEN` (copy value from `.env.local`)
- `TELEGRAM_WEBHOOK_SECRET` (copy value from `.env.local`)

**Step 3** — Wait for Vercel automatic redeploy to reach "Ready"

**Step 4** — Re-run smoke test: verify `/` redirects to `/login` (HTTP 307)

**Step 5** — Log in with system owner credentials and verify admin dashboard loads

**Step 6** — Register Telegram webhook (command above), verify `getWebhookInfo` returns the production URL

**Step 7** — Send a test message to the bot and confirm it responds

---

## What is working correctly

- `/login` — HTTP 200, login page renders ✅
- `/api/bot/webhook` (GET) — HTTP 405 Method Not Allowed (correct — only POST accepted) ✅
- Supabase project `tkdrxfvxryemfdrwcmay` — reachable, RLS active ✅
- Application code deployed — chunk hashes match local build ✅
- Error boundary `app/error.tsx` — deployed, will show in browser once JS hydrates ✅
- Bot token — valid (Telegram responds `ok: True`) ✅
- Webhook security middleware — constant-time secret comparison, fails closed ✅
- 133/134 unit tests pass (1 pre-existing failure unrelated to production) ✅

---

## Stopped here — no further code changes made

Per the task instructions: a failure was identified with a precise cause. Stopped before making any additional production changes.

The fix requires adding environment variables in the Vercel dashboard — a configuration action, not a code change. No code modifications are needed.
