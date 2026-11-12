// HU-ASMS: Phase 07 Individual Submission Service Unit Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  IndividualSubmissionService,
  SubmissionError,
} from '../src/services/submission.service.js';
import { NotificationService } from '../src/services/notification.service.js';

describe('Phase 07 — Individual Submission Service Unit Tests', () => {

  const mockStudents = [
    {
      id: 'stud-1',
      hu_student_id: 'HU/10294/14',
      full_name: 'Student One',
      academic_year_id: 'year-3',
      section_id: 'sec-3b',
      telegram_user_id: 11111111,
      registration_status: 'locked',
      academic_year: { name: '3rd Year' },
      section: { name: 'Section B' },
    },
    {
      id: 'stud-suspended',
      hu_student_id: 'HU/10295/14',
      full_name: 'Suspended Student',
      academic_year_id: 'year-3',
      section_id: 'sec-3b',
      telegram_user_id: 22222222,
      registration_status: 'suspended',
      suspension_reason: 'Tuition hold',
    },
    {
      id: 'stud-year-2',
      hu_student_id: 'HU/10296/14',
      full_name: 'Second Year Student',
      academic_year_id: 'year-2',
      section_id: 'sec-2a',
      telegram_user_id: 33333333,
      registration_status: 'locked',
    },
  ];

  const now = Date.now();
  const mockProjects: Record<string, any> = {
    'proj-open-resub-allowed': {
      id: 'proj-open-resub-allowed',
      title: 'Database Assignment 1',
      submission_type: 'individual',
      is_active: true,
      opening_date: new Date(now - 3600000).toISOString(),
      deadline: new Date(now + 86400000 * 7).toISOString(),
      resubmission_allowed: true,
      targets: [{ academic_year_id: 'year-3', section_id: 'sec-3b' }],
      file_rules: {
        allowed_extensions: ['pdf'],
        allowed_mime_types: ['application/pdf'],
        max_file_size_bytes: 5 * 1024 * 1024, // 5 MB
      },
    },
    'proj-open-resub-blocked': {
      id: 'proj-open-resub-blocked',
      title: 'Final Exam Submission',
      submission_type: 'individual',
      is_active: true,
      opening_date: new Date(now - 3600000).toISOString(),
      deadline: new Date(now + 86400000 * 7).toISOString(),
      resubmission_allowed: false, // Disallowed
      targets: [{ academic_year_id: 'year-3', section_id: 'sec-3b' }],
      file_rules: {
        allowed_extensions: ['pdf'],
        allowed_mime_types: ['application/pdf'],
        max_file_size_bytes: 5 * 1024 * 1024,
      },
    },
    'proj-deadline-passed': {
      id: 'proj-deadline-passed',
      title: 'Expired Assignment',
      submission_type: 'individual',
      is_active: true,
      opening_date: new Date(now - 86400000 * 10).toISOString(),
      deadline: new Date(now - 86400000 * 1).toISOString(), // Ended yesterday
      resubmission_allowed: true,
      targets: [{ academic_year_id: 'year-3', section_id: 'sec-3b' }],
    },
    'proj-group-only': {
      id: 'proj-group-only',
      title: 'Term Group Project',
      submission_type: 'group',
      is_active: true,
      opening_date: new Date(now - 3600000).toISOString(),
      deadline: new Date(now + 86400000 * 7).toISOString(),
      targets: [{ academic_year_id: 'year-3', section_id: 'sec-3b' }],
    },
  };

  const mockSubmissions: any[] = [];
  const mockSubmissionFiles: any[] = [];
  const mockSubmissionMembers: any[] = [];
  const mockAuditLogs: any[] = [];

  function createMockSupabaseClient() {
    return {
      from: (table: string) => {
        if (table === 'students') {
          return {
            select: () => ({
              eq: (_col: string, val: unknown) => ({
                maybeSingle: async () => {
                  const match = mockStudents.find((s) => s.telegram_user_id === val);
                  return { data: match || null, error: null };
                },
              }),
            }),
          };
        }

        if (table === 'projects') {
          return {
            select: () => ({
              eq: (_col: string, val: unknown) => ({
                eq: () => ({
                  maybeSingle: async () => {
                    const match = mockProjects[val as string];
                    return { data: match || null, error: null };
                  },
                }),
              }),
            }),
          };
        }

        if (table === 'submissions') {
          return {
            select: () => ({
              eq: (_col1: string, projId: unknown) => ({
                eq: (_col2: string, studentId: unknown) => ({
                  eq: (_col3: string, statusVal: unknown) => ({
                    maybeSingle: async () => {
                      const match = mockSubmissions.find(
                        (s) =>
                          s.project_id === projId &&
                          s.student_id === studentId &&
                          s.status === statusVal
                      );
                      return { data: match || null, error: null };
                    },
                  }),
                }),
              }),
            }),
            insert: (subData: any) => {
              const newSub = {
                id: `sub-${mockSubmissions.length + 1}`,
                ...subData,
                created_at: new Date().toISOString(),
              };
              mockSubmissions.push(newSub);
              return {
                select: () => ({
                  single: async () => ({ data: newSub, error: null }),
                }),
              };
            },
            update: (updates: any) => ({
              eq: (_col: string, subId: string) => {
                const sub = mockSubmissions.find((s) => s.id === subId);
                if (sub) Object.assign(sub, updates);
                return Promise.resolve({ data: sub, error: null });
              },
            }),
          };
        }

        if (table === 'submission_files') {
          return {
            insert: (fileData: any) => {
              const newFile = { id: `file-${mockSubmissionFiles.length + 1}`, ...fileData };
              mockSubmissionFiles.push(newFile);
              return {
                select: () => ({
                  single: async () => ({ data: newFile, error: null }),
                }),
              };
            },
          };
        }

        if (table === 'submission_members') {
          return {
            insert: async (memberData: any) => {
              mockSubmissionMembers.push(memberData);
              return { data: memberData, error: null };
            },
          };
        }

        if (table === 'audit_logs') {
          return {
            insert: async (logData: any) => {
              mockAuditLogs.push(logData);
              return { data: logData, error: null };
            },
          };
        }

        throw new Error(`Unexpected table in mock: ${table}`);
      },
      storage: {
        from: (_bucket: string) => ({
          upload: async () => ({ error: null }),
        }),
      },
    } as any;
  }

  describe('1. Successful First-Time Submissions', () => {
    it('should successfully submit an individual assignment with metadata and auto-routing', async () => {
      let notifiedRepSection: string | null = null;
      const mockNotificationService = {
        notifyRepresentativeOfSubmission: async (params: any) => {
          notifiedRepSection = params.sectionId;
          return { dispatchedCount: 1 };
        },
      } as any;

      const service = new IndividualSubmissionService(
        createMockSupabaseClient(),
        mockNotificationService
      );

      const result = await service.submitIndividualAssignment({
        telegramUserId: 11111111, // Student One
        projectId: 'proj-open-resub-allowed',
        file: {
          originalFilename: 'database_assignment1.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1048576, // 1 MB
          telegramFileId: 'tg-file-123',
          buffer: Buffer.from('%PDF-1.4 assignment 1 bytes'),
        },
      });

      assert.ok(result.submission.id);
      assert.equal(result.version, 1);
      assert.equal(result.isResubmission, false);
      assert.equal(result.submission.status, 'active');
      assert.equal(result.submission.student_id, 'stud-1');
      assert.equal(result.submission.section_id, 'sec-3b');
      assert.equal(result.file.original_filename, 'database_assignment1.pdf');
      assert.equal(result.file.storage_path, 'projects/proj-open-resub-allowed/individual/stud-1/v1_database_assignment1.pdf');
      assert.equal(result.assignedRepresentativeNotified, true);
      assert.equal(notifiedRepSection, 'sec-3b', 'Must auto-route to student assigned section');
    });
  });

  describe('2. Resubmission and Version Incrementing', () => {
    it('should increment version and supersede previous submission when resubmission is allowed', async () => {
      const service = new IndividualSubmissionService(createMockSupabaseClient());

      // Second submission for the same project by the same student
      const result = await service.submitIndividualAssignment({
        telegramUserId: 11111111,
        projectId: 'proj-open-resub-allowed',
        file: {
          originalFilename: 'database_assignment1_revised.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1572864, // 1.5 MB
          buffer: Buffer.from('%PDF-1.4 assignment 1 revised bytes'),
        },
      });

      assert.equal(result.version, 2, 'Version must increment to 2');
      assert.equal(result.isResubmission, true);

      // Verify previous version 1 was marked as 'superseded'
      const v1Sub = mockSubmissions.find((s) => s.student_id === 'stud-1' && s.version === 1);
      assert.ok(v1Sub);
      assert.equal(v1Sub.status, 'superseded');

      // Verify version 2 is 'active'
      const v2Sub = mockSubmissions.find((s) => s.student_id === 'stud-1' && s.version === 2);
      assert.ok(v2Sub);
      assert.equal(v2Sub.status, 'active');
    });

    it('should reject duplicate submission when resubmission is disabled', async () => {
      const service = new IndividualSubmissionService(createMockSupabaseClient());

      // 1. First submission succeeds
      await service.submitIndividualAssignment({
        telegramUserId: 11111111,
        projectId: 'proj-open-resub-blocked',
        file: {
          originalFilename: 'final_exam.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1048576,
          buffer: Buffer.from('%PDF-1.4 final exam content'),
        },
      });

      // 2. Second submission must be rejected
      await assert.rejects(
        async () => {
          await service.submitIndividualAssignment({
            telegramUserId: 11111111,
            projectId: 'proj-open-resub-blocked',
            file: {
              originalFilename: 'final_exam_attempt2.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 1048576,
              buffer: Buffer.from('%PDF-1.4 final exam attempt 2'),
            },
          });
        },
        (err: any) => {
          assert.equal(err.code, 'DUPLICATE_SUBMISSION');
          return true;
        }
      );
    });
  });

  describe('3. File Rule Validations', () => {
    it('should reject disallowed file extension (e.g. .docx or .exe when .pdf is required)', async () => {
      const service = new IndividualSubmissionService(createMockSupabaseClient());

      await assert.rejects(
        async () => {
          await service.submitIndividualAssignment({
            telegramUserId: 11111111,
            projectId: 'proj-open-resub-allowed',
            file: {
              originalFilename: 'malicious_script.exe',
              mimeType: 'application/octet-stream',
              sizeBytes: 1024,
            },
          });
        },
        (err: any) => {
          assert.equal(err.code, 'INVALID_FILE');
          return true;
        }
      );
    });

    it('should reject file exceeding maximum size limit', async () => {
      const service = new IndividualSubmissionService(createMockSupabaseClient());

      await assert.rejects(
        async () => {
          await service.submitIndividualAssignment({
            telegramUserId: 11111111,
            projectId: 'proj-open-resub-allowed',
            file: {
              originalFilename: 'oversized_document.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 10 * 1024 * 1024, // 10 MB (Limit is 5 MB)
            },
          });
        },
        (err: any) => {
          assert.equal(err.code, 'INVALID_FILE');
          return true;
        }
      );
    });
  });

  describe('4. Eligibility and Access Security', () => {
    it('should reject submission from unregistered Telegram account', async () => {
      const service = new IndividualSubmissionService(createMockSupabaseClient());

      await assert.rejects(
        async () => {
          await service.submitIndividualAssignment({
            telegramUserId: 99999999, // Unregistered
            projectId: 'proj-open-resub-allowed',
            file: {
              originalFilename: 'doc.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 1024,
            },
          });
        },
        (err: any) => {
          assert.equal(err.code, 'UNREGISTERED_STUDENT');
          return true;
        }
      );
    });

    it('should reject submission from suspended student account', async () => {
      const service = new IndividualSubmissionService(createMockSupabaseClient());

      await assert.rejects(
        async () => {
          await service.submitIndividualAssignment({
            telegramUserId: 22222222, // Suspended
            projectId: 'proj-open-resub-allowed',
            file: {
              originalFilename: 'doc.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 1024,
            },
          });
        },
        (err: any) => {
          assert.equal(err.code, 'ACCOUNT_SUSPENDED');
          return true;
        }
      );
    });

    it('should reject student whose section is not targeted by project', async () => {
      const service = new IndividualSubmissionService(createMockSupabaseClient());

      // Student from 2nd Year Section A attempts to submit to 3rd Year Section B project
      await assert.rejects(
        async () => {
          await service.submitIndividualAssignment({
            telegramUserId: 33333333,
            projectId: 'proj-open-resub-allowed',
            file: {
              originalFilename: 'doc.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 1024,
            },
          });
        },
        (err: any) => {
          assert.equal(err.code, 'NOT_ELIGIBLE_SCOPE');
          return true;
        }
      );
    });

    it('should reject submission when project deadline has passed', async () => {
      const service = new IndividualSubmissionService(createMockSupabaseClient());

      await assert.rejects(
        async () => {
          await service.submitIndividualAssignment({
            telegramUserId: 11111111,
            projectId: 'proj-deadline-passed',
            file: {
              originalFilename: 'doc.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 1024,
            },
          });
        },
        (err: any) => {
          assert.equal(err.code, 'DEADLINE_EXCEEDED');
          return true;
        }
      );
    });

    it('should reject individual submission for a group-only project', async () => {
      const service = new IndividualSubmissionService(createMockSupabaseClient());

      await assert.rejects(
        async () => {
          await service.submitIndividualAssignment({
            telegramUserId: 11111111,
            projectId: 'proj-group-only',
            file: {
              originalFilename: 'doc.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 1024,
            },
          });
        },
        (err: any) => {
          assert.equal(err.code, 'INVALID_SUBMISSION_TYPE');
          return true;
        }
      );
    });
  });

  describe('5. Storage Failures & Notification Fault Tolerance', () => {
    it('should abort submission if private storage upload fails', async () => {
      const mockStorageUploader = async () => ({
        path: '',
        error: new Error('Storage bucket offline'),
      });

      const service = new IndividualSubmissionService(
        createMockSupabaseClient(),
        undefined,
        mockStorageUploader
      );

      await assert.rejects(
        async () => {
          await service.submitIndividualAssignment({
            telegramUserId: 11111111,
            projectId: 'proj-open-resub-allowed',
            file: {
              originalFilename: 'failing_upload.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 1024,
              buffer: Buffer.from('%PDF-1.4 test pdf content'),
            },
          });
        },
        (err: any) => {
          assert.equal(err.code, 'STORAGE_UPLOAD_FAILED');
          return true;
        }
      );
    });

    it('should complete submission successfully even if representative notification dispatch fails', async () => {
      const failingNotificationService = {
        notifyRepresentativeOfSubmission: async () => {
          throw new Error('Telegram notification network timeout');
        },
      } as any;

      const service = new IndividualSubmissionService(
        createMockSupabaseClient(),
        failingNotificationService
      );

      const result = await service.submitIndividualAssignment({
        telegramUserId: 11111111,
        projectId: 'proj-open-resub-allowed',
        file: {
          originalFilename: 'resilient_submission.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          buffer: Buffer.from('%PDF-1.4 resilient pdf content'),
        },
      });

      assert.ok(result.submission.id);
      assert.equal(result.assignedRepresentativeNotified, false);
      assert.equal(result.submission.status, 'active');
    });
  });

});
