# HU-ASMS: Individual Submission Workflow Architecture

## 1. Overview

The Individual Submission engine allows registered and verified students to submit academic documents directly through the Telegram Bot (`apps/bot`).

Submissions are subject to strict security, scope-based eligibility, duplicate prevention, and automated routing rules:
1. **Automatic Scope Resolution**: The system retrieves the student's verified `academic_year_id` and `section_id`. Students cannot choose or alter their academic section or representative manually.
2. **Private Storage Vault**: Files are stored in private Supabase Storage (`submission-files-vault`). Only storage paths (not public URLs) and file metadata are saved in PostgreSQL.
3. **Duplicate Prevention & Versioning**:
   - Database constraint `uq_active_individual_submission` permits only **one active submission** per student per project.
   - If `resubmission_allowed` is true, submitting a new file increments `version` (e.g. `v1` -> `v2`), marks the previous record as `superseded`, and preserves complete historical records.
   - If `resubmission_allowed` is false, duplicate submissions are rejected immediately.
4. **Automatic Representative Routing**: Submissions resolve the section's active representatives from `representative_assignments` and dispatch real-time alerts. Notification failure is non-blocking to prevent corrupting or aborting successful submissions.
5. **Auditing**: Every submission and resubmission creates an immutable record in `audit_logs`.

---

## 2. End-to-End Submission Pipeline

```mermaid
sequenceDiagram
    autonumber
    actor Student as Verified Student (Telegram)
    participant Bot as Telegram Bot (grammY)
    participant SubSvc as IndividualSubmissionService
    participant Storage as Supabase Storage (Vault)
    participant DB as PostgreSQL Database
    participant NotifSvc as NotificationService
    actor Rep as Section Representative

    Student->>Bot: /submit or "📤 Submit Assignment"
    Bot->>DB: Fetch student profile (Year, Section)
    Bot->>DB: Fetch active projects targeted to student scope
    Bot-->>Student: Display eligible open projects inline keyboard
    Student->>Bot: Select Project (e.g. "Database Assignment 1")
    Bot-->>Student: Display file rules, deadline & prompt for document
    Student->>Bot: Uploads PDF document

    Bot->>SubSvc: submitIndividualAssignment(telegramUserId, projectId, file)
    SubSvc->>DB: Check student registration status (must be active/locked)
    SubSvc->>DB: Check project eligibility, opening date & deadline
    SubSvc->>SubSvc: Validate file extension, MIME type, file size
    SubSvc->>DB: Check active submission (handle duplicate / versioning)
    
    SubSvc->>Storage: Upload to projects/{id}/individual/{studentId}/v{N}_{file}
    SubSvc->>DB: Insert submissions (status='active', version=N)
    SubSvc->>DB: Insert submission_files (storage_path, size, checksum)
    SubSvc->>DB: Insert submission_members (student snapshot)
    SubSvc->>DB: Log audit event (SUBMISSION_CREATED)
    
    par Async Representative Notification
        SubSvc->>NotifSvc: notifyRepresentativeOfSubmission(...)
        NotifSvc->>DB: Queue notification
        NotifSvc->>Rep: Send direct Telegram alert
    end

    SubSvc-->>Bot: Submission Result (version, filename, timestamp)
    Bot-->>Student: 🎉 Submission Received Confirmation (Receipt)
```

---

## 3. Storage Hierarchy

Stored files follow an isolated relational folder hierarchy inside `submission-files-vault`:

```
submission-files-vault/
└── projects/
    └── {project_id}/
        ├── individual/
        │   └── {student_id}/
        │       ├── v1_assignment1.pdf        (status: 'superseded')
        │       └── v2_assignment1_rev.pdf    (status: 'active')
        └── groups/
            └── {group_id}/
                ├── v1_group_project.pdf      (status: 'superseded')
                └── v2_group_project_rev.pdf  (status: 'active')
```
- Short-lived signed download URLs (valid for 15–60 minutes) are generated on demand for authorized representatives.
- Files cannot be accessed publicly without Supabase authentication and matching representative section assignment.

---

## 4. Group Submission Architecture (Phase 09)

The Group Submission engine enforces strict multi-tenant teamwork verification and designated leader authorization before any group artifact can be ingested into the private vault.

### Core Security Invariants
1. **Verification Gate**:
   - Only groups with `status = 'verified'` can submit.
   - A group only becomes verified when **100% of assigned members independently confirm** via their Telegram accounts.
   - If any member is pending or declined, submissions are completely blocked, displaying the list of unconfirmed students.
2. **Sole Submitter Principle (Designated Leader)**:
   - Only the designated group leader (`groups.group_leader_id`) who has confirmed membership can upload the final project artifact.
   - Submissions from non-leader members or students outside the group are rejected immediately with descriptive guidance.
3. **Partitioned Scope & Foreign Keys**:
   - `submissions.submission_type` is `'group'`.
   - `submissions.student_id` is strictly `NULL`.
   - `submissions.group_id` references the verified group.
   - Submissions are restricted to the group's assigned project and section.
4. **Duplicate Prevention & Resubmissions**:
   - Database constraint `uq_active_group_submission` guarantees only **one active submission** per group per project.
   - If `resubmission_allowed = false`, subsequent submissions are blocked with an official duplicate warning notice.
   - If `resubmission_allowed = true`, submitting a new file increments `version` (e.g., `v1` $\rightarrow$ `v2`), supersedes the previous active record, and preserves the full audit trail.
5. **Team Snapshotting**:
   - At the exact moment of submission, all confirmed members of the group are snapshot into `submission_members` (recording `student_id`, `hu_student_id`, `student_name`, and `is_submitter: true` for the leader).
   - This ensures permanent academic attribution even if group configurations are later modified.
6. **Non-Blocking Representative Routing**:
   - Dispatches a real-time notification to the section representative. Any network or Telegram delivery failure is caught and logged, guaranteeing that student submissions are never aborted or corrupted.

### Group Submission Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Leader as Designated Group Leader
    participant Bot as Telegram Bot (grammY)
    participant GroupSvc as GroupSubmissionService
    participant Storage as Supabase Storage (Vault)
    participant DB as PostgreSQL Database
    participant NotifSvc as NotificationService
    actor Rep as Section Representative

    Leader->>Bot: /submit_group or "🚀 Submit Group Project"
    Bot->>DB: Resolve student & query assigned groups
    Bot->>Bot: Check group verification status (100% confirmed)
    Bot->>Bot: Validate sole submitter (must be group_leader_id)
    Bot-->>Leader: Display verified members, deadline, rules & file prompt
    Leader->>Bot: Uploads Group Project document (PDF/ZIP)

    Bot->>GroupSvc: submitGroupAssignment(telegramUserId, groupId, projectId, file)
    GroupSvc->>DB: Validate registered student & active group record
    GroupSvc->>GroupSvc: Enforce Verification Gate (status == 'verified')
    GroupSvc->>GroupSvc: Enforce Sole Submitter (group_leader_id == student.id)
    GroupSvc->>DB: Validate project deadline & allowed file extensions/size
    GroupSvc->>DB: Check existing active submission (enforce uq_active_group_submission)

    GroupSvc->>Storage: Upload to projects/{id}/groups/{groupId}/v{N}_{file}
    GroupSvc->>DB: Insert submissions (type='group', group_id, student_id=null, version=N)
    GroupSvc->>DB: Insert submission_files (storage_path, mime, size)
    GroupSvc->>DB: Insert submission_members (snapshot all confirmed members)
    GroupSvc->>DB: Update groups set status='submitted'
    GroupSvc->>DB: Log audit event (GROUP_SUBMISSION_CREATED)

    par Async Representative Notification
        GroupSvc->>NotifSvc: notifyRepresentativeOfSubmission(...)
        NotifSvc->>Rep: Direct Telegram notification (Group code, leader, scope)
    end

    GroupSvc-->>Bot: Group Submission Result (groupCode, version, creditedCount)
    Bot-->>Leader: 🎉 Group Submission Successfully Received! (Receipt)
```
