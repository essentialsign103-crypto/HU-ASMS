// HU-ASMS: Phase 10 Representative Reporting Service Unit Tests
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  RepresentativeReportingService,
} from '../src/services/representative-reporting.service.js';
import { UnauthorizedSectionScopeError } from '../src/services/representative.service.js';

describe('Phase 10 — Representative Reporting Service Unit Tests', () => {
  const now = Date.now();

  const mockProfiles = [
    {
      id: 'prof-hamza',
      telegram_user_id: 11111111,
      full_name: 'Hamza Representative',
      role: 'representative',
      is_active: true,
    },
    {
      id: 'prof-multisec',
      telegram_user_id: 22222222,
      full_name: 'Dual Section Rep',
      role: 'representative',
      is_active: true,
    },
    {
      id: 'prof-inactive',
      telegram_user_id: 33333333,
      full_name: 'Deactivated Rep',
      role: 'representative',
      is_active: false,
    },
  ];

  const mockAssignments = [
    {
      id: 'assign-1',
      profile_id: 'prof-hamza',
      section_id: 'sec-3b',
      is_active: true,
      section: {
        id: 'sec-3b',
        name: 'Section B',
        academic_year_id: 'year-3',
        academic_year: { id: 'year-3', name: '3rd Year' },
      },
    },
    {
      id: 'assign-2',
      profile_id: 'prof-multisec',
      section_id: 'sec-2a',
      is_active: true,
      section: {
        id: 'sec-2a',
        name: 'Section A',
        academic_year_id: 'year-2',
        academic_year: { id: 'year-2', name: '2nd Year' },
      },
    },
    {
      id: 'assign-3',
      profile_id: 'prof-multisec',
      section_id: 'sec-2b',
      is_active: true,
      section: {
        id: 'sec-2b',
        name: 'Section B',
        academic_year_id: 'year-2',
        academic_year: { id: 'year-2', name: '2nd Year' },
      },
    },
  ];

  const mockSections: Record<string, any> = {
    'sec-3b': {
      id: 'sec-3b',
      name: 'Section B',
      academic_year_id: 'year-3',
      academic_year: { id: 'year-3', name: '3rd Year' },
    },
    'sec-3a': {
      id: 'sec-3a',
      name: 'Section A',
      academic_year_id: 'year-3',
      academic_year: { id: 'year-3', name: '3rd Year' },
    },
    'sec-2a': {
      id: 'sec-2a',
      name: 'Section A',
      academic_year_id: 'year-2',
      academic_year: { id: 'year-2', name: '2nd Year' },
    },
    'sec-2b': {
      id: 'sec-2b',
      name: 'Section B',
      academic_year_id: 'year-2',
      academic_year: { id: 'year-2', name: '2nd Year' },
    },
  };

  const mockStudents = [
    // Section 3B students
    {
      id: 'stud-3b-1',
      hu_student_id: 'HU/10294/14',
      full_name: 'Abebe Bikila',
      academic_year_id: 'year-3',
      section_id: 'sec-3b',
      telegram_user_id: 10001,
      registration_status: 'locked',
    },
    {
      id: 'stud-3b-2',
      hu_student_id: 'HU/10295/14',
      full_name: 'Sara Mohammed',
      academic_year_id: 'year-3',
      section_id: 'sec-3b',
      telegram_user_id: 10002,
      registration_status: 'locked',
    },
    {
      id: 'stud-3b-3',
      hu_student_id: 'HU/10296/14',
      full_name: 'Daniel Tesfaye',
      academic_year_id: 'year-3',
      section_id: 'sec-3b',
      telegram_user_id: null, // Not linked
      registration_status: 'pending',
    },
    // Section 3A student (Isolated scope)
    {
      id: 'stud-3a-1',
      hu_student_id: 'HU/10297/14',
      full_name: 'Yonas Mulugeta',
      academic_year_id: 'year-3',
      section_id: 'sec-3a',
      telegram_user_id: 10003,
      registration_status: 'locked',
    },
    // Section 2A & 2B students
    {
      id: 'stud-2a-1',
      hu_student_id: 'HU/20001/15',
      full_name: 'Second Year Alpha',
      academic_year_id: 'year-2',
      section_id: 'sec-2a',
      telegram_user_id: 20001,
      registration_status: 'locked',
    },
    {
      id: 'stud-2b-1',
      hu_student_id: 'HU/20002/15',
      full_name: 'Second Year Beta',
      academic_year_id: 'year-2',
      section_id: 'sec-2b',
      telegram_user_id: 20002,
      registration_status: 'locked',
    },
  ];

  const mockProjects: Record<string, any> = {
    'proj-ind-db': {
      id: 'proj-ind-db',
      title: 'Database Assignment 1',
      submission_type: 'individual',
      is_active: true,
      opening_date: new Date(now - 86400000 * 2).toISOString(),
      deadline: new Date(now + 86400000 * 5).toISOString(),
      targets: [
        { academic_year_id: 'year-3', section_id: 'sec-3b' },
        { academic_year_id: 'year-3', section_id: 'sec-3a' }, // Multi-target
      ],
      course: { title: 'Database Systems' },
      teacher: { full_name: 'Dr. Michael' },
    },
    'proj-grp-se': {
      id: 'proj-grp-se',
      title: 'Software Engineering Architecture',
      submission_type: 'group',
      is_active: true,
      opening_date: new Date(now - 86400000 * 2).toISOString(),
      deadline: new Date(now + 86400000 * 5).toISOString(),
      targets: [
        { academic_year_id: 'year-3', section_id: 'sec-3b' },
      ],
      course: { title: 'Software Engineering' },
      teacher: { full_name: 'Prof. Almaz' },
    },
  };

  let mockGroups: any[] = [];
  let mockSubmissions: any[] = [];
  let mockSubmissionFiles: any[] = [];
  let mockSubmissionMembers: any[] = [];

  function resetState() {
    mockGroups = [
      // Group 1 in Sec 3B (Submitted)
      {
        id: 'grp-3b-01',
        project_id: 'proj-grp-se',
        section_id: 'sec-3b',
        group_code: 'GRP-01',
        group_leader_id: 'stud-3b-1',
        status: 'submitted',
        leader: mockStudents[0],
        members: [
          {
            id: 'gm-1',
            group_id: 'grp-3b-01',
            student_id: 'stud-3b-1',
            confirmation_status: 'confirmed',
            student: mockStudents[0],
          },
          {
            id: 'gm-2',
            group_id: 'grp-3b-01',
            student_id: 'stud-3b-2',
            confirmation_status: 'confirmed',
            student: mockStudents[1],
          },
        ],
      },
      // Group 2 in Sec 3B (Missing & Unverified)
      {
        id: 'grp-3b-02',
        project_id: 'proj-grp-se',
        section_id: 'sec-3b',
        group_code: 'GRP-02',
        group_leader_id: 'stud-3b-3',
        status: 'pending',
        leader: mockStudents[2],
        members: [
          {
            id: 'gm-3',
            group_id: 'grp-3b-02',
            student_id: 'stud-3b-3',
            confirmation_status: 'pending',
            student: mockStudents[2],
          },
        ],
      },
      // Group 1 in Sec 3A (Different Section)
      {
        id: 'grp-3a-01',
        project_id: 'proj-grp-se',
        section_id: 'sec-3a',
        group_code: 'GRP-01', // Same group code in different section
        group_leader_id: 'stud-3a-1',
        status: 'submitted',
        leader: mockStudents[3],
        members: [
          {
            id: 'gm-4',
            group_id: 'grp-3a-01',
            student_id: 'stud-3a-1',
            confirmation_status: 'confirmed',
            student: mockStudents[3],
          },
        ],
      },
    ];

    mockSubmissions = [
      // Individual: Student Abebe Bikila submitted v2 (resubmission)
      {
        id: 'sub-ind-v1',
        project_id: 'proj-ind-db',
        section_id: 'sec-3b',
        submission_type: 'individual',
        student_id: 'stud-3b-1',
        group_id: null,
        version: 1,
        status: 'superseded', // Historical version
        created_at: new Date(now - 86400000).toISOString(),
      },
      {
        id: 'sub-ind-v2',
        project_id: 'proj-ind-db',
        section_id: 'sec-3b',
        submission_type: 'individual',
        student_id: 'stud-3b-1',
        group_id: null,
        version: 2,
        status: 'active', // Current active version
        created_at: new Date(now - 3600000).toISOString(),
      },
      // Individual: Student in 3A submitted (should not appear in 3B report)
      {
        id: 'sub-ind-3a',
        project_id: 'proj-ind-db',
        section_id: 'sec-3a',
        submission_type: 'individual',
        student_id: 'stud-3a-1',
        group_id: null,
        version: 1,
        status: 'active',
        created_at: new Date(now - 7200000).toISOString(),
      },
      // Group: GRP-01 submitted
      {
        id: 'sub-grp-1',
        project_id: 'proj-grp-se',
        section_id: 'sec-3b',
        submission_type: 'group',
        student_id: null,
        group_id: 'grp-3b-01',
        version: 1,
        status: 'active',
        created_at: new Date(now - 5000000).toISOString(),
      },
    ];

    mockSubmissionFiles = [
      {
        id: 'file-ind-v2',
        submission_id: 'sub-ind-v2',
        original_filename: 'db_assignment_v2.pdf',
        file_size_bytes: 2048576, // ~2 MB
        mime_type: 'application/pdf',
      },
      {
        id: 'file-grp-1',
        submission_id: 'sub-grp-1',
        original_filename: 'se_architecture_report.pdf',
        file_size_bytes: 5242880, // ~5 MB
        mime_type: 'application/pdf',
      },
    ];

    mockSubmissionMembers = [
      {
        id: 'sm-1',
        submission_id: 'sub-grp-1',
        student_id: 'stud-3b-1',
        hu_student_id: 'HU/10294/14',
        student_name: 'Abebe Bikila',
        is_submitter: true,
      },
      {
        id: 'sm-2',
        submission_id: 'sub-grp-1',
        student_id: 'stud-3b-2',
        hu_student_id: 'HU/10295/14',
        student_name: 'Sara Mohammed',
        is_submitter: false,
      },
    ];
  }

  function createMockSupabaseClient() {
    return {
      from: (table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: (_col: string, val: unknown) => ({
                eq: (_col2: string, isActive: unknown) => ({
                  maybeSingle: async () => {
                    const match = mockProfiles.find(
                      (p) => p.telegram_user_id === val && p.is_active === isActive
                    );
                    return { data: match || null, error: null };
                  },
                }),
              }),
            }),
          };
        }

        if (table === 'representative_assignments') {
          return {
            select: () => ({
              eq: (_col: string, profileId: unknown) => ({
                eq: (_col2: string, isActive: unknown) => {
                  const matches = mockAssignments.filter(
                    (a) => a.profile_id === profileId && a.is_active === isActive
                  );
                  return Promise.resolve({ data: matches, error: null });
                },
              }),
            }),
          };
        }

        if (table === 'sections') {
          return {
            select: () => ({
              eq: (_col: string, secId: unknown) => ({
                single: async () => {
                  const sec = mockSections[secId as string];
                  return { data: sec || null, error: sec ? null : new Error('Not found') };
                },
              }),
            }),
          };
        }

        if (table === 'students') {
          return {
            select: () => {
              const query = {
                eq: (_col: string, secId: unknown) => {
                  const list = mockStudents.filter((s) => s.section_id === secId);
                  return {
                    order: () => Promise.resolve({ data: list, error: null }),
                    then: (resolve: any) => resolve({ data: list, error: null }),
                  };
                },
              };
              return query;
            },
          };
        }

        if (table === 'projects') {
          return {
            select: () => {
              const queryBuilder: any = {
                eq: (_col: string, projId: unknown) => {
                  if (_col === 'id') {
                    return {
                      single: async () => {
                        const proj = mockProjects[projId as string];
                        return { data: proj || null, error: proj ? null : new Error('Not found') };
                      },
                    };
                  }
                  return queryBuilder;
                },
                or: () => queryBuilder,
                order: () => Promise.resolve({ data: Object.values(mockProjects), error: null }),
                single: async () => ({ data: null, error: new Error('Not found') }),
              };
              return queryBuilder;
            },
          };
        }

        if (table === 'groups') {
          return {
            select: () => ({
              eq: (_col1: string, projId: unknown) => ({
                eq: (_col2: string, secId: unknown) => {
                  const list = mockGroups.filter(
                    (g) => g.project_id === projId && g.section_id === secId
                  );
                  return {
                    order: () => Promise.resolve({ data: list, error: null }),
                    then: (resolve: any) => resolve({ data: list, error: null }),
                  };
                },
              }),
            }),
          };
        }

        if (table === 'submissions') {
          return {
            select: (_cols?: string, options?: any) => {
              const isCount = options?.count === 'exact';
              return {
                eq: (_col1: string, projId: unknown) => ({
                  eq: (_col2: string, secId: unknown) => ({
                    eq: (_col3: string, subType: unknown) => ({
                      eq: (_col4: string, statusVal: unknown) => {
                        const matches = mockSubmissions.filter(
                          (s) =>
                            s.project_id === projId &&
                            s.section_id === secId &&
                            s.submission_type === subType &&
                            s.status === statusVal
                        );

                        // Attach files and snapshots
                        const enriched = matches.map((sub) => ({
                          ...sub,
                          files: mockSubmissionFiles.filter((f) => f.submission_id === sub.id),
                          snapshots: mockSubmissionMembers.filter((m) => m.submission_id === sub.id),
                        }));

                        if (isCount) {
                          return Promise.resolve({ count: enriched.length, error: null });
                        }
                        return Promise.resolve({ data: enriched, error: null });
                      },
                    }),
                  }),
                }),
              };
            },
          };
        }

        throw new Error(`Unexpected table in mock: ${table}`);
      },
    } as any;
  }

  beforeEach(() => {
    resetState();
  });

  // ---------------------------------------------------------------------------
  // Test 1: Scope Isolation - Unauthorized Representative Blocked
  // ---------------------------------------------------------------------------
  it('should block a representative from querying reports for an unassigned section', async () => {
    const mockClient = createMockSupabaseClient();
    const service = new RepresentativeReportingService(mockClient);

    // Hamza is assigned to Section 3B only. Attempting to query Section 3A must fail.
    await assert.rejects(
      async () => await service.getDetailedIndividualReport(11111111, 'sec-3a', 'proj-ind-db'),
      (err: any) => {
        assert.ok(err instanceof UnauthorizedSectionScopeError);
        assert.match(err.message, /Access denied/);
        return true;
      }
    );
  });

  // ---------------------------------------------------------------------------
  // Test 2: Deactivated Representative Rejected
  // ---------------------------------------------------------------------------
  it('should reject a deactivated representative from generating any reports', async () => {
    const mockClient = createMockSupabaseClient();
    const service = new RepresentativeReportingService(mockClient);

    await assert.rejects(
      async () => await service.getDetailedIndividualReport(33333333, 'sec-3b', 'proj-ind-db'),
      (err: any) => {
        assert.ok(err instanceof UnauthorizedSectionScopeError);
        return true;
      }
    );
  });

  // ---------------------------------------------------------------------------
  // Test 3: Unknown Telegram User Rejected
  // ---------------------------------------------------------------------------
  it('should reject an unknown Telegram user ID', async () => {
    const mockClient = createMockSupabaseClient();
    const service = new RepresentativeReportingService(mockClient);

    await assert.rejects(
      async () => await service.getDetailedIndividualReport(99999999, 'sec-3b', 'proj-ind-db'),
      (err: any) => {
        assert.ok(err instanceof UnauthorizedSectionScopeError);
        return true;
      }
    );
  });

  // ---------------------------------------------------------------------------
  // Test 4: Individual Submission Reporting Accuracy
  // ---------------------------------------------------------------------------
  it('should accurately calculate submitted vs. missing individual students with file metadata', async () => {
    const mockClient = createMockSupabaseClient();
    const service = new RepresentativeReportingService(mockClient);

    const report = await service.getDetailedIndividualReport(11111111, 'sec-3b', 'proj-ind-db');

    assert.equal(report.totalEligibleStudents, 3);
    assert.equal(report.submittedCount, 1);
    assert.equal(report.missingCount, 2);
    assert.equal(report.completionPercentage, 33);
    assert.equal(report.isPastDeadline, false);

    // Verify submitted student details
    assert.equal(report.submittedStudents.length, 1);
    const subItem = report.submittedStudents[0];
    assert.equal(subItem.student.full_name, 'Abebe Bikila');
    assert.equal(subItem.student.hu_student_id, 'HU/10294/14');
    assert.equal(subItem.version, 2);
    assert.equal(subItem.isResubmission, true);
    assert.equal(subItem.fileName, 'db_assignment_v2.pdf');
    assert.equal(subItem.fileSizeBytes, 2048576);

    // Verify missing students details
    assert.equal(report.missingStudents.length, 2);
    const sara = report.missingStudents.find((s) => s.fullName === 'Sara Mohammed');
    const daniel = report.missingStudents.find((s) => s.fullName === 'Daniel Tesfaye');

    assert.ok(sara);
    assert.equal(sara.huStudentId, 'HU/10295/14');
    assert.equal(sara.registrationStatus, 'locked');
    assert.equal(sara.isTelegramLinked, true);

    assert.ok(daniel);
    assert.equal(daniel.huStudentId, 'HU/10296/14');
    assert.equal(daniel.registrationStatus, 'pending');
    assert.equal(daniel.isTelegramLinked, false);
  });

  // ---------------------------------------------------------------------------
  // Test 5: Group Submission Reporting Accuracy & Team Snapshot Attribution
  // ---------------------------------------------------------------------------
  it('should accurately report submitted groups with credited snapshots and missing unverified teams', async () => {
    const mockClient = createMockSupabaseClient();
    const service = new RepresentativeReportingService(mockClient);

    const report = await service.getDetailedGroupReport(11111111, 'sec-3b', 'proj-grp-se');

    assert.equal(report.totalGroups, 2);
    assert.equal(report.submittedGroupsCount, 1);
    assert.equal(report.missingGroupsCount, 1);
    assert.equal(report.completionPercentage, 50);

    // Verify submitted group and member snapshots
    assert.equal(report.submittedGroups.length, 1);
    const grpSub = report.submittedGroups[0];
    assert.equal(grpSub.group.group_code, 'GRP-01');
    assert.equal(grpSub.submittedByStudentName, 'Abebe Bikila');
    assert.equal(grpSub.fileName, 'se_architecture_report.pdf');
    assert.equal(grpSub.version, 1);

    // Member snapshots attribution check
    assert.equal(grpSub.creditedMembers.length, 2);
    const creditedLeader = grpSub.creditedMembers.find((m) => m.huStudentId === 'HU/10294/14');
    const creditedTeammate = grpSub.creditedMembers.find((m) => m.huStudentId === 'HU/10295/14');
    assert.ok(creditedLeader);
    assert.equal(creditedLeader.isSubmitter, true);
    assert.ok(creditedTeammate);
    assert.equal(creditedTeammate.isSubmitter, false);

    // Verify missing group diagnostic breakdown
    assert.equal(report.missingGroups.length, 1);
    const missingGrp = report.missingGroups[0];
    assert.equal(missingGrp.groupCode, 'GRP-02');
    assert.equal(missingGrp.groupStatus, 'pending');
    assert.equal(missingGrp.confirmedMembersCount, 0);
    assert.equal(missingGrp.pendingMembersCount, 1);
    assert.equal(missingGrp.pendingMemberNames[0], 'Daniel Tesfaye');
  });

  // ---------------------------------------------------------------------------
  // Test 6: Multi-Target Project Scope Partitioning
  // ---------------------------------------------------------------------------
  it('should strictly isolate reporting data when a project targets multiple sections', async () => {
    const mockClient = createMockSupabaseClient();
    const service = new RepresentativeReportingService(mockClient);

    // proj-ind-db targets both Section 3A and 3B
    // Querying report for Section 3B by Rep Hamza:
    const report3B = await service.getDetailedIndividualReport(11111111, 'sec-3b', 'proj-ind-db');

    // Section 3B has 3 students. Student Yonas Mulugeta (Section 3A) must NOT appear!
    const yonasIn3B = report3B.submittedStudents.some((s) => s.student.full_name === 'Yonas Mulugeta')
      || report3B.missingStudents.some((s) => s.fullName === 'Yonas Mulugeta');
    assert.equal(yonasIn3B, false);
    assert.equal(report3B.totalEligibleStudents, 3);
  });

  // ---------------------------------------------------------------------------
  // Test 7: Resubmission Versioning - Superseded Not Double Counted
  // ---------------------------------------------------------------------------
  it('should count only active submissions in current statistics and ignore superseded versions', async () => {
    const mockClient = createMockSupabaseClient();
    const service = new RepresentativeReportingService(mockClient);

    // In mock, Student Abebe has sub-ind-v1 (superseded) and sub-ind-v2 (active)
    const report = await service.getDetailedIndividualReport(11111111, 'sec-3b', 'proj-ind-db');

    // Submitted count must be 1, not 2
    assert.equal(report.submittedCount, 1);
    assert.equal(report.submittedStudents.length, 1);
    assert.equal(report.submittedStudents[0].version, 2);
  });

  // ---------------------------------------------------------------------------
  // Test 8: Multi-Section Assigned Representative Independence
  // ---------------------------------------------------------------------------
  it('should allow a dual-section representative to report on each assigned section independently', async () => {
    const mockClient = createMockSupabaseClient();
    const service = new RepresentativeReportingService(mockClient);

    // Dual Section Rep (22222222) is assigned to both Section 2A and Section 2B
    // Section 2A summary:
    const summary2A = await service.getSectionSummaryReport(22222222, 'sec-2a');
    assert.equal(summary2A.sectionName, 'Section A');
    assert.equal(summary2A.totalStudentsEnrolled, 1);

    // Section 2B summary:
    const summary2B = await service.getSectionSummaryReport(22222222, 'sec-2b');
    assert.equal(summary2B.sectionName, 'Section B');
    assert.equal(summary2B.totalStudentsEnrolled, 1);
  });

  // ---------------------------------------------------------------------------
  // Test 9: Section Summary Report Calculation
  // ---------------------------------------------------------------------------
  it('should compute high-level project summary across all targeted assignments in section', async () => {
    const mockClient = createMockSupabaseClient();
    const service = new RepresentativeReportingService(mockClient);

    const summary = await service.getSectionSummaryReport(11111111, 'sec-3b');

    assert.equal(summary.sectionId, 'sec-3b');
    assert.equal(summary.sectionName, 'Section B');
    assert.equal(summary.academicYearName, '3rd Year');
    assert.equal(summary.totalStudentsEnrolled, 3);
    assert.equal(summary.totalActiveProjects, 2);
    assert.equal(summary.projectsSummary.length, 2);
  });

  // ---------------------------------------------------------------------------
  // Test 10: Structured JSON Export Generation
  // ---------------------------------------------------------------------------
  it('should generate structured JSON export for individual and group projects', async () => {
    const mockClient = createMockSupabaseClient();
    const service = new RepresentativeReportingService(mockClient);

    const indJson = await service.exportSectionReportJson(11111111, 'sec-3b', 'proj-ind-db');
    assert.equal(indJson.reportType, 'individual');
    assert.ok(indJson.exportedAt);
    assert.equal(indJson.totalEligibleStudents, 3);

    const grpJson = await service.exportSectionReportJson(11111111, 'sec-3b', 'proj-grp-se');
    assert.equal(grpJson.reportType, 'group');
    assert.ok(grpJson.exportedAt);
    assert.equal(grpJson.totalGroups, 2);
  });
});
