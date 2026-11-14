# HU-ASMS Core Academic Workflow Implementation Plan

**Date**: November 14, 2026  
**Branch**: clean-deployment (local — not pushed until approved)

---

## Schema gap: `courses` is a pure catalog

`courses(id, code, title, department_id)` — no `section_id`, no `teacher_id`, no `academic_year_id`.

Section + teacher binding lives in `projects` → `project_targets`.

The spec asks representatives to "Create Course" and "Create Assignment". The correct
mapping to the existing schema is:

| Spec term | Maps to |
|---|---|
| "Create Course" for a section | Insert into `courses` (catalog) **plus** create a `course_section_offerings` record |
| "My Courses" | `course_section_offerings` filtered by rep's section |
| "Create Assignment/Project" | Insert `projects` + `project_targets` + `project_file_rules` for the course offering |
| "Student: My Courses" | `course_section_offerings` for student's section |
| "Student: My Assignments" | `projects` targeted to student's section under a chosen course |

A new migration is required: `course_section_offerings`.

---

## Migration required: `course_section_offerings`

```sql
CREATE TABLE IF NOT EXISTS course_section_offerings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_course_section_offering UNIQUE (course_id, section_id, academic_year_id)
);
```

This binds a course to a specific section + academic year with a designated teacher.
When a representative creates an assignment, they select from their section's offerings.

---

## Phases

### Phase A — `course_section_offerings` migration + database service

Files changed:
- `supabase/migrations/20261114000001_course_section_offerings.sql` (NEW)
- `packages/database/src/academic-management.ts` — add `CourseOfferingService` methods
- `packages/types/src/index.ts` — add `CourseOffering` type
- Tests: `apps/bot/test/course-offering.service.test.ts` (NEW)

### Phase B — Representative bot: Course and Assignment creation conversations

Files changed:
- `apps/bot/src/conversations/rep-course.conversation.ts` (NEW)
- `apps/bot/src/conversations/rep-project.conversation.ts` (NEW)
- `apps/bot/src/handlers/rep-academic.handler.ts` (NEW)
- `apps/bot/src/keyboards/main-menu.ts` — update rep keyboard
- `apps/bot/src/bot.ts` — register new conversations and handlers

### Phase C — Student bot: My Courses + My Assignments browsing

Files changed:
- `apps/bot/src/handlers/student.project.handler.ts` — add `handleStudentMyCourses`, update `handleStudentMyProjects`
- `apps/bot/src/keyboards/main-menu.ts` — update student keyboard labels
- `apps/bot/src/bot.ts` — register new handlers

### Phase D — Representative bot: Manage Groups (create group via Telegram)

Files changed:
- `apps/bot/src/conversations/rep-group.conversation.ts` (NEW)
- `apps/bot/src/handlers/rep-academic.handler.ts` — add `handleRepManageGroups`
- `apps/bot/src/bot.ts` — register new conversation

### Phase E — Representative bot: Collect Submissions + dedicated keyboard button

Files changed:
- `apps/bot/src/handlers/rep-academic.handler.ts` — `handleCollectSubmissions`
- `apps/bot/src/keyboards/main-menu.ts` — add "📥 Collect Submissions" button

### Phase F — Representative bot: Forward to Teacher (full Telegram flow)

Currently `handleRepForwardToTeacher` redirects to web portal.
Phase F adds a Telegram-native delivery preparation conversation.

Files changed:
- `apps/bot/src/conversations/rep-delivery.conversation.ts` (NEW)
- `apps/bot/src/handlers/rep-academic.handler.ts` — update `handleRepForwardToTeacher`

### Phase G — Supabase Storage bucket creation script + verification

Files changed:
- `supabase/migrations/20261114000002_ensure_storage_bucket.sql` (NEW — idempotent)

### Phase H — Integration tests + build verification

Files changed:
- Multiple test files extended
- Full typecheck and build
