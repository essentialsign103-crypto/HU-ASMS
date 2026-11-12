# HU-ASMS — Vercel Deployment Readiness Report (Read-Only)

**Date:** 2026-11-12  
**Audit Mode:** Strictly read-only inspection (no Vercel deployment, no GitHub push, no Supabase mutations, zero secret values printed).  
**Final Recommendation:** **NOT READY** *(Production build & serverless webhook architecture pass cleanly locally, but Vercel project linkage/remote env vars are unverified locally, `20261112000003` migration is pending push, local remediation commits are not yet on `origin/clean-deployment`, and initial System Owner/webhook registration must follow deployment.)*

---

## 1. Supabase Status (`tkdrxfvxryemfdrwcmay`)
Inspected via `npx supabase migration list --remote`:
- **Remote Applied Migrations (`10`):**
  1. `20261110000001_initial_schema.sql`
  2. `20261110000002_row_level_security.sql`
  3. `20261110000003_storage_setup.sql`
  4. `20261110000004_delivery_items_rep_policy.sql`
  5. `20261110000005_security_hardening.sql`
  6. `20261111000001_track_b_rep_active_profile_guard.sql`
  7. `20261111000002_track_b_atomic_rpcs_and_db_parity.sql`
  8. `20261111000003_track_b_function_privilege_and_default_acl_hardening.sql`
  9. `20261112000001_critical_blockers_persistence_and_identity_hardening.sql`
  10. `20261112000002_minimum_deployment_blocker_fixes.sql`
- **Pending Local Forward Migration (`1`):**
  - `20261112000003_post_deployment_security_hardening.sql` (`remote = ""`) — staged locally and **not yet applied** awaiting authorization.
- **Database Data State:** `0` `auth.users`, `0` application rows, `'submission-files-vault'` private (`0` objects, currently `50 MB` until `20261112000003` aligns it to `20 MB`).

---

## 2. GitHub Branch & Commit Status
- **Remote (`origin`):** `https://github.com/essentialsign103-crypto/HU-ASMS.git`
- **Current Branch:** `clean-deployment` tracking `origin/clean-deployment` at commit `2d6cf60` (`0` ahead / `0` behind `origin/clean-deployment` in committed Git history).
- **Local Uncommitted Changes Not Yet on `origin/clean-deployment` (`git status --short`):**
  - `M apps/web/test/track-b-privilege-and-sql-hardening.test.ts` (updated migration file list & contract check for `20261112000003`)
  - `?? supabase/migrations/20261112000003_post_deployment_security_hardening.sql`
  - `?? docs/SUPABASE_PREFLIGHT_REPORT.md`
  - `?? docs/POST_DEPLOYMENT_SECURITY_AUDIT.md`
  - `?? docs/POST_DEPLOYMENT_SECURITY_REMEDIATION.md`
  - (`M apps/web/tsconfig.tsbuildinfo` touched locally during typecheck)
- **Status:** `origin/clean-deployment` does **not** yet contain the post-audit forward migration and test update.

---

## 3. Vercel Project & Connection Status
- **Vercel CLI:** Not installed globally or in repo (`where.exe vercel` / `npm list -g vercel` empty; `node_modules/.bin/vercel*` false).
- **Local Vercel Auth & Link State:** No `auth.json` under `%APPDATA%\com.vercel.cli\Data\`, and no `.vercel/` directory in repo root, `apps/web/`, or `apps/bot/`.
- **GitHub Repository / Branch Connection:** **Cannot be verified locally** without Vercel CLI login or Vercel Dashboard access. Before deploying, confirm in Vercel Dashboard that the Vercel project is connected to `essentialsign103-crypto/HU-ASMS`, production/preview branch matches `clean-deployment`, and **Root Directory** is explicitly set to `apps/web`.

---

## 4. Build Configuration & Local Production Build Result
- **Root `vercel.json`:** Intentionally absent (`false`), avoiding monorepo BOM/path conflicts.
- **Web `apps/web/vercel.json` ([`apps/web/vercel.json`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/vercel.json)):**
  - `framework`: `"nextjs"`
  - `installCommand`: `"cd ../.. && npm install"`
  - `buildCommand`: `"cd ../.. && npm run build"`
  - **Requirement:** Works **only** when Vercel Project Settings **Root Directory** is set to `apps/web` (so `cd ../..` lands on monorepo root and builds all 4 shared packages + `@hu-asms/bot` + `@hu-asms/web`).
- **Next.js Config ([`apps/web/next.config.mjs`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/next.config.mjs)):**
  - `outputFileTracingRoot`: monorepo root (`../..`)
  - `transpilePackages`: `['@hu-asms/types', '@hu-asms/validation', '@hu-asms/shared', '@hu-asms/database', '@hu-asms/bot']`
  - `webpack.resolve.extensionAlias`: maps `.js` -> `['.ts', '.tsx', '.js']` for workspace ESM TypeScript sources.
- **Local Production Build (`npm run build`):** **PASS (Exit `0`)**
  - All 6 workspaces compiled cleanly (`@hu-asms/types`, `@hu-asms/shared`, `@hu-asms/validation`, `@hu-asms/database`, `@hu-asms/bot`, `@hu-asms/web`).
  - `Next.js 15.5.29` compiled in `3.5s`, generated `21/21` routes (`/`, `/login`, `/admin/*`, `/rep/*`, `/api/auth/logout`, `/api/bot/webhook`) plus `95 kB` Edge Middleware.

---

## 5. Environment Variable Checklist (Names & Presence Only)

Inspected locally across `.env`, `.env.example`, `.env.local`, `apps/bot/.env`, and `process.env.*` call sites in code (zero values exposed; remote Vercel project env vars are unverified locally):

| Variable | Local Presence | Required in Vercel (`apps/web`)? | Usage & Configuration Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `<SET>` | **Required (All Envs)** | Used by browser client, Edge `middleware.ts`, SSR server client, `@hu-asms/database`, bot sessions, and rate limiters. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `<SET>` | **Required (All Envs)** | Used by browser client, Edge `middleware.ts`, and SSR server client. |
| `SUPABASE_SERVICE_ROLE_KEY` | `<SET>` | **Required (Server Only, Sensitive)** | Required in `NODE_ENV=production` for distributed rate limiting (`rate-limiter.ts`, `rate-limit.middleware.ts`), `SupabaseSessionStorage`, `redeem_student_verification_token`, and `'submission-files-vault'` uploads. **Must NEVER have `NEXT_PUBLIC_` prefix.** |
| `TELEGRAM_BOT_TOKEN` | `<SET>` | **Required (Server Only, Sensitive)** | Required by `POST /api/bot/webhook` (`@hu-asms/bot/webhook`) to initialize `Bot`, answer users, and call `getFile`. |
| `TELEGRAM_WEBHOOK_SECRET` | `<SET>` | **Required (Server Only, Sensitive)** | Checked against `X-Telegram-Bot-Api-Secret-Token` on `POST /api/bot/webhook`; returns HTTP `500` fail-closed if unset. |
| `NODE_ENV` | `<SET>` | Managed by Vercel (`production`) | Triggers fail-closed enforcement for persistent Postgres session storage and distributed Postgres rate limiting. |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Absent in `.env*` | Optional Fallback | Server code falls back to `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`. |
| `SUPABASE_STORAGE_BUCKET` | `<SET>` | Unused at Runtime | Runtime code hardcodes `'submission-files-vault'` via `SYSTEM_CONSTANTS.STORAGE_BUCKET_NAME`. Note minor template drift vs `.env.example`. |
| `TELEGRAM_WEBHOOK_URL` | `<SET>` | Unused by Vercel App | Read only by standalone `apps/bot/src/index.ts`; for Vercel, used externally when calling Telegram `setWebhook` (`https://<vercel-domain>/api/bot/webhook`). |
| `APP_BASE_URL` | `<SET>` | Informational Only | Not referenced in runtime application code. |
| `SYSTEM_OWNER_EMAIL` / `SYSTEM_OWNER_TELEGRAM_ID` | `<SET>` | Bootstrap Only | Not referenced in runtime code; used during initial System Owner Supabase Auth creation. |

---

## 6. Bot Deployment Requirements & Vercel Serverless Compatibility
- **Integrated Webhook Hosting (`apps/web`):** The Telegram bot is **NOT** meant to run via long polling inside Vercel and does **not** require a separate server when deployed on Vercel. Instead, [`apps/web/src/app/api/bot/webhook/route.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/api/bot/webhook/route.ts) exposes `POST /api/bot/webhook` (`export const runtime = 'nodejs'`, `export const dynamic = 'force-dynamic'`) calling `handleTelegramWebhookFetch(request)` from `@hu-asms/bot/webhook`.
  - Standalone [`apps/bot/src/index.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/index.ts) is only for local development polling or an optional standalone Node server.
- **Serverless Session & State Compatibility:**
  - **Sessions & Conversations:** `createBot()` resolves `SupabaseSessionStorage` backed by Postgres `public.bot_sessions` (`24h` TTL) whenever `SUPABASE_SERVICE_ROLE_KEY` + Supabase URL exist, and throws fail-closed if missing in `NODE_ENV=production`. `@grammyjs/conversations` replay state is persisted across cold starts and separate webhook invocations, isolated per user (`userId` in DM, `chatId:userId` in groups), and sensitive flows reject group chats via `requirePrivateChat`.
  - **Rate Limiting:** Both `apps/bot` and `apps/web` server actions use `check_and_increment_rate_limit` RPC backed by Postgres `public.rate_limit_buckets` in production (failing closed if unavailable). Note `MemoryRateLimiter` in `rate-limiter.ts` has a `setInterval` fallback only for non-production local dev.
  - **Auth Middleware:** [`apps/web/src/middleware.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/middleware.ts) uses `@supabase/ssr` cookie handlers compatible with Vercel Edge Runtime and queries `profiles.role` / `profiles.is_active` for `/admin` and `/rep` routes.
- **Operational Serverless Note (`maxDuration`):** `/api/bot/webhook` does not specify `export const maxDuration`. Because a single submission update can download up to `20 MB` from Telegram and upload to `eu-north-1` Supabase Storage, ensure Vercel Fluid Compute / sufficient function timeout (`>= 30s`) is active on the Vercel project rather than a strict `10s` cap.

---

## 7. Blockers Preventing Immediate Vercel Deployment
1. **Unverified / Unlinked Vercel Project & Remote Env Vars:** Vercel CLI is not installed or authenticated, and `.vercel/project.json` does not exist. Cannot verify repository link (`essentialsign103-crypto/HU-ASMS`), branch (`clean-deployment`), `Root Directory = apps/web`, or presence of all 5 required Vercel env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`) in Vercel Project Settings.
2. **Pending Supabase Forward Migration (`20261112000003`):** `20261112000003_post_deployment_security_hardening.sql` is staged locally (`remote = ""`) and awaits authorization before applying.
3. **Uncommitted Local Changes Not Pushed to `origin/clean-deployment`:** If Vercel builds from GitHub `clean-deployment` today (`2d6cf60`), it would deploy without `20261112000003` and the updated test file.
4. **System Owner Bootstrap & Post-Deploy Telegram `setWebhook` Pending:** `auth.users` has `0` users on `tkdrxfvxryemfdrwcmay` (kept clean by instruction), and Telegram `setWebhook` (`url = https://<vercel-domain>/api/bot/webhook`, `secret_token`) must be executed immediately after the first successful Vercel deploy.

---

## 8. Final Verdict: **NOT READY**

**Required Sequence Before Going Live on Vercel:**
1. Approve and apply `20261112000003_post_deployment_security_hardening.sql` to Supabase (`tkdrxfvxryemfdrwcmay`) and complete post-migration advisor/privilege verification.
2. Commit and push the approved remediation migration/test updates (and audit docs) to `origin/clean-deployment`.
3. Link/confirm the Vercel project (`Root Directory: apps/web`, GitHub `essentialsign103-crypto/HU-ASMS`, branch `clean-deployment`) and set the 5 required Vercel Environment Variables.
4. Deploy Vercel, initialize the first System Owner (`auth.users` + `public.profiles`), register Telegram's `setWebhook` to `https://<vercel-domain>/api/bot/webhook` with `TELEGRAM_WEBHOOK_SECRET`, and run live smoke checks.
