// HU-ASMS: Individual Submission Service (Phase 07)
// Manages document validation, private storage, duplicate prevention, versioning, and representative routing

import type { SupabaseClient } from '@hu-asms/database';
import type {
  Student,
  Project,
  Submission,
  SubmissionFile,
} from '@hu-asms/types';
import { SYSTEM_CONSTANTS, resolveEffectiveTelegramMaxFileSizeBytes } from '@hu-asms/shared';
import { NotificationService } from './notification.service.js';
import {
  SubmissionBinaryError,
  cleanupOrphanedVaultObject,
  uploadSubmissionToVault,
  validateAndPrepareSubmissionBinary,
  type StorageRemoverFn,
  type StorageUploaderFn,
} from '../utils/submission-storage.js';

export class SubmissionError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'SubmissionError';
  }
}

export interface IndividualSubmissionInput {
  telegramUserId: number;
  projectId: string;
  file: {
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    buffer?: Buffer;
    telegramFileId?: string;
  };
}

export interface SubmissionResult {
  submission: Submission;
  file: SubmissionFile;
  version: number;
  isResubmission: boolean;
  assignedRepresentativeNotified: boolean;
}

export class IndividualSubmissionService {
  constructor(
    private client: SupabaseClient,
    private notificationService?: NotificationService,
    private storageUploader?: StorageUploaderFn,
    private storageRemover?: StorageRemoverFn
  ) {}

  /**
   * Processes an individual assignment submission end-to-end:
   * 1. Verifies student identity from numeric Telegram ID.
   * 2. Checks academic eligibility and deadline window.
   * 3. Validates file extension, MIME type, and size.
   * 4. Enforces duplicate submission prevention / versioning.
   * 5. Uploads to private Supabase storage.
   * 6. Records submission, files, and member snapshot in DB transaction.
   * 7. Routes submission to assigned representative and sends alert.
   */
  async submitIndividualAssignment(
    input: IndividualSubmissionInput
  ): Promise<SubmissionResult> {
    // -------------------------------------------------------------------------
    // 1. Resolve registered student identity
    // -------------------------------------------------------------------------
    const { data: student, error: studentErr } = await this.client
      .from('students')
      .select('*, department:departments(*), academic_year:academic_years(*), section:sections(*)')
      .eq('telegram_user_id', input.telegramUserId)
      .maybeSingle();

    if (studentErr || !student) {
      throw new SubmissionError(
        'Student not found. Please complete official registration via /start.',
        'UNREGISTERED_STUDENT'
      );
    }

    if (student.registration_status === 'suspended') {
      throw new SubmissionError(
        `Account is suspended: ${student.suspension_reason || 'Administrative hold'}. Submissions disabled.`,
        'ACCOUNT_SUSPENDED'
      );
    }

    // -------------------------------------------------------------------------
    // 2. Validate project eligibility and submission window
    // -------------------------------------------------------------------------
    const { data: project, error: projErr } = await this.client
      .from('projects')
      .select(`
        *,
        course:courses(*),
        teacher:teachers(*),
        file_rules:project_file_rules(*),
        targets:project_targets!inner(*)
      `)
      .eq('id', input.projectId)
      .eq('is_active', true)
      .maybeSingle();

    if (projErr || !project) {
      throw new SubmissionError('Project not found or inactive.', 'PROJECT_NOT_FOUND');
    }

    if (project.submission_type === 'group') {
      throw new SubmissionError(
        'This project is configured for group submissions only. Please use the Group Submission menu.',
        'INVALID_SUBMISSION_TYPE'
      );
    }

    // Check scope target match (student's academic year and section)
    const targets = project.targets || [];
    const isTargeted = targets.some((t: any) => {
      const yearMatches = t.academic_year_id === student.academic_year_id;
      const sectionMatches = !t.section_id || t.section_id === student.section_id;
      return yearMatches && sectionMatches;
    });

    if (!isTargeted) {
      throw new SubmissionError(
        'You are not eligible for this project based on your registered academic section.',
        'NOT_ELIGIBLE_SCOPE'
      );
    }

    const now = new Date();
    const openingDate = new Date(project.opening_date);
    const deadline = new Date(project.deadline);

    if (now < openingDate) {
      throw new SubmissionError(
        `This assignment is not yet open. Opening date: ${openingDate.toUTCString()}`,
        'PROJECT_NOT_OPEN'
      );
    }

    if (now > deadline) {
      throw new SubmissionError(
        `Submission deadline has passed. Deadline was: ${deadline.toUTCString()}`,
        'DEADLINE_EXCEEDED'
      );
    }

    // -------------------------------------------------------------------------
    // 3. Validate uploaded file metadata, downloaded binary bytes, and content
    // -------------------------------------------------------------------------
    const fileRules = project.file_rules;
    let preparedBinary;
    try {
      preparedBinary = validateAndPrepareSubmissionBinary(input.file, {
        allowedExtensions: fileRules?.allowed_extensions || ['pdf'],
        allowedMimeTypes: fileRules?.allowed_mime_types || ['application/pdf'],
        maxSizeBytes: resolveEffectiveTelegramMaxFileSizeBytes(fileRules?.max_file_size_bytes),
      });
    } catch (err: unknown) {
      if (err instanceof SubmissionBinaryError) {
        throw new SubmissionError(err.message, err.code);
      }
      throw err;
    }

    // -------------------------------------------------------------------------
    // 4. Duplicate prevention & version determination (before mutating DB)
    // -------------------------------------------------------------------------
    const { data: existingActiveSub } = await this.client
      .from('submissions')
      .select('*, files:submission_files(*)')
      .eq('project_id', input.projectId)
      .eq('student_id', student.id)
      .eq('status', 'active')
      .maybeSingle();

    let newVersion = 1;
    let isResubmission = false;

    if (existingActiveSub) {
      if (!project.resubmission_allowed) {
        throw new SubmissionError(
          `You have already submitted this assignment. Resubmissions are disabled for this project.`,
          'DUPLICATE_SUBMISSION'
        );
      }
      isResubmission = true;
      newVersion = (existingActiveSub.version || 1) + 1;
    }

    // -------------------------------------------------------------------------
    // 5. Upload validated file bytes to private Supabase Storage FIRST
    // -------------------------------------------------------------------------
    const storagePath = `projects/${project.id}/individual/${student.id}/v${newVersion}_${preparedBinary.safeFilename}`;

    let storedPath: string;
    try {
      storedPath = await uploadSubmissionToVault(
        this.client,
        storagePath,
        preparedBinary.buffer,
        preparedBinary.mimeType,
        this.storageUploader
      );
    } catch (err: unknown) {
      if (err instanceof SubmissionBinaryError) {
        throw new SubmissionError(err.message, err.code);
      }
      throw new SubmissionError('Private storage upload failed.', 'STORAGE_UPLOAD_FAILED');
    }

    // -------------------------------------------------------------------------
    // 6. Persist submission, file metadata (with SHA-256), and member snapshot
    //    If any DB step fails, remove uploaded storage file & restore prior version.
    // -------------------------------------------------------------------------
    let supersededExisting = false;
    let createdSubmissionId: string | null = null;
    let submission: Submission;
    let subFile: SubmissionFile;

    try {
      if (existingActiveSub) {
        const { error: supersedeErr } = await this.client
          .from('submissions')
          .update({ status: 'superseded' })
          .eq('id', existingActiveSub.id);

        if (supersedeErr) throw supersedeErr;
        supersededExisting = true;
      }

      const { data: createdSub, error: insertSubErr } = await this.client
        .from('submissions')
        .insert({
          project_id: project.id,
          section_id: student.section_id,
          submission_type: 'individual',
          student_id: student.id,
          group_id: null,
          version: newVersion,
          status: 'active',
          submitted_by_telegram_id: input.telegramUserId,
        })
        .select()
        .single();

      if (insertSubErr || !createdSub) {
        throw insertSubErr || new Error('Failed to create submission record.');
      }
      submission = createdSub;
      createdSubmissionId = createdSub.id;

      const { data: createdFile, error: insertFileErr } = await this.client
        .from('submission_files')
        .insert({
          submission_id: submission.id,
          original_filename: input.file.originalFilename,
          storage_path: storedPath,
          file_size_bytes: preparedBinary.actualSizeBytes,
          mime_type: preparedBinary.mimeType,
          checksum_sha256: preparedBinary.checksumSha256,
          telegram_file_id: input.file.telegramFileId || null,
        })
        .select()
        .single();

      if (insertFileErr || !createdFile) {
        throw insertFileErr || new Error('Failed to persist submission file metadata.');
      }
      subFile = createdFile;

      const memberRes = await this.client.from('submission_members').insert({
        submission_id: submission.id,
        student_id: student.id,
        hu_student_id: student.hu_student_id,
        student_name: student.full_name,
        is_submitter: true,
      });
      if (memberRes?.error) {
        throw memberRes.error;
      }
    } catch (dbErr: unknown) {
      await cleanupOrphanedVaultObject(this.client, storedPath, this.storageRemover);

      if (createdSubmissionId) {
        try {
          const membersTbl = (this.client as any)?.from?.('submission_members');
          if (typeof membersTbl?.delete === 'function') {
            await membersTbl.delete().eq('submission_id', createdSubmissionId);
          }
          const filesTbl = (this.client as any)?.from?.('submission_files');
          if (typeof filesTbl?.delete === 'function') {
            await filesTbl.delete().eq('submission_id', createdSubmissionId);
          }
          const subsTbl = (this.client as any)?.from?.('submissions');
          if (typeof subsTbl?.delete === 'function') {
            await subsTbl.delete().eq('id', createdSubmissionId);
          }
        } catch {
          // Best-effort cleanup of partially written rows
        }
      }

      if (supersededExisting && existingActiveSub) {
        try {
          await this.client
            .from('submissions')
            .update({ status: 'active' })
            .eq('id', existingActiveSub.id);
        } catch {
          // Best-effort restoration of prior active submission
        }
      }

      const msg = dbErr instanceof Error ? dbErr.message : String((dbErr as any)?.message || dbErr);
      throw new SubmissionError(
        `Submission persistence failed and uploaded file was rolled back: ${msg}`,
        'DATABASE_PERSISTENCE_FAILED'
      );
    }

    // -------------------------------------------------------------------------
    // 7. Route and notify assigned representative
    // -------------------------------------------------------------------------
    let representativeNotified = false;
    if (this.notificationService) {
      try {
        const notifyRes = await this.notificationService.notifyRepresentativeOfSubmission({
          sectionId: student.section_id,
          projectTitle: project.title,
          scopeName: `${student.academic_year?.name || 'Academic Year'} — ${student.section?.name || 'Section'}`,
          studentOrGroupName: student.full_name,
          huStudentId: student.hu_student_id,
          fileName: input.file.originalFilename,
          fileSizeBytes: preparedBinary.actualSizeBytes,
          submissionType: 'individual',
        });
        representativeNotified = notifyRes.dispatchedCount > 0;
      } catch (notifyErr) {
        // Notification failure must NOT abort or corrupt the successful submission
        console.error('Representative notification failed (non-blocking):', notifyErr);
      }
    }

    // -------------------------------------------------------------------------
    // 8. Audit log recording
    // -------------------------------------------------------------------------
    await this.client.from('audit_logs').insert({
      actor_telegram_id: input.telegramUserId,
      actor_role: 'student',
      action: isResubmission ? 'SUBMISSION_RESUBMITTED' : 'SUBMISSION_CREATED',
      entity_type: 'submission',
      entity_id: submission.id,
      metadata: {
        project_id: project.id,
        student_id: student.id,
        hu_student_id: student.hu_student_id,
        version: newVersion,
        filename: input.file.originalFilename,
        file_size_bytes: preparedBinary.actualSizeBytes,
        checksum_sha256: preparedBinary.checksumSha256,
      },
    });

    return {
      submission,
      file: subFile,
      version: newVersion,
      isResubmission,
      assignedRepresentativeNotified: representativeNotified,
    };
  }
}
