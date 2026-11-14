# HU-ASMS — Phase A: Local Production Blocker Remediation Report

**Date:** 2026-11-12  
**Branch:** `clean-deployment` (local working tree only — not committed or pushed)  
**Target Supabase Project:** `tkdrxfvxryemfdrwcmay` (`"hu-accadamic assistent system"`)  
**Scope:** Strictly local P0 production-blocker remediation only. Zero deployments, zero DB/migration mutations, zero webhook registrations, zero secret rotations, and zero Git commits/pushes were performed.

---

## 1. Identified P0 Local Blockers Addressed

1. **Exposed Revoked Credential in Documentation (`docs/LOCAL_SMOKE_TEST_REPORT.md`):**
   - Line `506` of untracked [`docs/LOCAL_SMOKE_TEST_REPORT.md`](file:///d:/HU-ASMS%20%E2%80%94%20University/docs/LOCAL_SMOKE_TEST_REPORT.md) contained a revoked `sbp_` Supabase Personal Access Token in plaintext.
2. **Missing Vercel Serverless Timeout Configuration (`maxDuration`):**
   - [`apps/web/src/app/api/bot/webhook/route.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/api/bot/webhook/route.ts) did not export `maxDuration`, risking legacy serverless `10s` timeouts during synchronous `downloadTelegramDocument()` (`25_000 ms` fetch ceiling) + file inspection + private Vault storage uploads.
3. **Bot Menu Routing, Dead Handlers, Conversation Trap & Private-Chat Gaps:**
   - Visible keyboard buttons `'📜 Submission History'`, `'📦 Forward to Teacher'`, and `'📜 Delivery History'` in [`main-menu.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/keyboards/main-menu.ts#L6-L22), plus advertised `/support` in [`packages/shared/src/index.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/packages/shared/src/index.ts#L48), had no handlers wired in [`apps/bot/src/bot.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/bot.ts).
   - Representative button `'👥 View Groups'` was routed to student `handleMyGroups` instead of a section-scoped representative groups view.
   - No global `/cancel` command existed before `createConversation(...)`, leaving users unable to exit active conversations while waiting for input.
   - `conversation.waitFor(':document')` in individual and group submission flows gave no user feedback when students sent compressed Telegram photos or plain text instead of a Document attachment.
   - Non-private chat guards (`requirePrivateChat` / `isPrivateTelegramChat`) were omitted from `handleStudentMyProjects`, `handleMyGroups`, `handleMembershipAction` (`grp_confirm_*` / `grp_decline_*`), `view_proj_*`, and Representative handlers/callbacks (`rep_roster_*`, `rep_report_*`).
4. **Local Bot vs. Web Environment Project Drift:**
   - Root `.env` and `apps/bot/.env` (`dotenv/config` target for standalone `npm run dev`) pointed to a different Supabase project ref instead of `tkdrxfvxryemfdrwcmay`, and `apps/bot/.env` held a placeholder `TELEGRAM_WEBHOOK_SECRET`, while `.env.local` and `apps/web/.env.local` targeted `tkdrxfvxryemfdrwcmay`.

---

## 2. Changes Made

### 2.1 Repository Security & Hygiene
- Scrubbed the revoked `sbp_` token at [`docs/LOCAL_SMOKE_TEST_REPORT.md`](file:///d:/HU-ASMS%20%E2%80%94%20University/docs/LOCAL_SMOKE_TEST_REPORT.md#L505-L510) and replaced it with a safe remediation note.
- Scanned all tracked and untracked workspace files (excluding `.git`, `node_modules`, `.next`, `dist`, and gitignored `.env*` files) for `sbp_`, `sb_secret_`, JWT (`eyJ...`), Telegram token, and private-key patterns: **0 real secrets matched**. Only two explicitly synthetic unit-test fixtures matched in [`apps/bot/test/critical-blockers.test.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/test/critical-blockers.test.ts#L458) and [`apps/bot/test/webhook-security.test.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/test/webhook-security.test.ts#L113).
- Verified via `git check-ignore -v` that `.env`, `.env.local`, `apps/bot/.env`, and `apps/web/.env.local` remain matched by `.gitignore` and untracked.

### 2.2 Webhook Configuration (`maxDuration`)
- Verified Vercel Functions duration limits against official Vercel documentation:
  - **Hobby (Fluid Compute enabled):** up to `300s`.
  - **Hobby (legacy Serverless without Fluid Compute):** `10s` default, **`60s` maximum**.
  - **Pro / Enterprise:** up to `800s` (Fluid Compute) or `300s` (legacy).
- Added `export const maxDuration = 60;` to [`apps/web/src/app/api/bot/webhook/route.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/api/bot/webhook/route.ts#L8), providing full headroom for the `25s` Telegram download + upload flow while staying compatible with every Vercel plan (including Hobby without Fluid Compute).

### 2.3 Bot Functionality & Privacy Fixes
- **Global `/cancel` Escape Hatch ([`apps/bot/src/bot.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/bot.ts#L127-L137)):** Registered `bot.command('cancel', ...)` immediately **after `bot.use(conversations())`** and **before `bot.use(createConversation(...))`** so `ctx.conversation.exit()` cleanly exits any active conversation regardless of whether it is waiting on text, callback queries, or document uploads; updated [`help.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/commands/help.ts#L7-L16) to list all active commands.
- **Compressed Photo & Non-Document Guidance ([`submission-conversation-helpers.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/utils/submission-conversation-helpers.ts), [`submission.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/submission.conversation.ts#L138-L144), [`group-submission.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/group-submission.conversation.ts#L238-L244)):** Extracted shared `waitForSubmissionDocument()` using `@grammyjs/conversations`' `otherwise` callback to reply with clear instructions (tap 📎 paperclip → File / Document, or send `/cancel`) when a compressed photo, media/audio message, plain text, or stray callback arrives.
- **Dead Menu & Command Handlers Repaired:**
  - Wired `'📜 Submission History'` → `handleStudentSubmissionHistory` in [`student.project.handler.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/handlers/student.project.handler.ts#L118-L195) (queries `submission_members` + joined `submissions`, `projects`, `groups`, and `submission_files` for both individual and group submissions credited to the verified student).
  - Separated `'👥 View Groups'` from `'👥 My Groups'` and wired `'👥 View Groups'` → section-scoped `handleRepViewGroups` in [`representative.handler.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/handlers/representative.handler.ts#L269-L321) (verifies active representative profile & queries `groups` strictly `.in('section_id', assignedSectionIds)`).
  - Wired `'📜 Delivery History'` → section-scoped `handleRepDeliveryHistory` in [`representative.handler.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/handlers/representative.handler.ts#L361-L413) (queries `deliveries` strictly `.in('section_id', assignedSectionIds)`).
  - Wired `'📦 Forward to Teacher'` → section-scoped `handleRepForwardToTeacher` in [`representative.handler.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/handlers/representative.handler.ts#L323-L359) (reports active sections, projects, and active submission count in scope, and directs the representative to the authenticated web portal `/rep/deliveries/new` where teacher delivery batching and signed manifests live — without inventing new unrequested bot mutations).
  - Wired `/support` → `handleHelpCommand` in [`bot.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/bot.ts#L148).
- **Private-Chat Enforcement Across Sensitive Flows:**
  - Extracted `requirePrivateAuthorizedRep()` in [`representative.handler.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/handlers/representative.handler.ts#L10-L31) and enforced private-chat + active rep scope across `handleAssignedSections`, `handleViewStudents`, `displaySectionRoster`, `handleViewProjects`, `handleSubmissionReports`, `renderProjectReport`, `handleRepViewGroups`, `handleRepForwardToTeacher`, `handleRepDeliveryHistory`, plus `rep_roster_*` and `rep_report_*` callbacks in `bot.ts`.
  - Enforced `requirePrivateChat` / `isPrivateTelegramChat` across `handleStudentMyProjects`, `handleStudentSubmissionHistory`, `handleProjectDetailsCallback` (`view_proj_*`), `handleMyGroups`, and `handleMembershipAction` (`grp_confirm_*` / `grp_decline_*`).

### 2.4 Environment Consistency (Local Only — No Values Exposed or Committed)
- Synchronized `NEXT_PUBLIC_SUPABASE_URL` (`tkdrxfvxryemfdrwcmay`), `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `TELEGRAM_WEBHOOK_SECRET` in root `.env` and `apps/bot/.env` to match `.env.local` and `apps/web/.env.local`.
- Preserved `TELEGRAM_BOT_TOKEN` (already aligned across all four files) and kept `TELEGRAM_WEBHOOK_URL` as a local placeholder pending Vercel URL creation.

---

## 3. Files Changed

### Modified Tracked Files
- [`apps/bot/src/bot.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/bot.ts)
- [`apps/bot/src/commands/help.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/commands/help.ts)
- [`apps/bot/src/conversations/group-submission.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/group-submission.conversation.ts)
- [`apps/bot/src/conversations/submission.conversation.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/conversations/submission.conversation.ts)
- [`apps/bot/src/handlers/group.handler.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/handlers/group.handler.ts)
- [`apps/bot/src/handlers/representative.handler.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/handlers/representative.handler.ts)
- [`apps/bot/src/handlers/student.project.handler.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/handlers/student.project.handler.ts)
- [`apps/web/src/app/api/bot/webhook/route.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/src/app/api/bot/webhook/route.ts)
- [`apps/web/test/track-a1-vercel.test.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/web/test/track-a1-vercel.test.ts)

### New Trackable Source / Test Files Created
- [`apps/bot/src/utils/submission-conversation-helpers.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/src/utils/submission-conversation-helpers.ts)
- [`apps/bot/test/phase-a-remediation.test.ts`](file:///d:/HU-ASMS%20%E2%80%94%20University/apps/bot/test/phase-a-remediation.test.ts)
- [`docs/PHASE_A_REMEDIATION_REPORT.md`](file:///d:/HU-ASMS%20%E2%80%94%20University/docs/PHASE_A_REMEDIATION_REPORT.md) *(this deliverable)*

### Edited Untracked / Ignored Files
- [`docs/LOCAL_SMOKE_TEST_REPORT.md`](file:///d:/HU-ASMS%20%E2%80%94%20University/docs/LOCAL_SMOKE_TEST_REPORT.md) (scrubbed revoked `sbp_` PAT at line 506)
- `.env`, `apps/bot/.env` (gitignored; aligned Supabase project keys & `TELEGRAM_WEBHOOK_SECRET` with `.env.local` / `apps/web/.env.local`)

*(Pre-existing working-tree files outside Phase A scope — `apps/bot/test/webhook-security.test.ts`, `docs/DEPLOYMENT_RECONCILIATION_REPORT.md`, `apps/web/tsconfig.tsbuildinfo`, `docs/DEPLOYMENT_RECONCILIATION_FINAL.md`, `docs/TELEGRAM_BOT_PRODUCTION_READINESS_AUDIT.md`, `VERIFICATION_QUERIES.sql`, `verify-remote-state.mjs`, `verify-system-owner.sql` — were left intact.)*

---

## 4. Tests & Verification Executed (Exact Results)

| Check | Command | Exact Result | Scope Note |
|---|---|---|---|
| **Bot Unit/Mocked Suite** | `npm run test -w apps/bot` | **`104` tests, `31` suites, `104` pass, `0` fail, `0` skipped** | All offline mocked/in-memory (includes 4 new Phase A tests) |
| **Web Unit/Contract Suite** | `npm run test -w apps/web` | **`115` tests, `29` suites, `115` pass, `0` fail, `0` skipped** | All mocked/static contracts (includes webhook `maxDuration = 60` assertion) |
| **Database Unit Suite** | *(via `npm run test`)* `packages/database` | **`16` tests, `10` suites, `16` pass, `0` fail, `0` skipped** | Offline mocked Supabase client |
| **Full Workspace Test Suite** | `npm run test` | **Exit `0` — `235` total passed (`104 + 115 + 16`), `0` failed, `0` skipped** | `shared`/`types`/`validation` run `node --version` placeholder test scripts |
| **Workspace TypeScript Check** | `npm run typecheck` | **Exit `0`** across all 6 workspaces (`bot`, `web`, `database`, `shared`, `types`, `validation`) | Clean `tsc --noEmit` |
| **Workspace Production Build** | `npm run build` | **Exit `0`** across all 6 workspaces (`Next.js 15.5.29`, 21/21 pages + `/api/bot/webhook`) | Production bundle compiled & typechecked |
| **Secret Pattern Scan** | PowerShell regex scan (`sbp_`, `sb_secret_`, JWT, Telegram bot token, private key) | **0 real secrets matched** | Only 2 pre-verified synthetic unit test fixtures matched (`critical-blockers.test.ts:458`, `webhook-security.test.ts:113`) |
| **Env Alignment & Gitignore** | Key comparison script + `git check-ignore -v` | All 4 env files target `tkdrxfvxryemfdrwcmay` with matching secrets and are `.gitignore`-protected | Zero secret values printed |
| **Patch Whitespace Check** | `git diff --check -- apps/` | **Exit `0`** | Pre-existing uncommitted `docs/DEPLOYMENT_RECONCILIATION_REPORT.md` has Markdown trailing spaces outside `apps/` |

---

## 5. Remaining Warnings (Non-P0 / Post-Phase A)

1. **`tkdrxfvxryemfdrwcmay` Target DB Is Still Unseeded:** `departments = 0`, `sections = 0`, `projects = 0`, `students = 0` (by design in Phase A — DB writes prohibited).
2. **Vercel Project & 5 Env Vars Not Yet Provisioned:** Requires explicit authorization in the Vercel deployment phase (`Root Directory = apps/web`, 5 env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`).
3. **Telegram Webhook Registration (`setWebhook`) & Live E2E Tests Pending:** Live Telegram API, live Postgres `bot_sessions` / `rate_limit_buckets`, Vault 20 MB downloads, and webhook retry/deduplication (`update_id`) are not yet tested against live endpoints.
4. **Concurrency & Storage Maintenance (Low/Medium):** `SupabaseSessionStorage` performs non-locked `select` + `upsert` without automated TTL cleanup, and webhook `update_id` deduplication is not implemented (`resubmission_allowed = true` retries could create duplicate versions).
5. **Pre-existing Uncommitted Workspace Artifacts:** `docs/DEPLOYMENT_RECONCILIATION_REPORT.md` (with Markdown trailing whitespace), `apps/web/tsconfig.tsbuildinfo`, and root verification helper scripts (`VERIFICATION_QUERIES.sql`, `verify-remote-state.mjs`, `verify-system-owner.sql`) remain in the local working tree and should be triaged before committing/pushing `clean-deployment`.

---

## 6. Issues That Could Not Safely Be Fixed in Phase A

- **Telegram Webhook Idempotency (`update_id` deduplication table/column) & `SupabaseSessionStorage` Row-Level Concurrency Locking:** Modifying database schemas or session semantics requires migrations (`supabase/migrations/*`), which are explicitly out of bounds during Phase A.
- **Full End-to-End "Forward to Teacher" Multi-Step Interactive Creation Inside Telegram:** Creating/dispatching teacher delivery batches requires multi-submission selection, signed Vault URL manifest generation, and atomic database/audit RPCs handled by the authenticated web portal (`/rep/deliveries/new`). Adding an entirely new interactive delivery wizard in the bot would invent features beyond Phase A; instead, the button safely reports active section metrics and directs the authorized representative to `/rep/deliveries/new`.

---

## 7. Action Isolation Confirmation

Confirmed that during Phase A:
- **No** Vercel configuration or deployment occurred.
- **No** Supabase production data, schema, storage, or migration changes occurred.
- **No** Telegram `setWebhook` API calls or live bot polling runs occurred.
- **No** secrets were created, rotated, printed, or committed.
- **No** `git commit`, `git merge`, or `git push` occurred.
