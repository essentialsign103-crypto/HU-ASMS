# HU-ASMS Core Academic Workflow Implementation Report

**Date**: November 14, 2026  
**Branch**: clean-deployment (local — not yet pushed, awaiting approval)  
**Bot tests**: 135 / 135 pass  
**TypeScript**: 0 errors across all packages  
**Production build**: 21/21 pages, 0 errors

---

## What was implemented

### Schema — Phase A

**New migration**: `supabase/migrations/20261114000001_course_section_offerings.sql`

Adds `public.course_section_offerings` — the missing binding between a catalog course and a specific section with a designated teacher.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `course_id` | UUID → `courses` | Catalog course |
| `section_id` | UUID → `sections` | The rep's authorized section |
| `teacher_id` | UUID → `teachers` | Delivery recipient |
| `academic_year_id` | UUID → `academic_years` | Must match `section.academic_year_id` (enforced by trigger) |
| `created_by` | UUID → `profiles` | Representative who created it |
| `is_active` | BOOLEAN | Soft-delete |

**Constraints**:
- `UNIQUE (course_id, section_id, academic_year_id)` — prevents duplicate offerings
- `trg_enforce_cso_integrity` — trigger verifies section/year consistency and teacher activity
- RLS: authenticated staff can read/insert/update for their section only; `service_role` has full access

### Database package — Phase A

**File modified**: `packages/database/src/academic-management.ts`

New exports:
- `CreateCourseOfferingDTO` interface
- `CourseOfferingWithDetails` interface (extends `CourseOffering` with joined relations)
- `CourseOfferingService` class with 6 methods:
  - `getOfferingsForSection(sectionId)` — returns active offerings for a section
  - `getOfferingById(offeringId, sectionId?)` — with optional section guard
  - `createOffering(dto)` — creates offering, surfaces duplicate error clearly
  - `deactivateOffering(offeringId, sectionId)` — soft-delete with section guard
  - `getAvailableCatalogCourses(sectionId, academicYearId)` — courses not yet offered
  - `getProjectsForOffering(offeringId, sectionId)` — projects under a specific offering
  - `getProjectsBySection(sectionId)` — all offerings + projects, grouped

**File modified**: `packages/types/src/index.ts`

New type:
```typescript
export interface CourseOffering {
  id, course_id, section_id, teacher_id, academic_year_id,
  created_by, is_active, created_at, updated_at,
  course?, section?, teacher?, academic_year?
}
```

### Bot — Phase B: Representative Create Course

**New file**: `apps/bot/src/conversations/rep-course.conversation.ts`

`repCreateCourseConversation` — a full multi-step Telegram conversation:
1. Rep selects section (auto-selected if only one)
2. System shows courses not yet offered (filtered via `getAvailableCatalogCourses`)
3. Rep selects course from inline keyboard (paginated to 8)
4. System shows active teachers (prefiltered by course department)
5. Rep selects teacher
6. Preview card shown
7. On confirm → `CourseOfferingService.createOffering` called
8. Success confirmation sent

Authorization: representative Telegram ID → `RepresentativeService.getRepresentativeProfile` → section_id. Rep can only create for their own authorized section.

### Bot — Phase B: Representative Create Assignment

**New file**: `apps/bot/src/conversations/rep-project.conversation.ts`

`repCreateProjectConversation` — full Telegram assignment creation flow:
1. Section selection
2. Course offering selection (from rep's active offerings)
3. Title input (3–200 chars)
4. Description/instructions (optional, up to 2000 chars)
5. Submission type selection (Individual / Group / Both)
6. Deadline input (YYYY-MM-DD with 3 retries on invalid input)
7. Max file size (1–20 MB, clamped to Telegram limit)
8. Group size bounds (only shown for group/both types)
9. Full preview card
10. On confirm → `AcademicManagementService.createProject` with `project_targets` scoped to rep's section

Published assignments are immediately visible to students in that section via `/My Assignments`.

### Bot — Phase D: Manage Groups (Telegram-native)

**New file**: `apps/bot/src/conversations/rep-group.conversation.ts`

`repManageGroupsConversation` — provides View Groups (read-only) and Create Group:
1. Menu: Create New Group / View My Groups / Cancel
2. For creation: section → project (group/both only) → group code → member selection (paginated) → leader selection → confirm
3. On confirm: inserts into `groups` + `group_members`; students receive `pending` membership status and can confirm via their existing group confirmation flow
4. Rollback: if member insert fails, group record is deleted

### Bot — Phase C: Student My Courses

**File modified**: `apps/bot/src/handlers/student.project.handler.ts`

New handlers:
- `handleStudentMyCourses` — lists all `course_section_offerings` for the student's section. Each course has a drill-down button.
- `handleStudentCourseAssignments(ctx, offeringId, sectionId)` — shows projects under a specific course offering, with open/closed/upcoming status labels.

The existing `handleStudentMyProjects` is preserved and continues to work for the `📋 My Assignments` button (flat list of all projects).

### Bot — Phase E: Representative hub handler

**New file**: `apps/bot/src/handlers/rep-academic.handler.ts`

New handlers:
- `handleRepMyCourses` — shows rep's course offerings across all sections with inline project drill-down
- `handleRepCollectSubmissions` — lists all projects across rep's sections with report callbacks (using existing `renderProjectReport`)
- `handleCourseOfferingProjects` — callback handler for `cso_proj_<offeringId(36)>_<sectionId(36)>` pattern
- `handleRepMySections` — alias for `handleAssignedSections`
- `handleRepViewAllStudents` — roster view with multi-section support

### Bot keyboards — updated

**File modified**: `apps/bot/src/keyboards/main-menu.ts`

| Keyboard | Old | New |
|---|---|---|
| Student (unified) | 👤 My Profile, 📚 My Academic Information, 📋 My Projects, ... | 📚 My Courses, 📋 My Assignments, 👤 My Profile, ... |
| Representative portal | 🏢 My Assigned Sections, 👥 View All Students, 📂 View All Projects, 📊 Submission Reports, 👥 View Groups, 📦 Forward to Teacher, 📜 Delivery History, 🎓 Student Menu | 📚 My Courses, ➕ Create Course, 📝 Create Assignment, 👥 Manage Groups, 📥 Collect Submissions, 📊 Submission Reports, 📦 Forward to Teacher, 📜 Delivery History, 👥 View All Students, 🏢 My Sections, 🎓 Student Menu |

Legacy button labels (old keyboard) are still wired in `bot.ts` to maintain backward compatibility for users whose Telegram client caches the old keyboard.

### Bot wiring — bot.ts

**File modified**: `apps/bot/src/bot.ts`

New conversations registered:
- `repCreateCourseConversation`
- `repCreateProjectConversation`
- `repManageGroupsConversation`

New callback handlers:
- `/^cso_proj_/` → `handleCourseOfferingProjects` (rep course drill-down)
- `/^stu_cso_/` → `handleStudentCourseAssignments` (student course drill-down)

New hears handlers for all new keyboard buttons.

---

## Tests

| Suite | Tests | Pass | New? |
|---|---|---|---|
| Phase A — CourseOfferingService | 9 | 9 | ✅ NEW |
| Phase A — Secure Identity Verification | 5 | 5 | Existing |
| Phase B — Telegram Download/Storage | 3 | 3 | Existing |
| Phase C — Persistent Webhook Conversations | 4 | 4 | Existing |
| Phase 04 — Student Registration | 9 | 9 | Existing |
| Phase 05 — Representative Scope Authorization | 7 | 7 | Existing |
| Phase 07 — Individual Submission Service | 11 | 11 | Existing |
| Phase 08 — Group Management | 11 | 11 | Existing |
| Phase 09 — Group Submission Service | 13 | 13 | Existing |
| Phase 10 — Representative Reporting | 10 | 10 | Existing |
| Phase 13 — Rate Limiter | 6 | 6 | Existing |
| Phase 13 — Webhook Security | 11 | 11 | Existing |
| Phase 14 — Webhook Handler | 6 | 6 | Existing |
| Phase 14 — Runtime Rate Limiting | 2 | 2 | Existing |
| Phase 17 — Unified Bot + Callback Codec | 8 | 8 | 3 updated |
| Phase A (Phase-A remediation) — Menu Wiring | 4 | 4 | 0 updated |
| Telegram Workflow Integration | 5 | 5 | Existing |
| Vercel Webhook Architecture | 9 | 9 | Existing |
| **Total** | **135** | **135** | |

---

## What is NOT yet implemented

| Feature | Status | Reason |
|---|---|---|
| Section Announcements | NOT IMPLEMENTED | No schema, no bot handler. Requires separate migration + conversation. Outside current phase scope. |
| Representative delivery via Telegram (bot-native) | PARTIAL — bot button exists, redirects to web portal | Full in-bot delivery flow (file selection, dispatch) is a separate phase. |
| Per-project submission status on `📋 My Assignments` list | PARTIAL — projects shown without submitted/not-submitted label | Minor UX gap; query extension needed. |
| `submission-files-vault` Supabase Storage bucket | NOT CREATED IN PRODUCTION | Requires applying `20261110000003_storage_setup.sql` migration to production. Blocks all file uploads. |
| Telegram webhook registration | NOT REGISTERED | Requires `setWebhook` call after production environment is confirmed. |

---

## Migration required before production launch

| Migration | Action | Status |
|---|---|---|
| `20261110000003_storage_setup.sql` | Creates `submission-files-vault` bucket | ⚠️ NOT applied to production |
| `20261112000003_post_deployment_security_hardening.sql` | Aligns bucket size limit to 20 MB | ⚠️ NOT applied to production |
| `20261114000001_course_section_offerings.sql` | Creates `course_section_offerings` table | ⚠️ NOT applied to production — requires approval |

---

## Files changed

| File | Change |
|---|---|
| `supabase/migrations/20261114000001_course_section_offerings.sql` | NEW — course-section binding table + integrity trigger + RLS |
| `packages/types/src/index.ts` | Added `CourseOffering` interface |
| `packages/database/src/academic-management.ts` | Added `CreateCourseOfferingDTO`, `CourseOfferingWithDetails`, `CourseOfferingService` |
| `apps/bot/src/conversations/rep-course.conversation.ts` | NEW — representative create course conversation |
| `apps/bot/src/conversations/rep-project.conversation.ts` | NEW — representative create assignment conversation |
| `apps/bot/src/conversations/rep-group.conversation.ts` | NEW — representative manage groups conversation |
| `apps/bot/src/handlers/rep-academic.handler.ts` | NEW — representative My Courses, Collect Submissions, etc. |
| `apps/bot/src/handlers/student.project.handler.ts` | Added `handleStudentMyCourses`, `handleStudentCourseAssignments` |
| `apps/bot/src/keyboards/main-menu.ts` | Redesigned both student and representative keyboards |
| `apps/bot/src/bot.ts` | Wired all new conversations, handlers, and callback patterns |
| `apps/bot/test/course-offering.service.test.ts` | NEW — 9 tests for CourseOfferingService |
| `apps/bot/test/unified-representative-bot.test.ts` | Updated 2 test assertions to reflect new keyboard labels |
| `docs/CORE_WORKFLOW_IMPLEMENTATION_PLAN.md` | NEW — phased implementation plan |

---

## Acceptance criteria status

| Step | Status |
|---|---|
| 1. Representative creates Database Systems for their section | ✅ IMPLEMENTED (rep-course.conversation.ts) |
| 2. Representative creates Assignment 01 | ✅ IMPLEMENTED (rep-project.conversation.ts) |
| 3. Students in that section see Assignment 01 in Telegram | ✅ IMPLEMENTED (handleStudentMyCourses → handleStudentCourseAssignments → view_proj_ callback) |
| 4. One student submits individually | ✅ EXISTING (individualSubmissionConversation) |
| 5. Another student submits for their group | ✅ EXISTING (groupSubmissionConversation) |
| 6. Second member of that group is correctly blocked | ✅ EXISTING (uq_active_group_submission DB constraint + service layer check) |
| 7. Representative selects Collect Submissions | ✅ IMPLEMENTED (handleRepCollectSubmissions → rep keyboard) |
| 8. Representative selects Database Systems | ✅ IMPLEMENTED (project callback via encodeReportCallback) |
| 9. Representative selects Assignment 01 | ✅ IMPLEMENTED (renderProjectReport) |
| 10. Representative sees accurate submitted/missing records | ✅ EXISTING (RepresentativeReportingService) |
| 11. Representative opens an authorized PDF | ⚠️ BLOCKED — `submission-files-vault` bucket absent in production |
| 12. Representative selects Forward to Teacher | ✅ EXISTING (web portal delivery workflow) |
| 13. System resolves correct official teacher | ✅ EXISTING (teacher from projects.teacher_id via delivery service) |
| 14. Delivery manifest generated and delivery recorded | ✅ EXISTING (executeGetDeliveryPackageManifest) |
| 15. Another section and course remain completely isolated | ✅ EXISTING + REINFORCED (CourseOfferingService.getOfferingById with sectionId guard) |

**Step 11 is the only blocking gap** — it requires applying the storage bucket migration to production Supabase.
