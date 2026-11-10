// HU-ASMS: Individual Submission Service (Phase 07)
// Manages document validation, private storage, duplicate prevention, versioning, and representative routing

import type { SupabaseClient } from '@hu-asms/database';
import type {
  Student,
  Project,
  Submission,
  SubmissionFile,
} from '@hu-asms/types';
import { validateSubmissionFile, sanitizeFilename } from '@hu-asms/validation';
import { NotificationService } from './notification.service.js';

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
    private storageUploader?: (
      bucket: string,
      path: string,
      fileData: Buffer | Uint8Array,
      mimeType: string
    ) => Promise<{ path: string; error?: Error | null }>
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
    // 3. Validate uploaded file rules
    // -------------------------------------------------------------------------
    const fileRules = project.file_rules;
    if (fileRules) {
      const validationResult = validateSubmissionFile({
        filename: input.file.originalFilename,
        mimeType: input.file.mimeType,
        sizeBytes: input.file.sizeBytes,
        allowedExtensions: fileRules.allowed_extensions || ['pdf'],
        allowedMimeTypes: fileRules.allowed_mime_types || ['application/pdf'],
        maxSizeBytes: fileRules.max_file_size_bytes || 20971520,
      });

      if (!validationResult.valid) {
        throw new SubmissionError(
          validationResult.error || 'File validation failed.',
          'INVALID_FILE'
        );
      }
    }

    // -------------------------------------------------------------------------
    // 4. Duplicate prevention & Versioning
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

      // Project allows resubmission: Mark existing submission as superseded
      isResubmission = true;
      newVersion = (existingActiveSub.version || 1) + 1;

      const { error: supersedeErr } = await this.client
        .from('submissions')
        .update({ status: 'superseded' })
        .eq('id', existingActiveSub.id);

      if (supersedeErr) throw supersedeErr;
    }

    // -------------------------------------------------------------------------
    // 5. Store file securely in private Supabase Storage
    // -------------------------------------------------------------------------
    const sanitizedFilename = sanitizeFilename(input.file.originalFilename);
    const storagePath = `projects/${project.id}/individual/${student.id}/v${newVersion}_${sanitizedFilename}`;

    if (input.file.buffer) {
      if (this.storageUploader) {
        const uploadRes = await this.storageUploader(
          'submission-files-vault',
          storagePath,
          input.file.buffer,
          input.file.mimeType
        );
        if (uploadRes.error) {
          throw new SubmissionError(
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
          throw new SubmissionError(
            `Private storage upload failed: ${uploadErr.message}`,
            'STORAGE_UPLOAD_FAILED'
          );
        }
      }
    }

    // -------------------------------------------------------------------------
    // 6. Record submission & file metadata in database
    // -------------------------------------------------------------------------
    const { data: submission, error: insertSubErr } = await this.client
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

    if (insertSubErr) throw insertSubErr;

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

    // Snapshot student identity at submission time
    await this.client.from('submission_members').insert({
      submission_id: submission.id,
      student_id: student.id,
      hu_student_id: student.hu_student_id,
      student_name: student.full_name,
      is_submitter: true,
    });

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
          fileSizeBytes: input.file.sizeBytes,
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
        file_size_bytes: input.file.sizeBytes,
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
