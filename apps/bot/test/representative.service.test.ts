// HU-ASMS: Phase 05 Representative Management & Scope Authorization Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RepresentativeService,
  UnauthorizedSectionScopeError,
} from '../src/services/representative.service.js';
import { NotificationService } from '../src/services/notification.service.js';

describe('Phase 05 — Representative System & Scope Authorization Unit Tests', () => {

  const mockProfiles = [
    {
      id: 'prof-hamza',
      role: 'representative',
      full_name: 'Hamza Mohammed',
      telegram_user_id: 11111111,
      is_active: true,
    },
    {
      id: 'prof-deactivated',
      role: 'representative',
      full_name: 'Inactive Rep',
      telegram_user_id: 22222222,
      is_active: false,
    },
    {
      id: 'prof-multi',
      role: 'representative',
      full_name: 'Multi-Section Rep (Sara)',
      telegram_user_id: 33333333,
      is_active: true,
    },
  ];

  const mockAssignments = [
    {
      id: 'assign-1',
      profile_id: 'prof-hamza',
      section_id: 'sec-3b',
      is_active: true,
      profile: mockProfiles[0],
      section: {
        id: 'sec-3b',
        name: 'Section B',
        academic_year_id: 'year-3',
        academic_year: { name: '3rd Year' },
      },
    },
    {
      id: 'assign-2a',
      profile_id: 'prof-multi',
      section_id: 'sec-2a',
      is_active: true,
      profile: mockProfiles[2],
      section: {
        id: 'sec-2a',
        name: 'Section A',
        academic_year_id: 'year-2',
        academic_year: { name: '2nd Year' },
      },
    },
    {
      id: 'assign-2b',
      profile_id: 'prof-multi',
      section_id: 'sec-2b',
      is_active: true,
      profile: mockProfiles[2],
      section: {
        id: 'sec-2b',
        name: 'Section B',
        academic_year_id: 'year-2',
        academic_year: { name: '2nd Year' },
      },
    },
  ];

  const mockStudents = [
    {
      id: 'stud-2a-1',
      hu_student_id: 'HU/2024-021',
      full_name: 'Second Year Student A1',
      section_id: 'sec-2a',
      academic_year_id: 'year-2',
      registration_status: 'locked',
      is_locked: true,
    },
    {
      id: 'stud-2b-1',
      hu_student_id: 'HU/2024-022',
      full_name: 'Second Year Student B1',
      section_id: 'sec-2b',
      academic_year_id: 'year-2',
      registration_status: 'locked',
      is_locked: true,
    },
    {
      id: 'stud-1',
      hu_student_id: 'HU/10294/14',
      full_name: 'Student One',
      section_id: 'sec-3b',
      academic_year_id: 'year-3',
      registration_status: 'locked',
      is_locked: true,
    },
    {
      id: 'stud-2',
      hu_student_id: 'HU/10295/14',
      full_name: 'Student Two',
      section_id: 'sec-3b',
      academic_year_id: 'year-3',
      registration_status: 'locked',
      is_locked: true,
    },
    {
      id: 'stud-3',
      hu_student_id: 'HU/10296/14',
      full_name: 'Student Three',
      section_id: 'sec-3b',
      academic_year_id: 'year-3',
      registration_status: 'locked',
      is_locked: true,
    },
  ];

  const mockIndividualProject = {
    id: 'proj-db',
    title: 'Database Normalization',
    submission_type: 'individual',
    course_id: 'course-1',
    teacher_id: 'teacher-1',
  };

  const mockSubmissions = [
    {
      id: 'sub-1',
      project_id: 'proj-db',
      section_id: 'sec-3b',
      submission_type: 'individual',
      student_id: 'stud-1',
      version: 1,
      status: 'active',
      created_at: '2026-11-10T00:00:00Z',
      files: [
        {
          id: 'file-1',
          original_filename: 'normalization_report.pdf',
          file_size_bytes: 1048576, // 1 MB
        },
      ],
    },
  ];

  const mockGroupProject = {
    id: 'proj-se',
    title: 'Software Engineering Term Project',
    submission_type: 'group',
    course_id: 'course-2',
    teacher_id: 'teacher-1',
  };

  const mockGroups = [
    {
      id: 'grp-1',
      project_id: 'proj-se',
      section_id: 'sec-3b',
      group_code: 'Group 01',
      group_leader_id: 'stud-1',
      leader: { full_name: 'Student One' },
      status: 'verified',
      members: [
        { student_id: 'stud-1', confirmation_status: 'confirmed' },
        { student_id: 'stud-2', confirmation_status: 'confirmed' },
      ],
    },
    {
      id: 'grp-2',
      project_id: 'proj-se',
      section_id: 'sec-3b',
      group_code: 'Group 02',
      group_leader_id: 'stud-3',
      leader: { full_name: 'Student Three' },
      status: 'pending',
      members: [
        { student_id: 'stud-3', confirmation_status: 'confirmed' },
        { student_id: 'stud-4', confirmation_status: 'pending' },
      ],
    },
  ];

  const mockGroupSubmissions = [
    {
      id: 'sub-grp-1',
      project_id: 'proj-se',
      section_id: 'sec-3b',
      submission_type: 'group',
      group_id: 'grp-1',
      version: 1,
      status: 'active',
      created_at: '2026-11-10T01:00:00Z',
      files: [
        {
          id: 'file-2',
          original_filename: 'se_architecture_milestone1.pdf',
          file_size_bytes: 2097152, // 2 MB
        },
      ],
    },
  ];

  function createMockSupabaseClient() {
    return {
      from: (table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: (col: string, val: unknown) => ({
                eq: (col2: string, val2: unknown) => ({
                  maybeSingle: async () => {
                    const match = mockProfiles.find(
                      (p) => (p as any)[col] === val && (p as any)[col2] === val2
                    );
                    return { data: match || null, error: null };
                  },
                }),
              }),
            }),
          };
        }

        if (table === 'representative_assignments') {
          const createQuery = (filters: Array<{ col: string; val: unknown }> = []) => ({
            eq(col: string, val: unknown) {
              return createQuery([...filters, { col, val }]);
            },
            maybeSingle: async () => {
              const secFilter = filters.find((f) => f.col === 'section_id')?.val;
              const profFilter = filters.find((f) => f.col === 'profile_id')?.val;
              const match = mockAssignments.find(
                (a) =>
                  (!secFilter || a.section_id === secFilter) &&
                  (!profFilter || a.profile_id === profFilter) &&
                  a.is_active
              );
              return { data: match || null, error: null };
            },
            then(resolve: any) {
              const secFilter = filters.find((f) => f.col === 'section_id')?.val;
              const profFilter = filters.find((f) => f.col === 'profile_id')?.val;
              const matches = mockAssignments.filter(
                (a) =>
                  (!secFilter || a.section_id === secFilter) &&
                  (!profFilter || a.profile_id === profFilter) &&
                  a.is_active &&
                  a.profile.is_active
              );
              return Promise.resolve({ data: matches, error: null }).then(resolve);
            },
          });

          return {
            select: () => createQuery(),
          };
        }

        if (table === 'students') {
          return {
            select: () => ({
              eq: (col: string, val: unknown) => ({
                order: () => ({
                  data: mockStudents.filter((s) => (s as any)[col] === val),
                  error: null,
                }),
              }),
            }),
          };
        }

        if (table === 'sections') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { academic_year_id: 'year-3' },
                  error: null,
                }),
              }),
            }),
          };
        }

        if (table === 'projects') {
          return {
            select: () => ({
              eq: (col: string, val: unknown) => ({
                single: async () => {
                  if (val === 'proj-db') return { data: mockIndividualProject, error: null };
                  if (val === 'proj-se') return { data: mockGroupProject, error: null };
                  return { data: null, error: new Error('Not found') };
                },
                or: () => ({
                  or: () => ({
                    order: () => ({
                      data: [mockIndividualProject, mockGroupProject],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'submissions') {
          return {
            select: () => ({
              eq: (_col1: string, projId: unknown) => ({
                eq: (_col2: string, _secId: unknown) => ({
                  eq: (_col3: string, typeOrStatus: unknown) => ({
                    eq: (_col4: string, statusVal: unknown) => {
                      if (projId === 'proj-se') {
                        return { data: mockGroupSubmissions, error: null };
                      }
                      return { data: mockSubmissions, error: null };
                    },
                    data: mockSubmissions,
                    error: null,
                  }),
                  data: mockSubmissions,
                  error: null,
                }),
              }),
            }),
          };
        }

        if (table === 'groups') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    data: mockGroups,
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'notifications') {
          return {
            insert: async (data: any) => ({ data, error: null }),
          };
        }

        throw new Error(`Unexpected table in mock: ${table}`);
      },
    } as any;
  }

  describe('1. Section Scope Enforcement', () => {
    it('should allow Hamza to query students in his assigned Section 3B', async () => {
      const service = new RepresentativeService(createMockSupabaseClient());
      const students = await service.getSectionStudents(11111111, 'sec-3b');

      assert.equal(students.length, 3);
      assert.equal(students[0].full_name, 'Student One');
    });

    it('should throw UnauthorizedSectionScopeError if Hamza queries Section 3A or Section 2A', async () => {
      const service = new RepresentativeService(createMockSupabaseClient());

      await assert.rejects(
        async () => {
          await service.getSectionStudents(11111111, 'sec-3a');
        },
        UnauthorizedSectionScopeError
      );

      await assert.rejects(
        async () => {
          await service.getSectionStudents(11111111, 'sec-2a');
        },
        UnauthorizedSectionScopeError
      );
    });

    it('should reject deactivated representative profile from accessing any section', async () => {
      const service = new RepresentativeService(createMockSupabaseClient());

      await assert.rejects(
        async () => {
          await service.getSectionStudents(22222222, 'sec-3b');
        },
        UnauthorizedSectionScopeError
      );
    });

    it('should reject unknown Telegram ID', async () => {
      const service = new RepresentativeService(createMockSupabaseClient());

      await assert.rejects(
        async () => {
          await service.getSectionStudents(99999999, 'sec-3b');
        },
        UnauthorizedSectionScopeError
      );
    });

    it('should support a representative assigned to multiple sections (2A & 2B)', async () => {
      const service = new RepresentativeService(createMockSupabaseClient());

      // 1. Check profile loads both assigned sections
      const repProfile = await service.getRepresentativeProfile(33333333);
      assert.ok(repProfile);
      assert.equal(repProfile.profile.full_name, 'Multi-Section Rep (Sara)');
      assert.equal(repProfile.assignments.length, 2);

      const assignedSectionIds = repProfile.assignments.map((a) => a.section_id);
      assert.ok(assignedSectionIds.includes('sec-2a'));
      assert.ok(assignedSectionIds.includes('sec-2b'));

      // 2. Can query Section 2A
      const students2A = await service.getSectionStudents(33333333, 'sec-2a');
      assert.equal(students2A.length, 1);
      assert.equal(students2A[0].full_name, 'Second Year Student A1');

      // 3. Can query Section 2B
      const students2B = await service.getSectionStudents(33333333, 'sec-2b');
      assert.equal(students2B.length, 1);
      assert.equal(students2B[0].full_name, 'Second Year Student B1');

      // 4. Strictly blocked from querying Section 3B (Hamza's section)
      await assert.rejects(
        async () => {
          await service.getSectionStudents(33333333, 'sec-3b');
        },
        UnauthorizedSectionScopeError
      );
    });
  });

  describe('2. Individual Submission Reports', () => {
    it('should accurately calculate submitted vs missing students with metadata', async () => {
      const service = new RepresentativeService(createMockSupabaseClient());
      const report = await service.getIndividualSubmissionReport(11111111, 'sec-3b', 'proj-db');

      assert.equal(report.totalEligibleStudents, 3);
      assert.equal(report.submittedCount, 1);
      assert.equal(report.missingCount, 2);

      // Verify submitted student details
      assert.equal(report.submittedStudents[0].student.hu_student_id, 'HU/10294/14');
      assert.equal(report.submittedStudents[0].fileName, 'normalization_report.pdf');
      assert.equal(report.submittedStudents[0].fileSizeBytes, 1048576);

      // Verify missing students list
      const missingHuIds = report.missingStudents.map((s) => s.hu_student_id);
      assert.ok(missingHuIds.includes('HU/10295/14'));
      assert.ok(missingHuIds.includes('HU/10296/14'));
    });
  });

  describe('3. Group Submission Reports', () => {
    it('should accurately calculate submitted vs missing groups and membership statuses', async () => {
      const service = new RepresentativeService(createMockSupabaseClient());
      const report = await service.getGroupSubmissionReport(11111111, 'sec-3b', 'proj-se');

      assert.equal(report.totalGroups, 2);
      assert.equal(report.submittedGroupsCount, 1);
      assert.equal(report.missingGroupsCount, 1);

      // Submitted Group details
      assert.equal(report.submittedGroups[0].group.group_code, 'Group 01');
      assert.equal(report.submittedGroups[0].submittedByStudentName, 'Student One');
      assert.equal(report.submittedGroups[0].fileName, 'se_architecture_milestone1.pdf');

      // Missing Group details
      assert.equal(report.missingGroups[0].group.group_code, 'Group 02');
      assert.equal(report.missingGroups[0].confirmedMembersCount, 1);
      assert.equal(report.missingGroups[0].pendingMembersCount, 1);
    });
  });

  describe('4. Real-time Representative Notification Dispatch', () => {
    it('should resolve assigned section representatives and dispatch alerts', async () => {
      let dispatchedChatId: number | null = null;
      let dispatchedMsg: string | null = null;

      const mockBotSender = async (chatId: number, msg: string) => {
        dispatchedChatId = chatId;
        dispatchedMsg = msg;
      };

      const notificationService = new NotificationService(
        createMockSupabaseClient(),
        mockBotSender
      );

      const result = await notificationService.notifyRepresentativeOfSubmission({
        sectionId: 'sec-3b',
        projectTitle: 'Database Normalization',
        scopeName: '3rd Year — Section B',
        studentOrGroupName: 'Student One',
        huStudentId: 'HU/10294/14',
        fileName: 'normalization_report.pdf',
        fileSizeBytes: 1048576,
        submissionType: 'individual',
      });

      assert.equal(result.dispatchedCount, 1);
      assert.equal(dispatchedChatId, 11111111); // Hamza's Telegram ID
      assert.ok(dispatchedMsg);
      const msg = dispatchedMsg as string;
      assert.ok(msg.includes('New Academic Submission Alert'));
      assert.ok(msg.includes('HU/10294/14'));
      assert.ok(msg.includes('normalization_report.pdf'));
    });
  });

});
