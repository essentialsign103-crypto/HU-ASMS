# HU-ASMS: Representative System Architecture & Scope Control

## 1. Overview

In the Haramaya University Academic Submission Management System (HU-ASMS), an **Academic Section Representative** is responsible for monitoring academic submissions, identifying submitted and missing students or groups, reviewing project files, and manually forwarding verified submissions to teachers.

The representative system is governed by strict scope boundaries:
1. **Numeric Telegram Identification**: Representatives are identified exclusively by their immutable 64-bit Telegram user ID (`telegram_user_id`), not by usernames.
2. **Scope Isolation**: A representative's permissions are tied strictly to their assigned academic sections (`representative_assignments`).
3. **Multi-Section Support**: A representative can be assigned to one or more sections (e.g. 2nd Year Section A and Section B) and seamlessly navigate between them without permission leakage to unassigned sections.
4. **Backend Enforcement**: Authorization is checked at both the service layer and database RLS layer, preventing unassigned section queries even if requested via custom API or forged callback queries.

---

## 2. University Organizational Scope

```
University
  └── Academic Years (e.g. 3rd Year)
       └── Sections (e.g. Section B)
            └── representative_assignments
                 └── Profile (telegram_user_id: 11111111)
```

### Scope Rule:
- Representative Hamza (3rd Year, Section B) can access only Section B students, projects, and submissions.
- Any attempt to query Section A or other academic years raises `UnauthorizedSectionScopeError` and is denied.

---

## 3. Representative Interface & Quick Actions

When an assigned representative sends `/start` to the Telegram bot, the system automatically detects their active assignments and displays:

- `🏢 My Assigned Sections`: Summarizes enrolled students and active projects for each authorized section.
- `👥 View All Students`: Displays the student roster for the representative's sections with official HU Student IDs and lock statuses.
- `📂 View All Projects`: Lists all active projects targeted at the representative's sections.
- `📊 Submission Reports`: Real-time reports categorized by project submission type:
  - **Individual Projects**: Total eligible, submitted count, missing count, submitter names, HU IDs, file details, and missing student list.
  - **Group Projects**: Total teams, submitted teams, missing teams, submitter names, and member confirmation progress.
- `📦 Forward to Teacher`: Manual delivery preparation and forwarding workflow.
- `📜 Delivery History`: Audit log of previous batches delivered to teachers.

---

## 4. Submission Notification Dispatch Engine

When a student submits an assignment:
1. The submission engine extracts the student's or group's academic `section_id`.
2. The `NotificationService` resolves all active representatives assigned to that `section_id`.
3. An instant Telegram alert is dispatched to each representative with the student's name, HU ID, file name, file size, and timestamp.
4. A permanent notification record is queued in the `notifications` table for auditing and delivery confirmation.
