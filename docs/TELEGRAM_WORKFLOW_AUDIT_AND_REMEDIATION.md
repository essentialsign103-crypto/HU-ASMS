# HU-ASMS — Critical Telegram Workflow Audit & Remediation Report

**Target Project**: `tkdrxfvxryemfdrwcmay`  
**Date**: November 13, 2026  
**Auditor**: Antigravity DeepMind Agent  
**Status**: COMPLETE — ALL LOCAL TESTS PASSING (251/251)  
**Final Recommendation**: **READY FOR MANUAL ACCEPTANCE TESTING**

---

## 1. Executive Summary

An exhaustive audit of the HU-ASMS (Haramaya University Assignment Submission & Management System) cross-system workflows was conducted across the Next.js administrative dashboard (`@hu-asms/web`), grammY Telegram bot (`@hu-asms/bot`), Supabase PostgreSQL database (`@hu-asms/database`), and notification pipelines.

Prior to remediation, all three core operational workflows were in an unworkable state:
1. **Student Registration Approval Notifications**: The Next.js admin dashboard approved and rejected students in the database, but never invoked any notification service or contacted Telegram. Approved students remained unaware of their status unless they manually typed `/start` again in Telegram, and rejected students received zero communication. Furthermore, the bot's internal notification service recorded fake `status: 'sent'` records in the database *before* attempting delivery, masking failed deliveries from admins.
2. **Representative Assignment & Activation**: The `/admin/representatives` dashboard page was completely read-only. Administrators had no interface or server actions to assign eligible students as section representatives, deactivate representatives, or reassign sections. In addition, no Telegram activation alerts were dispatched upon appointment, and the system lacked authorization synchronization between Telegram numeric IDs, `students`, and `profiles`.
3. **Representative-to-Teacher Delivery**: Representatives could create duplicate delivery batches containing already-delivered submissions; the delivery state machine lacked any mechanism to mark batches as `failed`; acknowledging a delivery did not transition underlying student submissions to `delivered`; and the delivery creation UI failed to synchronize the assigned project teacher upon project selection.

### Key Remediation Highlights
- **Full Bidirectional Telegram Alerts**: Created `telegram-notification-service.ts` in Next.js web application and overhauled `notification.service.ts` in the Telegram bot. Notifications now accurately record delivery status (`sent` vs `failed`) with raw Telegram API error messages stored in `notifications.error_message`.
- **Non-Blocking Post-Commit Dispatch**: Database transactions commit first. Notification dispatches are executed post-commit; network or Telegram API failures do not rollback valid administrative approvals or assignments. Failed alerts are highlighted in the admin dashboard with a one-click retry mechanism.
- **Representative Management Console**: Upgraded `/admin/representatives` into a full management dashboard with representative assignment, deactivation, and section reassignment server actions, strict eligibility validation (locked approved student check, linked Telegram account, cross-year scope guards), and automated outbound activation/deactivation Telegram alerts.
- **Delivery Workflow State Integrity**: Added duplicate delivery batch prevention in `executePrepareDeliveryBatch`, added `executeFailDelivery` to transition broken batches to `failed` with failure reasons, updated `executeAcknowledgeDelivery` to transition active submissions to `status = 'delivered'`, and fixed the project-teacher selector in the delivery creation UI.
- **Zero Schema Migrations Required**: The existing PostgreSQL database schema (`notifications`, `representatives`, `profiles`, `audit_logs`, `deliveries`, `delivery_items`, and enums) already natively contained all required fields, foreign keys, and statuses.

---

## 2. Root Cause Analysis

### Workflow A: Student Registration Approval & Notifications
- **Root Cause A1 (Missing Outbound Dispatch)**: `apps/web/src/app/admin/students/actions.ts` called `executeApproveRegistration` and `executeRejectRegistration` to update the database, but never instantiated or triggered any Telegram API call or notification queue.
- **Root Cause A2 (Premature Success Recording in Bot Service)**: `apps/bot/src/services/notification.service.ts` recorded `status: 'sent'` into `notifications` table *before* awaiting the Telegram Bot API call `botSender(...)`. If Telegram returned an error (e.g., bot blocked by student, invalid token, rate limit), the database already asserted successful delivery, blinding administrators to notification failures.
- **Root Cause A3 (Silent Rejections)**: Student registration rejections were completely silent. When an administrator rejected an invalid or suspicious registration request, no notification was recorded or dispatched to the student's Telegram chat.

### Workflow B: Representative Assignment, Activation & Scope Management
- **Root Cause B1 (Read-Only Admin Dashboard)**: `apps/web/src/app/admin/representatives/page.tsx` merely fetched and displayed existing representative rows from Supabase. No forms, buttons, or server actions existed to assign a student as representative, deactivate a representative, or reassign them to another section.
- **Root Cause B2 (Identity & Profile Desynchronization)**: In HU-ASMS, `representatives.student_id` references `students.id`. However, RLS policies (`auth_is_rep_for_section`) and representative dashboard access check `profiles.role = 'representative'` and `profiles.id = auth.uid()`. Furthermore, bot handlers identify representatives by `students.telegram_user_id`. Without an automated sync provisioning `profiles` and associating `telegram_user_id`, students appointed as representatives could not access representative commands in Telegram or log into the representative web portal.
- **Root Cause B3 (Missing Activation & Deactivation Alerts)**: When representatives were inserted into the database, no notification was dispatched to notify them of their appointment, scope boundaries, or access commands.

### Workflow C: Representative-to-Teacher Delivery & State Transitions
- **Root Cause C1 (Duplicate Delivery Batching)**: `executePrepareDeliveryBatch` in `apps/web/src/lib/rep/delivery-service.ts` verified that submissions were active, but did not check `delivery_items` of existing active batches. A representative could include the same submission in multiple concurrent delivery packages.
- **Root Cause C2 (Missing `failed` State Transition)**: Although the PostgreSQL enum `delivery_status` includes `'failed'`, `delivery-service.ts` had no function or server action to transition a delivery to `'failed'`. If a teacher refused delivery or an external transmission failed, representatives were stranded with no way to flag the failure.
- **Root Cause C3 (Stale Submissions After Delivery)**: `executeAcknowledgeDelivery` updated `deliveries.status = 'acknowledged'`, but left the underlying `submissions.status` as `'submitted'`, causing them to continuously appear in the representative's pending submission queues.
- **Root Cause C4 (UI Teacher Selector Desynchronization)**: In `apps/web/src/app/rep/deliveries/new/delivery-form.tsx`, changing the project dropdown did not re-synchronize the teacher dropdown when a teacher was already selected, permitting deliveries to target an unassigned teacher.

---

## 3. RED FLAGS — BLOCKERS TO PRODUCTION

### RED FLAG 1 [CRITICAL]: Premature Notification Delivery Recording Masked Failed Messages
- **Affected File/Function/Table**: `apps/bot/src/services/notification.service.ts` -> `notifyRepresentativeOfSubmission` / `notifications` table.
- **Reproduction Steps**:
  1. Student submits an assignment via Telegram bot.
  2. Bot calls `notifyRepresentativeOfSubmission`.
  3. `NotificationService` inserts `status: 'sent'` into `notifications`.
  4. Telegram API call throws `403 Forbidden` (e.g., representative blocked the bot).
  5. The error was caught in `catch`, logged, but the database remained `status: 'sent'`.
- **Actual Behavior**: Failed Telegram deliveries were recorded as successfully sent.
- **Expected Behavior**: Record `status: 'failed'` with the exact error message in `error_message`, or only record `status: 'sent'` after the Telegram API returns HTTP 200 `ok: true`.
- **Root Cause**: Database write occurred before the network request.
- **Risk & Severity**: **CRITICAL**. Student submissions would go completely unnoticed by representatives without any alerting or error trail, violating SLA and submission tracking.
- **Correction Implemented**: Rewrote `notification.service.ts` to execute the Telegram API request first, handling network/API errors gracefully and persisting `status: 'failed'` and `error_message` on rejection, and `status: 'sent'` with `sent_at` timestamp on success.

---

### RED FLAG 2 [CRITICAL]: Desynchronized Teacher Selection in Delivery Package Creation
- **Affected File/Function/Table**: `apps/web/src/app/rep/deliveries/new/delivery-form.tsx`.
- **Reproduction Steps**:
  1. Representative selects Project A (taught by Teacher X).
  2. Representative switches dropdown to Project B (taught by Teacher Y).
  3. The form kept Teacher X selected if `selectedTeacherId` was already set.
  4. Submitting the form created a delivery batch pointing Project B to Teacher X.
- **Actual Behavior**: Delivery packages could be addressed and delivered to the wrong instructor.
- **Expected Behavior**: Selecting a project must strictly bind and synchronize the assigned course instructor.
- **Root Cause**: Incomplete React state change handler in `delivery-form.tsx`.
- **Risk & Severity**: **CRITICAL**. Academic confidentiality breach: Teacher X receives student submissions and files for courses they do not teach.
- **Correction Implemented**: Updated `handleProjectChange` to locate the project's assigned instructor and immediately update `selectedTeacherId`, disabling cross-teacher assignment unless authorized.

---

### RED FLAG 3 [HIGH]: Silent Approvals and Rejections in Administrative Dashboard
- **Affected File/Function/Table**: `apps/web/src/app/admin/students/actions.ts` -> `approveRegistration` / `rejectRegistration`.
- **Reproduction Steps**:
  1. System Owner opens `/admin/students`.
  2. Clicks "Approve" or "Reject".
  3. Database row updated to `locked` or `rejected`.
  4. No message sent to student Telegram account.
- **Actual Behavior**: Student receives no communication. Approved students remain under the impression that their account is pending. Rejected students never receive rejection reasons.
- **Expected Behavior**: Approval and rejection must dispatch clear Telegram notifications to the student's numeric Telegram ID.
- **Root Cause**: Dashboard server actions updated database records but contained no notification dispatch code.
- **Risk & Severity**: **HIGH**. Operational failure: thousands of university students stranded waiting for bot confirmation.
- **Correction Implemented**: Created `telegram-notification-service.ts` with `notifyStudentOfApproval` and `notifyStudentOfRejection`. Integrated post-commit dispatch into `approveRegistration` and `rejectRegistration`, and added an admin retry card for failed alerts.

---

### RED FLAG 4 [HIGH]: Missing Server-Side Representative Assignment Console
- **Affected File/Function/Table**: `apps/web/src/app/admin/representatives/page.tsx`.
- **Reproduction Steps**:
  1. System Owner navigates to `/admin/representatives`.
  2. Page displays a table of existing reps, but provides zero buttons or forms to assign, deactivate, or reassign reps.
- **Actual Behavior**: Representatives could only be created by manually writing raw SQL queries in Supabase Studio.
- **Expected Behavior**: Full administrative UI with server-side validation to appoint eligible students, deactivate active representatives, and reassign sections.
- **Root Cause**: UI was left as an incomplete static mock during initial development.
- **Risk & Severity**: **HIGH**. Production blocker: System Owner cannot manage section representatives through the web portal.
- **Correction Implemented**: Implemented `representative-management-service.ts`, server actions in `actions.ts`, and full management UI in `page.tsx` with assignment modals, deactivation buttons, and section reassignment dropdowns.

---

### RED FLAG 5 [HIGH]: Duplicate Delivery Batching Allowed Concurrent Overlapping Deliveries
- **Affected File/Function/Table**: `apps/web/src/lib/rep/delivery-service.ts` -> `executePrepareDeliveryBatch`.
- **Reproduction Steps**:
  1. Representative prepares Delivery Batch 1 containing Submission S1.
  2. Representative immediately prepares Delivery Batch 2 and selects Submission S1 again.
  3. System allowed both batches to be prepared and sent.
- **Actual Behavior**: Multiple conflicting delivery packages created for the same submission.
- **Expected Behavior**: System must prevent submissions in `prepared`, `sent`, or `acknowledged` deliveries from being bundled into another delivery batch.
- **Root Cause**: `executePrepareDeliveryBatch` queried `submissions`, but failed to query active `delivery_items`.
- **Risk & Severity**: **HIGH**. Duplicate teacher delivery, confusing instructors and causing version conflicts.
- **Correction Implemented**: Added validation query in `executePrepareDeliveryBatch` checking `delivery_items` of active batches (`prepared`, `sent`, `acknowledged`) and rejecting duplicate inclusion.

---

### RED FLAG 6 [MEDIUM]: Missing Delivery Failure State Machine Transition
- **Affected File/Function/Table**: `apps/web/src/lib/rep/delivery-service.ts` / `apps/web/src/app/rep/deliveries/actions.ts`.
- **Reproduction Steps**:
  1. Representative dispatches delivery to teacher.
  2. Teacher rejects batch or files are inaccessible.
  3. No option existed in UI or backend service to transition delivery to `failed`.
- **Actual Behavior**: Delivery remained permanently stuck in `prepared` or `sent`.
- **Expected Behavior**: Representatives must have an explicit "Mark Failed" action that records the failure reason and transitions `deliveries.status = 'failed'`.
- **Root Cause**: Incomplete state machine implementation in `delivery-service.ts`.
- **Risk & Severity**: **MEDIUM**. Stuck delivery records, skewed reporting metrics.
- **Correction Implemented**: Implemented `executeFailDelivery`, exported `failDelivery` server action, and added "Mark Failed" UI button with confirmation prompt in `delivery-actions-client.tsx`.

---

### RED FLAG 7 [MEDIUM]: Acknowledged Deliveries Did Not Transition Submissions to `delivered`
- **Affected File/Function/Table**: `apps/web/src/lib/rep/delivery-service.ts` -> `executeAcknowledgeDelivery`.
- **Reproduction Steps**:
  1. Delivery is acknowledged by teacher.
  2. `deliveries.status` updated to `acknowledged`.
  3. The associated submissions in `submissions` table remained with `status = 'submitted'`.
- **Actual Behavior**: Submissions were never marked `delivered`.
- **Expected Behavior**: Acknowledging a delivery must update all underlying submissions to `status = 'delivered'`.
- **Root Cause**: Missing update step in `executeAcknowledgeDelivery`.
- **Risk & Severity**: **MEDIUM**. Submissions appeared un-delivered in student status checks.
- **Correction Implemented**: Added atomic update in `executeAcknowledgeDelivery` updating `submissions.status = 'delivered'` for all items in the acknowledged delivery package.

---

## 4. Files Changed

| File Path | Component | Description of Remediation |
|---|---|---|
| `apps/bot/src/services/notification.service.ts` | Bot Service | Rewrote notification dispatch. Fixed premature `sent` recording, added raw Telegram fetch fallback with token redaction, and exported student/rep notification helpers. |
| `apps/bot/src/index.ts` | Bot Entrypoint | Exported `NotificationService` and notification types for clean workspace imports. |
| `apps/web/src/lib/notifications/telegram-notification-service.ts` | Web Service | **[NEW]** Created Next.js server-side notification dispatcher with idempotency checks, token redaction, retry mechanism, and delivery persistence. |
| `apps/web/src/lib/admin/representative-management-service.ts` | Web Service | **[NEW]** Implemented `executeAssignRepresentative`, `executeDeactivateRepresentative`, and `executeReassignRepresentative` with strict eligibility checks, profile synchronization, and audit logging. |
| `apps/web/src/app/admin/representatives/actions.ts` | Web Actions | **[NEW]** Created server actions `assignRepresentativeAction`, `deactivateRepresentativeAction`, and `reassignRepresentativeAction` with distributed rate limiting. |
| `apps/web/src/app/admin/representatives/page.tsx` | Web UI | Upgraded from read-only display to full management console: added Designation form, Deactivate buttons, Reassign dropdowns, and Failed Notification alert card. |
| `apps/web/src/app/admin/students/actions.ts` | Web Actions | Integrated non-blocking post-commit Telegram notification dispatch for approvals and rejections. Added `retryNotificationAction`. |
| `apps/web/src/app/admin/students/page.tsx` | Web UI | Added Failed Outbound Notifications alert banner with one-click "Retry Delivery" button. |
| `apps/web/src/lib/rep/delivery-service.ts` | Web Service | Added duplicate delivery item guards in `executePrepareDeliveryBatch`, implemented `executeFailDelivery`, and updated `executeAcknowledgeDelivery` to set `submissions.status = 'delivered'`. |
| `apps/web/src/app/rep/deliveries/actions.ts` | Web Actions | Added and exported `failDelivery` server action. |
| `apps/web/src/app/rep/deliveries/delivery-actions-client.tsx` | Web UI | Added "Mark Failed" client action and modal for `prepared` or `sent` deliveries. |
| `apps/web/src/app/rep/deliveries/new/delivery-form.tsx` | Web UI | Synchronized teacher dropdown automatically when selecting project. |
| `apps/web/test/telegram-workflow-remediation.test.ts` | Web Tests | **[NEW]** 11 integration/unit tests for approval/rejection alerts, retries, representative assignment, deactivation, reassignment, and delivery fixes. |
| `apps/bot/test/telegram-workflow-bot.test.ts` | Bot Tests | **[NEW]** 5 tests for bot representative recognition, cross-section scope guards, deactivation revocation, and notification failure recording. |

---

## 5. Database Schema Status & Proposed Migrations

### Findings
The live Supabase database schema (`tkdrxfvxryemfdrwcmay`) was inspected against all workflow requirements:
1. `notifications` table already contains:
   - `id`, `recipient_telegram_id` (`bigint`), `notification_type` (`text`), `payload` (`jsonb`), `status` (`text`), `error_message` (`text`), `idempotency_key` (`text`), `created_at`, `sent_at`.
2. `representatives` table already contains:
   - `id`, `student_id`, `academic_year_id`, `section_id`, `is_active` (`boolean`), `assigned_by`, `assigned_at`, `deactivated_at`.
3. `profiles` table already contains:
   - `id`, `email`, `role` (`app_role` enum including `'representative'`), `is_active`, `telegram_user_id`.
4. `deliveries` table already contains:
   - `id`, `representative_id`, `project_id`, `teacher_id`, `status` (`delivery_status` enum: `pending`, `prepared`, `sent`, `failed`, `acknowledged`), `failure_reason`.
5. `submissions` table already contains:
   - `status` (`submission_status` enum: `submitted`, `delivered`, etc.).

### Conclusion
**Zero remote schema migrations are required.** All necessary columns, constraints, foreign keys, and status enums already exist in PostgreSQL. No destructive changes or schema modifications are needed.

---

## 6. Automated Test Results

All automated test suites across all workspaces were executed locally.

### Summary Table

| Workspace | Test Suite / Focus | Tests Run | Passed | Failed | Exit Code |
|---|---|---|---|---|---|
| `@hu-asms/bot` | Bot workflows, scope guards, notification service, webhook security, group submissions, identity verification | 109 | 109 | 0 | **0** |
| `@hu-asms/web` | Web workflows, approvals, rejections, representative management, delivery state machine, RLS guards | 126 | 126 | 0 | **0** |
| `@hu-asms/database`| Academic management, university structure, scope verification, audit logs | 16 | 16 | 0 | **0** |
| `@hu-asms/shared` | Types, utilities, formatters | Checked | Checked | 0 | **0** |
| `@hu-asms/types` | TypeScript type contracts | Checked | Checked | 0 | **0** |
| `@hu-asms/validation`| Zod schemas and validation rules | Checked | Checked | 0 | **0** |
| **All Workspaces** | **Full Workspace Test Suite (`npm test`)** | **251** | **251** | **0** | **0** |
| **Production Build**| **Next.js & Workspace Production Build (`npm run build`)** | **21 static pages generated** | **21** | **0** | **0** |

*Note: Automated tests verify code logic, rate limiters, token redactions, and state transitions using simulated Supabase and Telegram API clients. They confirm zero compilation, typing, or logical regressions, but do not replace live manual acceptance with real Telegram accounts.*

---

## 7. Remaining Live Integration Gaps

Before deploying to production or declaring end-to-end production readiness, the following live infrastructure integration gaps must be completed by the authorized administrator:

1. **Telegram Webhook Registration (`setWebhook`)**:
   - The production Telegram bot token is configured in Supabase / environment, but `https://<vercel-domain>/api/bot/webhook` must be registered with Telegram via `setWebhook` including the `secret_token` header.
2. **System Owner Live Login**:
   - The System Owner profile has been seeded in `tkdrxfvxryemfdrwcmay`. The administrator must authenticate via Supabase Auth into the web dashboard to exercise the administrative actions in a live browser session.
3. **Real Telegram Accounts for Test Roles**:
   - End-to-end verification requires testing with real Telegram user accounts (one test student and one test representative) who have opened the bot in private chat (`/start`) so Telegram allows outbound messaging.

---

## 8. Manual Acceptance Checklist

This end-to-end manual acceptance test must be performed using authorized test accounts on the live staging/production environment:

```markdown
- [ ] 1. Student Registration via Telegram Bot
  - Open Telegram and send /start to @hu_asms_bot using a fresh test account.
  - Complete the registration flow (HU Student ID, Full Name, Section).
  - Verify that the bot displays: "Registration submitted. Awaiting administrative approval."

- [ ] 2. Admin Dashboard Verification
  - Log in to Next.js dashboard as System Owner.
  - Navigate to `/admin/students`.
  - Confirm the test student appears under "Pending Registration Requests".

- [ ] 3. Student Approval & Telegram Notification
  - In `/admin/students`, click "Approve" for the test student.
  - Check the test student's Telegram chat.
  - Confirm receipt of approval message: "Your registration for HU-ASMS has been approved!"
  - Confirm in `/admin/students` that the student status is "Approved" (Locked) and no failed notification alert appears.

- [ ] 4. Bot Recognition of Approved Student
  - Send `/start` in Telegram as the test student.
  - Confirm the bot displays the student dashboard menu (Submit Assignment, View Deadlines, Help) instead of the registration flow.

- [ ] 5. Representative Assignment & Activation
  - In the web dashboard, navigate to `/admin/representatives`.
  - Under "Designate Section Representative", select the approved test student, current academic year, and section.
  - Click "Assign as Section Representative".
  - Verify test student receives Telegram alert: "You have been designated as the Section Representative for [Section]..."
  - Verify the assignment appears under "Active Section Representatives" with the student's name, section, and Telegram user ID.

- [ ] 6. Representative Bot Scope & Command Check
  - Send `/rep` or `/start` in Telegram as the representative.
  - Confirm representative menu options appear.
  - Verify representative can view submissions only for their assigned section.

- [ ] 7. Project Creation & Submission Delivery
  - In `/admin/academics/projects`, create a test project targeted to the representative's section.
  - As a student, submit a test PDF file to the project via Telegram bot.
  - As representative, log into `/rep/deliveries/new` in the web portal.
  - Select the project. Confirm the assigned teacher is automatically synchronized.
  - Select the submitted assignment and click "Prepare Delivery Package".
  - Verify delivery package status is `prepared`.
  - Attempt to prepare a second batch with the same submission; verify the system rejects duplicate batching.

- [ ] 8. Teacher Delivery Dispatch & Acknowledgment
  - In `/rep/deliveries`, click "Mark Dispatched / Sent".
  - Verify delivery status transitions to `sent`.
  - Click "Confirm Teacher Acknowledgment".
  - Verify delivery status transitions to `acknowledged`.
  - Verify underlying submission status updates to `delivered`.

- [ ] 9. Representative Deactivation
  - In `/admin/representatives`, click "Deactivate Representative".
  - Verify representative receives deactivation notification in Telegram.
  - In Telegram, send a representative command; confirm access is immediately revoked with an unauthorized error.
```

---

## 9. Next Steps Before Vercel Deployment

1. **Git Commit & Push**:
   - Review staged changes (`git status`).
   - Commit all audited and remediated files with a clean message:
     ```bash
     git add apps/bot/ apps/web/ packages/ docs/
     git commit -m "fix(workflows): remediate Telegram approval alerts, representative management, and teacher delivery state machine"
     ```
2. **Environment Variable Audit on Vercel**:
   - Ensure the following variables are configured in the Vercel project settings:
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - `SUPABASE_SERVICE_ROLE_KEY`
     - `TELEGRAM_BOT_TOKEN`
     - `TELEGRAM_WEBHOOK_SECRET`
3. **Execute Production Deployment**:
   - Deploy to Vercel via CLI or git push.
4. **Register Telegram Webhook**:
   - After Vercel deployment URL is active, register the webhook with Telegram:
     ```bash
     curl -F "url=https://<your-vercel-domain>/api/bot/webhook" -F "secret_token=<TELEGRAM_WEBHOOK_SECRET>" https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook
     ```
5. **Execute Manual Acceptance Checklist**:
   - Perform Section 8 checklist with test Telegram accounts before opening the bot to university students.

---

## 10. Final Deployment Recommendation

### **READY FOR MANUAL ACCEPTANCE TESTING**

- **Justification**:
  1. All root causes across Student Approval Notifications, Representative Assignment, and Teacher Delivery have been locally resolved.
  2. Workspace typecheck passed cleanly across all 7 packages.
  3. All 251 unit and integration tests passed (0 failures).
  4. Production build (`npm run build`) completed successfully with 21 Next.js routes generated.
  5. Zero schema migrations or destructive database actions are required.
  6. Live manual acceptance testing (Section 8) is required before opening to the student body to confirm live Telegram API webhook delivery.
