  // HU-ASMS: Group Submission Service (Phase 09)
// Handles verified group submissions, sole authorized submitter check, duplicate prevention, and team snapshots

import type { SupabaseClient } from '@hu-asms/database';
import type {
  Group,
  GroupMember,
  Student,
  Project,
  Submission,
  SubmissionFile,
} from '@hu-asms/types';
import { validateSubmissionFile } from '@hu-asms/validation';
import { NotificationService } from './notification.service.js';
import { BOT_MESSAGES } from '@hu-asms/shared';

export class GroupSubmissionError extends Error {
  constructor(message: string, public code: string, public groupNotice?: string) {
    super(message);
    this.name = 'GroupSubmissionError';
  }
}

export interface GroupSubmissionInput {
  telegramUserId: number;
  groupId: string;
  projectId: string;
  file: {
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    buffer?: Buffer;
    telegramFileId?: string;
  };
}

export interface GroupSubmissionResult {
  submission: Submission;
  file: SubmissionFile;
  version: number;
  isResubmission: boolean;
  assignedRepresentativeNotified: boolean;
  groupCode: string;
  confirmedMembersCount: number;
}

export class GroupSubmissionService {
  constructor(
    private client: SupabaseClient,
    private notificationService?: NotificationService,
    private storageUploader?: (
      bucket: string,
      path: string,
      fileData: Buffer | Uint8Array,
      mimeType: string
    ) => Promise<{ path: string; error?: Error | null }>
  ) {}

  /**
   * Processes a group assignment submission end-to-end:
   * 1. Resolves submitting student via Telegram numeric ID.
   * 2. Checks group verification gate (100% member confirmation required).
   * 3. Validates submitter authorization (must be confirmed group leader).
   * 4. Validates project submission window and file rules.
   * 5. Enforces duplicate active submission prevention at service & database levels.
   * 6. Uploads document to private Supabase Storage vault.
   * 7. Records submission, file metadata, and member snapshots.
   * 8. Dispatches real-time alert to the assigned section representative (non-blocking).
   */
  async submitGroupAssignment(input: GroupSubmissionInput): Promise<GroupSubmissionResult> {
    // -------------------------------------------------------------------------
    // 1. Resolve registered student identity
    // -------------------------------------------------------------------------
    const { data: student, error: studentErr } = await this.client
      .from('students')
      .select('*, department:departments(*), academic_year:academic_years(*), section:sections(*)')
      .eq('telegram_user_id', input.telegramUserId)
      .maybeSingle();

    if (studentErr || !student) {
      throw new GroupSubmissionError(
        'Student identity not found. Please register via /start.',
        'UNREGISTERED_STUDENT'
      );
    }

    if (student.registration_status === 'suspended') {
      throw new GroupSubmissionError(
        `Account suspended: ${student.suspension_reason || 'Administrative hold'}. Submissions disabled.`,
        'ACCOUNT_SUSPENDED'
      );
    }

    // -------------------------------------------------------------------------
    // 2. Fetch Group and validate Verification Gate
    // -------------------------------------------------------------------------
    const { data: group, error: grpErr } = await this.client
      .from('groups')
      .select(`
        *,
        project:projects(*, file_rules:project_file_rules(*)),
        section:sections(*, academic_year:academic_years(*)),
        leader:students!groups_group_leader_id_fkey(*),
        members:group_members(*, student:students(*))
      `)
      .eq('id', input.groupId)
      .maybeSingle();

    if (grpErr || !group) {
      throw new GroupSubmissionError('Group record not found.', 'GROUP_NOT_FOUND');
    }

    if (group.project_id !== input.projectId) {
      throw new GroupSubmissionError(
        'The specified group does not belong to this project.',
        'PROJECT_MISMATCH'
      );
    }

    // INVARIANT 1: Only VERIFIED groups can submit!
    if (group.status !== 'verified') {
      const pendingMembers = (group.members || [])
        .filter((m: any) => m.confirmation_status !== 'confirmed')
        .map((m: any) => m.student?.full_name || m.student_id);

      throw new GroupSubmissionError(
        `Your group is not fully verified yet. Group status: "${group.status.toUpperCase()}". Pending confirmations: ${pendingMembers.join(', ')}. All members must confirm membership before submitting.`,
        'GROUP_NOT_VERIFIED'
      );
    }

    // -------------------------------------------------------------------------
    // 3. Submitter Authorization Check (Sole submitter principle)
    // -------------------------------------------------------------------------
    const memberRecord = (group.members || []).find(
      (m: any) => m.student_id === student.id
    );

    if (!memberRecord) {
      throw new GroupSubmissionError(
        'You do not belong to this group.',
        'NOT_GROUP_MEMBER'
      );
    }

    if (memberRecord.confirmation_status !== 'confirmed') {
      throw new GroupSubmissionError(
        'You have not confirmed your membership in this group.',
        'MEMBERSHIP_NOT_CONFIRMED'
      );
    }

    // Must be the designated group leader to submit for the entire team
    if (group.group_leader_id && group.group_leader_id !== student.id) {
      const leaderName = group.leader?.full_name || 'Designated Group Leader';
      throw new GroupSubmissionError(
        `Only the designated group leader (${leaderName}) is authorized to submit the final file for ${group.group_code}.`,
        'UNAUTHORIZED_SUBMITTER'
      );
    }

    // -------------------------------------------------------------------------
    // 4. Validate Project Deadline & Availability Window
    // -------------------------------------------------------------------------
    const project = group.project;
    if (!project || !project.is_active) {
      throw new GroupSubmissionError('Project is inactive or not found.', 'PROJECT_NOT_FOUND');
    }

    const now = new Date();
    const openingDate = new Date(project.opening_date);
    const deadline = new Date(project.deadline);

    if (now < openingDate) {
      throw new GroupSubmissionError(
        `This assignment is not open yet. Opening date: ${openingDate.toUTCString()}`,
        'PROJECT_NOT_OPEN'
      );
    }

    if (now > deadline) {
      throw new GroupSubmissionError(
        `Submission deadline has passed. Deadline was: ${deadline.toUTCString()}`,
        'DEADLINE_EXCEEDED'
      );
    }

    // -------------------------------------------------------------------------
    // 5. Validate File Constraints
    // -------------------------------------------------------------------------
    const fileRules = project.file_rules;
    if (fileRules) {
      const validation = validateSubmissionFile({
        filename: input.file.originalFilename,
        mimeType: input.file.mimeType,
        sizeBytes: input.file.sizeBytes,
        allowedExtensions: fileRules.allowed_extensions || ['pdf'],
        allowedMimeTypes: fileRules.allowed_mime_types || ['application/pdf'],
        maxSizeBytes: fileRules.max_file_size_bytes || 20971520,
      });

      if (!validation.valid) {
        throw new GroupSubmissionError(
          validation.error || 'File validation failed.',
          'INVALID_FILE'
        );
      }
    }

    // -------------------------------------------------------------------------
    // 6. Duplicate Active Submission Prevention & Versioning
    // -------------------------------------------------------------------------
    const { data: existingActiveSub } = await this.client
      .from('submissions')
      .select('*, files:submission_files(*)')
      .eq('project_id', project.id)
      .eq('group_id', group.id)
      .eq('submission_type', 'group')
      .eq('status', 'active')
      .maybeSingle();

    let newVersion = 1;
    let isResubmission = false;

    if (existingActiveSub) {
      if (!project.resubmission_allowed) {
        const notice = BOT_MESSAGES.ALREADY_SUBMITTED_GROUP(group.group_code, project.title);
        throw new GroupSubmissionError(
          `Your group has already submitted this project. Resubmissions are disabled.`,
          'DUPLICATE_GROUP_SUBMISSION',
          notice
        );
      }

      // Resubmission permitted: Supersede existing active submission
      isResubmission = true;
      newVersion = (existingActiveSub.version || 1) + 1;

      const { error: supersedeErr } = await this.client
        .from('submissions')
        .update({ status: 'superseded' })
        .eq('id', existingActiveSub.id);

      if (supersedeErr) throw supersedeErr;
    }

    // -------------------------------------------------------------------------
    // 7. Store document in private Supabase Storage
    // -------------------------------------------------------------------------
    const sanitizedFilename = input.file.originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `projects/${project.id}/groups/${group.id}/v${newVersion}_${sanitizedFilename}`;

    if (input.file.buffer) {
      if (this.storageUploader) {
        const uploadRes = await this.storageUploader(
          'submission-files-vault',
          storagePath,
          input.file.buffer,
          input.file.mimeType
        );
        if (uploadRes.error) {
          throw new GroupSubmissionError(
            `Storage upload failed: ${uploadRes.error.message}`,
            'STORAGE_UPLOAD_FAILED'
          );
        }
      } else {
        const { error: uploadErr } = await this.client.storage
          .from('submission-files-vault')
          .upload(storagePath, input.file.buffer, {
            contentType: input.file.mimeType,
            upsert: true,
          });

        if (uploadErr) {
          throw new GroupSubmissionError(
            `Private storage upload failed: ${uploadErr.message}`,
            'STORAGE_UPLOAD_FAILED'
          );
        }
      }
    }

    // -------------------------------------------------------------------------
    // 8. Record master submission record (group_id NOT NULL, student_id NULL)
    // -------------------------------------------------------------------------
    const { data: submission, error: insertSubErr } = await this.client
      .from('submissions')
      .insert({
        project_id: project.id,
        section_id: group.section_id,
        submission_type: 'group',
        student_id: null, // Strictly null for group submission
        group_id: group.id,
        version: newVersion,
        status: 'active',
        submitted_by_telegram_id: input.telegramUserId,
      })
      .select()
      .single();

    if (insertSubErr) throw insertSubErr;

    // -------------------------------------------------------------------------
    // 9. Record submission file metadata
    // -------------------------------------------------------------------------
    const { data: subFile, error: insertFileErr } = await this.client
      .from('submission_files')
      .insert({
        submission_id: submission.id,
        original_filename: input.file.originalFilename,
        storage_path: storagePath,
        file_size_bytes: input.file.sizeBytes,
        mime_type: input.file.mimeType,
        telegram_file_id: input.file.telegramFileId || null,
      })
      .select()
      .single();

    if (insertFileErr) throw insertFileErr;

    // -------------------------------------------------------------------------
    // 10. Snapshot verified group members at submission time
    // -------------------------------------------------------------------------
    const confirmedMembers = (group.members || []).filter(
      (m: any) => m.confirmation_status === 'confirmed'
    );

    const memberSnapshots = confirmedMembers.map((m: any) => ({
      submission_id: submission.id,
      student_id: m.student_id,
      hu_student_id: m.student?.hu_student_id || 'UNKNOWN',
      student_name: m.student?.full_name || 'Group Member',
      is_submitter: m.student_id === student.id,
    }));

    if (memberSnapshots.length > 0) {
      await this.client.from('submission_members').insert(memberSnapshots);
    }

    // -------------------------------------------------------------------------
    // 11. Update group status to 'submitted'
    // -------------------------------------------------------------------------
    await this.client
      .from('groups')
      .update({ status: 'submitted' })
      .eq('id', group.id);

    // -------------------------------------------------------------------------
    // 12. Auto-route and notify assigned section representative (non-blocking)
    // -------------------------------------------------------------------------
    let representativeNotified = false;
    if (this.notificationService) {
      try {
        const notifyRes = await this.notificationService.notifyRepresentativeOfSubmission({
          sectionId: group.section_id,
          projectTitle: project.title,
          scopeName: `${group.section?.academic_year?.name || 'Academic Year'} — ${group.section?.name || 'Section'}`,
          studentOrGroupName: `${group.group_code} (Submitted by ${student.full_name})`,
          fileName: input.file.originalFilename,
          fileSizeBytes: input.file.sizeBytes,
          submissionType: 'group',
        });
        representativeNotified = notifyRes.dispatchedCount > 0;
      } catch (notifyErr) {
        console.error('Group submission representative notification failed (non-blocking):', notifyErr);
      }
    }

    // -------------------------------------------------------------------------
    // 13. Audit log
    // -------------------------------------------------------------------------
    await this.client.from('audit_logs').insert({
      actor_telegram_id: input.telegramUserId,
      actor_role: 'group_leader',
      action: isResubmission ? 'GROUP_SUBMISSION_RESUBMITTED' : 'GROUP_SUBMISSION_CREATED',
      entity_type: 'submission',
      entity_id: submission.id,
      metadata: {
        project_id: project.id,
        group_id: group.id,
        group_code: group.group_code,
        submitter_student_id: student.id,
        version: newVersion,
        filename: input.file.originalFilename,
        file_size_bytes: input.file.sizeBytes,
        members_count: confirmedMembers.length,
      },
    });

    return {
      submission,
      file: subFile,
      version: newVersion,
      isResubmission,
      assignedRepresentativeNotified: representativeNotified,
      groupCode: group.group_code,
      confirmedMembersCount: confirmedMembers.length,
    };
  }
}
