// HU-ASMS: Phase 09 Group Submission Service Unit Tests
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  GroupSubmissionService,
  GroupSubmissionError,
  type GroupSubmissionInput,
} from '../src/services/group-submission.service.js';
import { NotificationService } from '../src/services/notification.service.js';

describe('Phase 09 — Group Submission Service Unit Tests', () => {
  const now = Date.now();

  const mockStudents = [
    {
      id: 'stud-leader',
      hu_student_id: 'HU/10294/14',
      full_name: 'Leader Student',
      academic_year_id: 'year-3',
      section_id: 'sec-3b',
      telegram_user_id: 11111111,
      registration_status: 'locked',
      academic_year: { name: '3rd Year' },
      section: { name: 'Section B' },
      department: { name: 'Software Engineering' },
    },
    {
      id: 'stud-member2',
      hu_student_id: 'HU/10295/14',
      full_name: 'Member Two',
      academic_year_id: 'year-3',
      section_id: 'sec-3b',
      telegram_user_id: 22222222,
      registration_status: 'locked',
      academic_year: { name: '3rd Year' },
      section: { name: 'Section B' },
    },
    {
      id: 'stud-outsider',
      hu_student_id: 'HU/10296/14',
      full_name: 'Outsider Student',
      academic_year_id: 'year-3',
      section_id: 'sec-3b',
      telegram_user_id: 33333333,
      registration_status: 'locked',
    },
    {
      id: 'stud-suspended',
      hu_student_id: 'HU/10297/14',
      full_name: 'Suspended Leader',
      academic_year_id: 'year-3',
      section_id: 'sec-3b',
      telegram_user_id: 44444444,
      registration_status: 'suspended',
      suspension_reason: 'Tuition arrears',
    },
  ];

  const mockProjects: Record<string, any> = {
    'proj-open-resub': {
      id: 'proj-open-resub',
      title: 'SE Architecture Term Project',
      submission_type: 'group',
      is_active: true,
      opening_date: new Date(now - 3600000).toISOString(),
      deadline: new Date(now + 86400000 * 7).toISOString(),
      resubmission_allowed: true,
      file_rules: {
        allowed_extensions: ['pdf', 'zip'],
        allowed_mime_types: ['application/pdf', 'application/zip'],
        max_file_size_bytes: 10 * 1024 * 1024, // 10 MB
      },
    },
    'proj-open-no-resub': {
      id: 'proj-open-no-resub',
      title: 'Final Capstone Phase 1',
      submission_type: 'group',
      is_active: true,
      opening_date: new Date(now - 3600000).toISOString(),
      deadline: new Date(now + 86400000 * 7).toISOString(),
      resubmission_allowed: false, // Disallowed
      file_rules: {
        allowed_extensions: ['pdf'],
        allowed_mime_types: ['application/pdf'],
        max_file_size_bytes: 5 * 1024 * 1024,
      },
    },
    'proj-expired': {
      id: 'proj-expired',
      title: 'Expired Group Project',
      submission_type: 'group',
      is_active: true,
      opening_date: new Date(now - 86400000 * 10).toISOString(),
      deadline: new Date(now - 86400000 * 1).toISOString(), // Ended yesterday
      resubmission_allowed: true,
    },
    'proj-future': {
      id: 'proj-future',
      title: 'Future Group Project',
      submission_type: 'group',
      is_active: true,
      opening_date: new Date(now + 86400000 * 2).toISOString(), // Starts in 2 days
      deadline: new Date(now + 86400000 * 14).toISOString(),
      resubmission_allowed: true,
    },
  };

  let mockGroups: Record<string, any> = {};
  let mockSubmissions: any[] = [];
  let mockSubmissionFiles: any[] = [];
  let mockSubmissionMembers: any[] = [];
  let mockAuditLogs: any[] = [];

  function resetState() {
    mockSubmissions = [];
    mockSubmissionFiles = [];
    mockSubmissionMembers = [];
    mockAuditLogs = [];

    mockGroups = {
      'grp-verified': {
        id: 'grp-verified',
        group_code: 'GRP-01',
        project_id: 'proj-open-resub',
        academic_year_id: 'year-3',
        section_id: 'sec-3b',
        group_leader_id: 'stud-leader',
        status: 'verified',
        project: mockProjects['proj-open-resub'],
        section: {
          id: 'sec-3b',
          name: 'Section B',
          academic_year: { id: 'year-3', name: '3rd Year' },
        },
        leader: mockStudents[0],
        members: [
          {
            id: 'gm-1',
            group_id: 'grp-verified',
            student_id: 'stud-leader',
            confirmation_status: 'confirmed',
            student: mockStudents[0],
          },
          {
            id: 'gm-2',
            group_id: 'grp-verified',
            student_id: 'stud-member2',
            confirmation_status: 'confirmed',
            student: mockStudents[1],
          },
        ],
      },
      'grp-unverified': {
        id: 'grp-unverified',
        group_code: 'GRP-02',
        project_id: 'proj-open-resub',
        academic_year_id: 'year-3',
        section_id: 'sec-3b',
        group_leader_id: 'stud-leader',
        status: 'pending', // Not verified!
        project: mockProjects['proj-open-resub'],
        section: {
          id: 'sec-3b',
          name: 'Section B',
          academic_year: { id: 'year-3', name: '3rd Year' },
        },
        leader: mockStudents[0],
        members: [
          {
            id: 'gm-3',
            group_id: 'grp-unverified',
            student_id: 'stud-leader',
            confirmation_status: 'confirmed',
            student: mockStudents[0],
          },
          {
            id: 'gm-4',
            group_id: 'grp-unverified',
            student_id: 'stud-member2',
            confirmation_status: 'pending', // Not confirmed!
            student: mockStudents[1],
          },
        ],
      },
      'grp-no-resub': {
        id: 'grp-no-resub',
        group_code: 'GRP-03',
        project_id: 'proj-open-no-resub',
        academic_year_id: 'year-3',
        section_id: 'sec-3b',
        group_leader_id: 'stud-leader',
        status: 'verified',
        project: mockProjects['proj-open-no-resub'],
        section: {
          id: 'sec-3b',
          name: 'Section B',
          academic_year: { id: 'year-3', name: '3rd Year' },
        },
        leader: mockStudents[0],
        members: [
          {
            id: 'gm-5',
            group_id: 'grp-no-resub',
            student_id: 'stud-leader',
            confirmation_status: 'confirmed',
            student: mockStudents[0],
          },
        ],
      },
      'grp-expired': {
        id: 'grp-expired',
        group_code: 'GRP-04',
        project_id: 'proj-expired',
        academic_year_id: 'year-3',
        section_id: 'sec-3b',
        group_leader_id: 'stud-leader',
        status: 'verified',
        project: mockProjects['proj-expired'],
        section: {
          id: 'sec-3b',
          name: 'Section B',
          academic_year: { id: 'year-3', name: '3rd Year' },
        },
        leader: mockStudents[0],
        members: [
          {
            id: 'gm-6',
            group_id: 'grp-expired',
            student_id: 'stud-leader',
            confirmation_status: 'confirmed',
            student: mockStudents[0],
          },
        ],
      },
      'grp-future': {
        id: 'grp-future',
        group_code: 'GRP-05',
        project_id: 'proj-future',
        academic_year_id: 'year-3',
        section_id: 'sec-3b',
        group_leader_id: 'stud-leader',
        status: 'verified',
        project: mockProjects['proj-future'],
        section: {
          id: 'sec-3b',
          name: 'Section B',
          academic_year: { id: 'year-3', name: '3rd Year' },
        },
        leader: mockStudents[0],
        members: [
          {
            id: 'gm-7',
            group_id: 'grp-future',
            student_id: 'stud-leader',
            confirmation_status: 'confirmed',
            student: mockStudents[0],
          },
        ],
      },
    };
  }

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

        if (table === 'groups') {
          return {
            select: () => ({
              eq: (_col: string, val: unknown) => ({
                maybeSingle: async () => {
                  const match = mockGroups[val as string];
                  return { data: match || null, error: null };
                },
              }),
            }),
            update: (updates: any) => ({
              eq: (_col: string, grpId: string) => {
                const grp = mockGroups[grpId];
                if (grp) Object.assign(grp, updates);
                return Promise.resolve({ data: grp, error: null });
              },
            }),
          };
        }

        if (table === 'submissions') {
          return {
            select: () => ({
              eq: (_col1: string, projId: unknown) => ({
                eq: (_col2: string, grpId: unknown) => ({
                  eq: (_col3: string, subType: unknown) => ({
                    eq: (_col4: string, statusVal: unknown) => ({
                      maybeSingle: async () => {
                        const match = mockSubmissions.find(
                          (s) =>
                            s.project_id === projId &&
                            s.group_id === grpId &&
                            s.submission_type === subType &&
                            s.status === statusVal
                        );
                        return { data: match || null, error: null };
                      },
                    }),
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
              const list = Array.isArray(memberData) ? memberData : [memberData];
              mockSubmissionMembers.push(...list);
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

        throw new Error(`Unexpected table: ${table}`);
      },
      storage: {
        from: (_bucket: string) => ({
          upload: async (_path: string, _data: any) => ({ data: { path: _path }, error: null }),
        }),
      },
    } as any;
  }

  beforeEach(() => {
    resetState();
  });

  // ---------------------------------------------------------------------------
  // Test 1: Successful Group Submission
  // ---------------------------------------------------------------------------
  it('should successfully submit group assignment when leader submits for verified group', async () => {
    const mockClient = createMockSupabaseClient();
    let repNotified = false;

    const mockNotificationService = {
      notifyRepresentativeOfSubmission: async () => {
        repNotified = true;
        return { dispatchedCount: 1, failedCount: 0 };
      },
    } as unknown as NotificationService;

    const service = new GroupSubmissionService(mockClient, mockNotificationService);

    const input: GroupSubmissionInput = {
      telegramUserId: 11111111, // Leader
      groupId: 'grp-verified',
      projectId: 'proj-open-resub',
      file: {
        originalFilename: 'architecture_report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024 * 1024,
        buffer: Buffer.from('%PDF-1.4 test document'),
      },
    };

    const result = await service.submitGroupAssignment(input);

    assert.equal(result.version, 1);
    assert.equal(result.isResubmission, false);
    assert.equal(result.groupCode, 'GRP-01');
    assert.equal(result.confirmedMembersCount, 2);
    assert.equal(result.assignedRepresentativeNotified, true);
    assert.equal(repNotified, true);

    // Verify submission record
    assert.equal(mockSubmissions.length, 1);
    assert.equal(mockSubmissions[0].submission_type, 'group');
    assert.equal(mockSubmissions[0].student_id, null); // Strictly null for group
    assert.equal(mockSubmissions[0].group_id, 'grp-verified');
    assert.equal(mockSubmissions[0].status, 'active');

    // Verify file record
    assert.equal(mockSubmissionFiles.length, 1);
    assert.equal(mockSubmissionFiles[0].original_filename, 'architecture_report.pdf');

    // Verify member snapshots
    assert.equal(mockSubmissionMembers.length, 2);
    const leaderMember = mockSubmissionMembers.find((m) => m.student_id === 'stud-leader');
    const memberTwo = mockSubmissionMembers.find((m) => m.student_id === 'stud-member2');
    assert.ok(leaderMember);
    assert.equal(leaderMember.is_submitter, true);
    assert.ok(memberTwo);
    assert.equal(memberTwo.is_submitter, false);

    // Verify group status updated
    assert.equal(mockGroups['grp-verified'].status, 'submitted');

    // Verify audit log
    assert.equal(mockAuditLogs.length, 1);
    assert.equal(mockAuditLogs[0].action, 'GROUP_SUBMISSION_CREATED');
  });

  // ---------------------------------------------------------------------------
  // Test 2: Unverified Group Rejection
  // ---------------------------------------------------------------------------
  it('should reject submission if group is not fully verified', async () => {
    const mockClient = createMockSupabaseClient();
    const service = new GroupSubmissionService(mockClient);

    const input: GroupSubmissionInput = {
      telegramUserId: 11111111,
      groupId: 'grp-unverified',
      projectId: 'proj-open-resub',
      file: {
        originalFilename: 'draft.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    };

    await assert.rejects(
      async () => await service.submitGroupAssignment(input),
      (err: any) => {
        assert.ok(err instanceof GroupSubmissionError);
        assert.equal(err.code, 'GROUP_NOT_VERIFIED');
        assert.match(err.message, /not fully verified yet/);
        return true;
      }
    );

    assert.equal(mockSubmissions.length, 0);
  });

  // ---------------------------------------------------------------------------
  // Test 3: Non-Leader Submitter Rejection (Sole Submitter Principle)
  // ---------------------------------------------------------------------------
  it('should reject submission when a non-leader member attempts to submit', async () => {
    const mockClient = createMockSupabaseClient();
    const service = new GroupSubmissionService(mockClient);

    const input: GroupSubmissionInput = {
      telegramUserId: 22222222, // Member Two (not group leader)
      groupId: 'grp-verified',
      projectId: 'proj-open-resub',
      file: {
        originalFilename: 'architecture_report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    };

    await assert.rejects(
      async () => await service.submitGroupAssignment(input),
      (err: any) => {
        assert.ok(err instanceof GroupSubmissionError);
        assert.equal(err.code, 'UNAUTHORIZED_SUBMITTER');
        assert.match(err.message, /Only the designated group leader/);
        return true;
      }
    );

    assert.equal(mockSubmissions.length, 0);
  });

  // ---------------------------------------------------------------------------
  // Test 4: Non-Member Rejection
  // ---------------------------------------------------------------------------
  it('should reject submission when a non-member attempts to submit for a group', async () => {
    const mockClient = createMockSupabaseClient();
    const service = new GroupSubmissionService(mockClient);

    const input: GroupSubmissionInput = {
      telegramUserId: 33333333, // Outsider student
      groupId: 'grp-verified',
      projectId: 'proj-open-resub',
      file: {
        originalFilename: 'architecture_report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    };

    await assert.rejects(
      async () => await service.submitGroupAssignment(input),
      (err: any) => {
        assert.ok(err instanceof GroupSubmissionError);
        assert.equal(err.code, 'NOT_GROUP_MEMBER');
        return true;
      }
    );
  });

  // ---------------------------------------------------------------------------
  // Test 5: Unregistered Student Rejection
  // ---------------------------------------------------------------------------
  it('should reject submission from an unregistered Telegram user', async () => {
    const mockClient = createMockSupabaseClient();
    const service = new GroupSubmissionService(mockClient);

    const input: GroupSubmissionInput = {
      telegramUserId: 99999999, // Unknown
      groupId: 'grp-verified',
      projectId: 'proj-open-resub',
      file: {
        originalFilename: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    };

    await assert.rejects(
      async () => await service.submitGroupAssignment(input),
      (err: any) => {
        assert.ok(err instanceof GroupSubmissionError);
        assert.equal(err.code, 'UNREGISTERED_STUDENT');
        return true;
      }
    );
  });

  // ---------------------------------------------------------------------------
  // Test 6: Suspended Student Rejection
  // ---------------------------------------------------------------------------
  it('should reject submission when the student account is suspended', async () => {
    const mockClient = createMockSupabaseClient();
    const service = new GroupSubmissionService(mockClient);

    const input: GroupSubmissionInput = {
      telegramUserId: 44444444, // Suspended Leader
      groupId: 'grp-verified',
      projectId: 'proj-open-resub',
      file: {
        originalFilename: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    };

    await assert.rejects(
      async () => await service.submitGroupAssignment(input),
      (err: any) => {
        assert.ok(err instanceof GroupSubmissionError);
        assert.equal(err.code, 'ACCOUNT_SUSPENDED');
        assert.match(err.message, /Account suspended: Tuition arrears/);
        return true;
      }
    );
  });

  // ---------------------------------------------------------------------------
  // Test 7: Deadline Exceeded Rejection
  // ---------------------------------------------------------------------------
  it('should reject submission after project deadline has passed', async () => {
    const mockClient = createMockSupabaseClient();
    const service = new GroupSubmissionService(mockClient);

    const input: GroupSubmissionInput = {
      telegramUserId: 11111111,
      groupId: 'grp-expired',
      projectId: 'proj-expired',
      file: {
        originalFilename: 'late_submission.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    };

    await assert.rejects(
      async () => await service.submitGroupAssignment(input),
      (err: any) => {
        assert.ok(err instanceof GroupSubmissionError);
        assert.equal(err.code, 'DEADLINE_EXCEEDED');
        return true;
      }
    );
  });

  // ---------------------------------------------------------------------------
  // Test 8: Project Not Open Yet Rejection
  // ---------------------------------------------------------------------------
  it('should reject submission before project opening date', async () => {
    const mockClient = createMockSupabaseClient();
    const service = new GroupSubmissionService(mockClient);

    const input: GroupSubmissionInput = {
      telegramUserId: 11111111,
      groupId: 'grp-future',
      projectId: 'proj-future',
      file: {
        originalFilename: 'early_submission.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    };

    await assert.rejects(
      async () => await service.submitGroupAssignment(input),
      (err: any) => {
        assert.ok(err instanceof GroupSubmissionError);
        assert.equal(err.code, 'PROJECT_NOT_OPEN');
        return true;
      }
    );
  });

  // ---------------------------------------------------------------------------
  // Test 9: Invalid File Rules (Extension, MIME type, File Size)
  // ---------------------------------------------------------------------------
  it('should reject invalid file extensions, disallowed MIME types, or oversized files', async () => {
    const mockClient = createMockSupabaseClient();
    const service = new GroupSubmissionService(mockClient);

    // Invalid extension (.exe)
    await assert.rejects(
      async () =>
        await service.submitGroupAssignment({
          telegramUserId: 11111111,
          groupId: 'grp-verified',
          projectId: 'proj-open-resub',
          file: {
            originalFilename: 'malware.exe',
            mimeType: 'application/x-msdownload',
            sizeBytes: 1024,
          },
        }),
      (err: any) => {
        assert.ok(err instanceof GroupSubmissionError);
        assert.equal(err.code, 'INVALID_FILE');
        return true;
      }
    );

    // Oversized file (> 10MB)
    await assert.rejects(
      async () =>
        await service.submitGroupAssignment({
          telegramUserId: 11111111,
          groupId: 'grp-verified',
          projectId: 'proj-open-resub',
          file: {
            originalFilename: 'huge.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 15 * 1024 * 1024,
          },
        }),
      (err: any) => {
        assert.ok(err instanceof GroupSubmissionError);
        assert.equal(err.code, 'INVALID_FILE');
        return true;
      }
    );
  });

  // ---------------------------------------------------------------------------
  // Test 10: Duplicate Active Submission Blocked When Resubmission Disallowed
  // ---------------------------------------------------------------------------
  it('should prevent duplicate active group submission when resubmissions are disabled', async () => {
    const mockClient = createMockSupabaseClient();
    const service = new GroupSubmissionService(mockClient);

    // Pre-populate an active submission
    mockSubmissions.push({
      id: 'sub-existing',
      project_id: 'proj-open-no-resub',
      group_id: 'grp-no-resub',
      submission_type: 'group',
      status: 'active',
      version: 1,
    });

    const input: GroupSubmissionInput = {
      telegramUserId: 11111111,
      groupId: 'grp-no-resub',
      projectId: 'proj-open-no-resub',
      file: {
        originalFilename: 'capstone_final.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    };

    await assert.rejects(
      async () => await service.submitGroupAssignment(input),
      (err: any) => {
        assert.ok(err instanceof GroupSubmissionError);
        assert.equal(err.code, 'DUPLICATE_GROUP_SUBMISSION');
        assert.ok(err.groupNotice);
        assert.match(err.groupNotice, /already submitted this project/);
        return true;
      }
    );

    // Submission count remains 1
    assert.equal(mockSubmissions.length, 1);
  });

  // ---------------------------------------------------------------------------
  // Test 11: Resubmission When Allowed (Version Increment & Superseding)
  // ---------------------------------------------------------------------------
  it('should support resubmission by superseding earlier submission and incrementing version', async () => {
    const mockClient = createMockSupabaseClient();
    const service = new GroupSubmissionService(mockClient);

    // Pre-populate active v1 submission
    mockSubmissions.push({
      id: 'sub-active-v1',
      project_id: 'proj-open-resub',
      group_id: 'grp-verified',
      submission_type: 'group',
      status: 'active',
      version: 1,
    });

    const input: GroupSubmissionInput = {
      telegramUserId: 11111111,
      groupId: 'grp-verified',
      projectId: 'proj-open-resub',
      file: {
        originalFilename: 'architecture_report_v2.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        buffer: Buffer.from('%PDF-1.4 revised report'),
      },
    };

    const result = await service.submitGroupAssignment(input);

    assert.equal(result.version, 2);
    assert.equal(result.isResubmission, true);

    // Verify earlier submission superseded
    const v1 = mockSubmissions.find((s) => s.id === 'sub-active-v1');
    assert.equal(v1.status, 'superseded');

    // Verify new submission active
    const v2 = mockSubmissions.find((s) => s.version === 2);
    assert.ok(v2);
    assert.equal(v2.status, 'active');

    // Audit log
    assert.equal(mockAuditLogs[mockAuditLogs.length - 1].action, 'GROUP_SUBMISSION_RESUBMITTED');
  });

  // ---------------------------------------------------------------------------
  // Test 12: Private Storage Upload Failure Handling
  // ---------------------------------------------------------------------------
  it('should fail cleanly when private storage upload fails', async () => {
    const mockClient = createMockSupabaseClient();
    const storageUploader = async () => ({
      path: '',
      error: new Error('S3 Connection Timed Out'),
    });

    const service = new GroupSubmissionService(mockClient, undefined, storageUploader);

    const input: GroupSubmissionInput = {
      telegramUserId: 11111111,
      groupId: 'grp-verified',
      projectId: 'proj-open-resub',
      file: {
        originalFilename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        buffer: Buffer.from('test'),
      },
    };

    await assert.rejects(
      async () => await service.submitGroupAssignment(input),
      (err: any) => {
        assert.ok(err instanceof GroupSubmissionError);
        assert.equal(err.code, 'STORAGE_UPLOAD_FAILED');
        return true;
      }
    );

    assert.equal(mockSubmissions.length, 0);
  });

  // ---------------------------------------------------------------------------
  // Test 13: Non-Blocking Representative Notification
  // ---------------------------------------------------------------------------
  it('should not fail submission if section representative notification fails', async () => {
    const mockClient = createMockSupabaseClient();
    const failingNotificationService = {
      notifyRepresentativeOfSubmission: async () => {
        throw new Error('Telegram Bot API unreachable');
      },
    } as unknown as NotificationService;

    const service = new GroupSubmissionService(mockClient, failingNotificationService);

    const input: GroupSubmissionInput = {
      telegramUserId: 11111111,
      groupId: 'grp-verified',
      projectId: 'proj-open-resub',
      file: {
        originalFilename: 'architecture_report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    };

    const result = await service.submitGroupAssignment(input);

    assert.equal(result.version, 1);
    assert.equal(result.assignedRepresentativeNotified, false);
    assert.equal(mockSubmissions.length, 1);
  });
});
