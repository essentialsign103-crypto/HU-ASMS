// HU-ASMS: Phase 12 Representative Group Pre-Creation Unit Tests
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeCreateProjectGroup,
  type CreateProjectGroupInput,
} from '../src/lib/rep/group-precreation-service.js';
import type { UserSessionContext } from '../src/lib/auth/roles.js';
import { globalWebRateLimiter } from '../src/lib/security/rate-limiter.js';

const REP_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const YEAR_3_UUID = '10000000-0000-4000-8000-000000000003';
const SEC_3B_UUID = '11111111-1111-4111-8111-11111111113b';
const SEC_3A_UUID = '11111111-1111-4111-8111-11111111113a';
const SEC_UNASSIGNED_UUID = '11111111-1111-4111-8111-111111111199';
const PROJ_ALGO_UUID = '22222222-2222-4222-8222-222222222210';
const STUD_1_UUID = '55555555-5555-4555-8555-555555555501';
const STUD_2_UUID = '55555555-5555-4555-8555-555555555502';
const STUD_3_UUID = '55555555-5555-4555-8555-555555555503';
const STUD_4_UUID = '55555555-5555-4555-8555-555555555504';
const STUD_5_UUID = '55555555-5555-4555-8555-555555555505';
const STUD_SUSPENDED_UUID = '55555555-5555-4555-8555-555555555506';
const STUD_OUTSIDE_UUID = '55555555-5555-4555-8555-555555555507';
const STUD_PENDING_UUID = '55555555-5555-4555-8555-555555555508';
const STUD_GHOST_UUID = '55555555-5555-4555-8555-555555555509';
const GROUP_GEN_UUID = '88888888-8888-4888-8888-888888888801';

describe('Phase 12 — Representative Group Pre-Creation Service Unit Tests', () => {
  beforeEach(() => {
    globalWebRateLimiter.reset();
  });

  const mockRepContext: UserSessionContext = {
    userId: REP_UUID,
    profile: {
      id: REP_UUID,
      telegram_user_id: 11111111,
      full_name: 'Ahmed Representative',
      email: 'rep.ahmed@haramaya.edu.et',
      role: 'representative',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    isOwner: false,
    isRepresentative: true,
    assignments: [
      {
        id: 'assign-1',
        profile_id: REP_UUID,
        section_id: SEC_3B_UUID,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  };

  const sampleProject = {
    id: PROJ_ALGO_UUID,
    title: 'Algorithms Term Project',
    is_active: true,
    submission_type: 'group',
    file_rules: {
      min_group_size: 2,
      max_group_size: 4,
    },
    targets: [{ academic_year_id: YEAR_3_UUID, section_id: SEC_3B_UUID }],
  };

  const enrolledStudents = [
    { id: STUD_1_UUID, section_id: SEC_3B_UUID, registration_status: 'approved', full_name: 'Abebe Bikila' },
    { id: STUD_2_UUID, section_id: SEC_3B_UUID, registration_status: 'approved', full_name: 'Derartu Tulu' },
    { id: STUD_3_UUID, section_id: SEC_3B_UUID, registration_status: 'approved', full_name: 'Haile Gebrselassie' },
    { id: STUD_SUSPENDED_UUID, section_id: SEC_3B_UUID, registration_status: 'suspended', full_name: 'Suspended Student' },
    { id: STUD_OUTSIDE_UUID, section_id: SEC_3A_UUID, registration_status: 'approved', full_name: 'Outside Section Student' },
    { id: STUD_PENDING_UUID, section_id: SEC_3B_UUID, registration_status: 'pending', full_name: 'Pending Student' },
  ];

  function createMockSupabase(dbState: {
    sections?: any[];
    project?: any;
    students?: any[];
    existingGroups?: any[];
    existingMemberships?: any[];
    auditLogs?: any[];
    groupMembersQueryError?: string;
    groupMembersInsertError?: string;
    auditError?: string;
    onQuery?: (table: string) => void;
  }) {
    const insertedGroups: any[] = [];
    const insertedMembers: any[] = [];
    const deletedGroups: string[] = [];
    const insertedAuditLogs: any[] = dbState.auditLogs || [];
    const defaultSections = [
      { id: SEC_3B_UUID, academic_year_id: YEAR_3_UUID },
      { id: SEC_UNASSIGNED_UUID, academic_year_id: YEAR_3_UUID },
    ];

    const mockClient = {
      from: (table: string) => {
        dbState.onQuery?.(table);

        if (table === 'sections') {
          return {
            select: () => ({
              eq: (_col: string, id: string) => ({
                single: async () => {
                  const found = (dbState.sections ?? defaultSections).find((s) => s.id === id);
                  return found
                    ? { data: found, error: null }
                    : { data: null, error: new Error('Section not found') };
                },
              }),
            }),
          };
        }

        if (table === 'projects') {
          return {
            select: () => ({
              eq: (_col: string, id: string) => ({
                single: async () => {
                  if (dbState.project && dbState.project.id === id) {
                    return { data: dbState.project, error: null };
                  }
                  return { data: null, error: new Error('Project not found') };
                },
              }),
            }),
          };
        }

        if (table === 'students') {
          return {
            select: () => ({
              in: (_col: string, ids: string[]) => {
                const found = (dbState.students || enrolledStudents).filter((s) => ids.includes(s.id));
                return Promise.resolve({ data: found, error: null });
              },
            }),
          };
        }

        if (table === 'groups') {
          return {
            select: () => ({
              eq: (_col1: string, val1: string) => ({
                eq: (_col2: string, val2: string) => ({
                  eq: (_col3: string, val3: string) => ({
                    maybeSingle: async () => {
                      const match = (dbState.existingGroups || []).find(
                        (g) => g.project_id === val1 && g.section_id === val2 && g.group_code === val3
                      );
                      return { data: match || null, error: null };
                    },
                  }),
                }),
              }),
            }),
            insert: (record: any) => ({
              select: () => ({
                single: async () => {
                  const created = { id: GROUP_GEN_UUID, ...record };
                  insertedGroups.push(created);
                  return { data: created, error: null };
                },
              }),
            }),
            delete: () => ({
              eq: async (_col: string, id: string) => {
                deletedGroups.push(id);
                return { error: null };
              },
            }),
          };
        }

        if (table === 'group_members') {
          return {
            select: () => ({
              eq: (_col: string, projId: string) => ({
                in: (_col2: string, ids: string[]) => ({
                  in: (_col3: string, statuses: string[]) => {
                    if (dbState.groupMembersQueryError) {
                      return Promise.resolve({
                        data: null,
                        error: { message: dbState.groupMembersQueryError },
                      });
                    }
                    const match = (dbState.existingMemberships || []).filter(
                      (m) =>
                        ids.includes(m.student_id) &&
                        (!m.group?.project_id || m.group.project_id === projId) &&
                        statuses.includes(m.confirmation_status)
                    );
                    return Promise.resolve({ data: match, error: null });
                  },
                }),
              }),
            }),
            insert: (records: any[]) => {
              if (dbState.groupMembersInsertError) {
                return Promise.resolve({ error: { message: dbState.groupMembersInsertError } });
              }
              insertedMembers.push(...records);
              return Promise.resolve({ error: null });
            },
          };
        }

        if (table === 'audit_logs') {
          return {
            insert: (log: any) => {
              if (dbState.auditError) {
                return Promise.resolve({ error: { message: dbState.auditError } });
              }
              insertedAuditLogs.push(log);
              return Promise.resolve({ error: null });
            },
          };
        }

        throw new Error(`Unexpected table queried: ${table}`);
      },
      _state: {
        insertedGroups,
        insertedMembers,
        deletedGroups,
        insertedAuditLogs,
      },
    };

    return mockClient as any;
  }

  it('should successfully pre-create group with leader and pending members adhering to all invariants', async () => {
    const mockDb = createMockSupabase({
      project: sampleProject,
      students: enrolledStudents,
    });

    const input: CreateProjectGroupInput = {
      sectionId: SEC_3B_UUID,
      projectId: PROJ_ALGO_UUID,
      groupCode: 'Group 01',
      leaderStudentId: STUD_1_UUID,
      memberStudentIds: [STUD_1_UUID, STUD_2_UUID, STUD_3_UUID],
    };

    const result = await executeCreateProjectGroup(mockDb, mockRepContext, input);

    assert.equal(result.success, true);
    assert.equal(result.groupId, GROUP_GEN_UUID);

    // Verify group record
    assert.equal(mockDb._state.insertedGroups.length, 1);
    const group = mockDb._state.insertedGroups[0];
    assert.equal(group.group_code, 'Group 01');
    assert.equal(group.section_id, SEC_3B_UUID);
    assert.equal(group.group_leader_id, STUD_1_UUID);
    assert.equal(group.status, 'pending'); // Strictly 'pending' until members confirm

    // Verify member records
    assert.equal(mockDb._state.insertedMembers.length, 3);
    const leaderMember = mockDb._state.insertedMembers.find((m: any) => m.student_id === STUD_1_UUID);
    assert.ok(leaderMember);
    assert.equal(leaderMember.is_group_leader, true);
    assert.equal(leaderMember.confirmation_status, 'pending');

    const regularMember = mockDb._state.insertedMembers.find((m: any) => m.student_id === STUD_2_UUID);
    assert.ok(regularMember);
    assert.equal(regularMember.is_group_leader, false);
    assert.equal(regularMember.confirmation_status, 'pending');

    // Verify audit log
    assert.equal(mockDb._state.insertedAuditLogs.length, 1);
    assert.equal(mockDb._state.insertedAuditLogs[0].action, 'GROUP_PRECREATED');
    assert.equal(mockDb._state.insertedAuditLogs[0].metadata.group_code, 'Group 01');
  });

  it('should reject pre-creation if representative is not assigned to the target section', async () => {
    const mockDb = createMockSupabase({ project: sampleProject });

    const input: CreateProjectGroupInput = {
      sectionId: SEC_UNASSIGNED_UUID,
      projectId: PROJ_ALGO_UUID,
      groupCode: 'Group 01',
      leaderStudentId: STUD_1_UUID,
      memberStudentIds: [STUD_1_UUID, STUD_2_UUID],
    };

    const result = await executeCreateProjectGroup(mockDb, mockRepContext, input);

    assert.equal(result.success, false);
    assert.match(result.error || '', new RegExp(`Forbidden: Access denied for section ${SEC_UNASSIGNED_UUID}`));
    assert.equal(mockDb._state.insertedGroups.length, 0);
  });

  it('should reject pre-creation if project is configured for individual submission only', async () => {
    const indivProject = {
      ...sampleProject,
      submission_type: 'individual',
    };
    const mockDb = createMockSupabase({ project: indivProject });

    const input: CreateProjectGroupInput = {
      sectionId: SEC_3B_UUID,
      projectId: PROJ_ALGO_UUID,
      groupCode: 'Group 01',
      leaderStudentId: STUD_1_UUID,
      memberStudentIds: [STUD_1_UUID, STUD_2_UUID],
    };

    const result = await executeCreateProjectGroup(mockDb, mockRepContext, input);

    assert.equal(result.success, false);
    assert.match(result.error || '', /This project does not accept group submissions/);
  });

  it('should reject pre-creation if group size violates min/max bounds', async () => {
    const mockDb = createMockSupabase({ project: sampleProject });

    // Under minimum (1 student, min is 2)
    const underInput: CreateProjectGroupInput = {
      sectionId: SEC_3B_UUID,
      projectId: PROJ_ALGO_UUID,
      groupCode: 'Group 01',
      leaderStudentId: STUD_1_UUID,
      memberStudentIds: [STUD_1_UUID],
    };
    const underResult = await executeCreateProjectGroup(mockDb, mockRepContext, underInput);
    assert.equal(underResult.success, false);
    assert.match(underResult.error || '', /Group size violation: Must assign between 2 and 4 members/);

    // Over maximum (5 students, max is 4)
    const overInput: CreateProjectGroupInput = {
      sectionId: SEC_3B_UUID,
      projectId: PROJ_ALGO_UUID,
      groupCode: 'Group 01',
      leaderStudentId: STUD_1_UUID,
      memberStudentIds: [STUD_1_UUID, STUD_2_UUID, STUD_3_UUID, STUD_4_UUID, STUD_5_UUID],
    };
    const overResult = await executeCreateProjectGroup(mockDb, mockRepContext, overInput);
    assert.equal(overResult.success, false);
    assert.match(overResult.error || '', /Group size violation: Must assign between 2 and 4 members/);
  });

  it('should reject pre-creation if designated leader is not in members list', async () => {
    const mockDb = createMockSupabase({ project: sampleProject });

    const input: CreateProjectGroupInput = {
      sectionId: SEC_3B_UUID,
      projectId: PROJ_ALGO_UUID,
      groupCode: 'Group 01',
      leaderStudentId: STUD_GHOST_UUID,
      memberStudentIds: [STUD_1_UUID, STUD_2_UUID],
    };

    const result = await executeCreateProjectGroup(mockDb, mockRepContext, input);

    assert.equal(result.success, false);
    assert.match(result.error || '', /The designated group leader must be included in the assigned members list/);
  });

  it('should reject duplicate group code within the same project and section', async () => {
    const existingGroups = [
      { id: 'grp-dup', project_id: PROJ_ALGO_UUID, section_id: SEC_3B_UUID, group_code: 'Group 01' },
    ];
    const mockDb = createMockSupabase({ project: sampleProject, existingGroups });

    const input: CreateProjectGroupInput = {
      sectionId: SEC_3B_UUID,
      projectId: PROJ_ALGO_UUID,
      groupCode: 'Group 01',
      leaderStudentId: STUD_1_UUID,
      memberStudentIds: [STUD_1_UUID, STUD_2_UUID],
    };

    const result = await executeCreateProjectGroup(mockDb, mockRepContext, input);

    assert.equal(result.success, false);
    assert.match(result.error || '', /Group "Group 01" already exists for this project in your section/);
  });

  it('should reject cross-section student assignment', async () => {
    const mockDb = createMockSupabase({ project: sampleProject, students: enrolledStudents });

    const input: CreateProjectGroupInput = {
      sectionId: SEC_3B_UUID,
      projectId: PROJ_ALGO_UUID,
      groupCode: 'Group 02',
      leaderStudentId: STUD_1_UUID,
      memberStudentIds: [STUD_1_UUID, STUD_OUTSIDE_UUID], // Outside section student
    };

    const result = await executeCreateProjectGroup(mockDb, mockRepContext, input);

    assert.equal(result.success, false);
    assert.match(result.error || '', /Cross-section violation: Student "Outside Section Student" is not enrolled in this section/);
  });

  it('should reject assigning a suspended student', async () => {
    const mockDb = createMockSupabase({ project: sampleProject, students: enrolledStudents });

    const input: CreateProjectGroupInput = {
      sectionId: SEC_3B_UUID,
      projectId: PROJ_ALGO_UUID,
      groupCode: 'Group 02',
      leaderStudentId: STUD_1_UUID,
      memberStudentIds: [STUD_1_UUID, STUD_SUSPENDED_UUID],
    };

    const result = await executeCreateProjectGroup(mockDb, mockRepContext, input);

    assert.equal(result.success, false);
    assert.match(result.error || '', /Suspended student violation: Student "Suspended Student" is currently suspended/);
  });

  it('should reject assigning a student who is already in another group with pending or confirmed status, while allowing declined or removed reassignment', async () => {
    // 1. Confirmed membership blocks reassignment
    const confirmedRes = await executeCreateProjectGroup(
      createMockSupabase({
        project: sampleProject,
        students: enrolledStudents,
        existingMemberships: [
          {
            student_id: STUD_2_UUID,
            confirmation_status: 'confirmed',
            group: { project_id: PROJ_ALGO_UUID, group_code: 'Group 01' },
          },
        ],
      }),
      mockRepContext,
      {
        sectionId: SEC_3B_UUID,
        projectId: PROJ_ALGO_UUID,
        groupCode: 'Group 02',
        leaderStudentId: STUD_1_UUID,
        memberStudentIds: [STUD_1_UUID, STUD_2_UUID],
      }
    );
    assert.equal(confirmedRes.success, false);
    assert.match(confirmedRes.error || '', /is already assigned to another group for this project/);

    // 2. Pending membership also blocks reassignment
    const pendingRes = await executeCreateProjectGroup(
      createMockSupabase({
        project: sampleProject,
        students: enrolledStudents,
        existingMemberships: [
          {
            student_id: STUD_2_UUID,
            confirmation_status: 'pending',
            group: { project_id: PROJ_ALGO_UUID, group_code: 'Group 01' },
          },
        ],
      }),
      mockRepContext,
      {
        sectionId: SEC_3B_UUID,
        projectId: PROJ_ALGO_UUID,
        groupCode: 'Group 03',
        leaderStudentId: STUD_1_UUID,
        memberStudentIds: [STUD_1_UUID, STUD_2_UUID],
      }
    );
    assert.equal(pendingRes.success, false);
    assert.match(pendingRes.error || '', /is already assigned to another group for this project/);

    // 3. Declined and removed memberships allow reassignment (matching DB trigger)
    const declinedAndRemovedRes = await executeCreateProjectGroup(
      createMockSupabase({
        project: sampleProject,
        students: enrolledStudents,
        existingMemberships: [
          {
            student_id: STUD_2_UUID,
            confirmation_status: 'declined',
            group: { project_id: PROJ_ALGO_UUID, group_code: 'Group 00' },
          },
          {
            student_id: STUD_3_UUID,
            confirmation_status: 'removed',
            group: { project_id: PROJ_ALGO_UUID, group_code: 'Group 00' },
          },
        ],
      }),
      mockRepContext,
      {
        sectionId: SEC_3B_UUID,
        projectId: PROJ_ALGO_UUID,
        groupCode: 'Group 04',
        leaderStudentId: STUD_1_UUID,
        memberStudentIds: [STUD_1_UUID, STUD_2_UUID, STUD_3_UUID],
      }
    );
    assert.equal(declinedAndRemovedRes.success, true);
    assert.equal(declinedAndRemovedRes.groupId, GROUP_GEN_UUID);
  });

  it('should reject duplicate members, unapproved students, invalid UUIDs, oversized group codes, untargeted/inactive projects, query errors, and compensate on partial failure', async () => {
    let queryCount = 0;
    const badUuidRes = await executeCreateProjectGroup(
      createMockSupabase({
        project: sampleProject,
        students: enrolledStudents,
        onQuery: () => {
          queryCount += 1;
        },
      }),
      mockRepContext,
      {
        sectionId: SEC_3B_UUID,
        projectId: 'not-a-uuid',
        groupCode: 'Group 01',
        leaderStudentId: STUD_1_UUID,
        memberStudentIds: [STUD_1_UUID, STUD_2_UUID],
      }
    );
    assert.equal(badUuidRes.success, false);
    assert.match(badUuidRes.error ?? '', /Invalid project identifier/);
    assert.equal(queryCount, 0);

    // Oversized group code (> 50 chars)
    const longCodeRes = await executeCreateProjectGroup(
      createMockSupabase({ project: sampleProject, students: enrolledStudents }),
      mockRepContext,
      {
        sectionId: SEC_3B_UUID,
        projectId: PROJ_ALGO_UUID,
        groupCode: 'G'.repeat(51),
        leaderStudentId: STUD_1_UUID,
        memberStudentIds: [STUD_1_UUID, STUD_2_UUID],
      }
    );
    assert.equal(longCodeRes.success, false);
    assert.match(longCodeRes.error ?? '', /50 characters or fewer/);

    // Duplicate member IDs
    const dupMemberRes = await executeCreateProjectGroup(
      createMockSupabase({ project: sampleProject, students: enrolledStudents }),
      mockRepContext,
      {
        sectionId: SEC_3B_UUID,
        projectId: PROJ_ALGO_UUID,
        groupCode: 'Group 05',
        leaderStudentId: STUD_1_UUID,
        memberStudentIds: [STUD_1_UUID, STUD_1_UUID],
      }
    );
    assert.equal(dupMemberRes.success, false);
    assert.match(dupMemberRes.error ?? '', /Duplicate student identifiers/);

    // Inactive project
    const inactiveProjRes = await executeCreateProjectGroup(
      createMockSupabase({
        project: { ...sampleProject, is_active: false },
        students: enrolledStudents,
      }),
      mockRepContext,
      {
        sectionId: SEC_3B_UUID,
        projectId: PROJ_ALGO_UUID,
        groupCode: 'Group 05',
        leaderStudentId: STUD_1_UUID,
        memberStudentIds: [STUD_1_UUID, STUD_2_UUID],
      }
    );
    assert.equal(inactiveProjRes.success, false);
    assert.match(inactiveProjRes.error ?? '', /inactive project/);

    // Untargeted project
    const untargetedRes = await executeCreateProjectGroup(
      createMockSupabase({
        project: { ...sampleProject, targets: [] },
        students: enrolledStudents,
      }),
      mockRepContext,
      {
        sectionId: SEC_3B_UUID,
        projectId: PROJ_ALGO_UUID,
        groupCode: 'Group 05',
        leaderStudentId: STUD_1_UUID,
        memberStudentIds: [STUD_1_UUID, STUD_2_UUID],
      }
    );
    assert.equal(untargetedRes.success, false);
    assert.match(untargetedRes.error ?? '', /not targeted to the specified academic section/);

    // Unapproved student
    const unapprovedRes = await executeCreateProjectGroup(
      createMockSupabase({ project: sampleProject, students: enrolledStudents }),
      mockRepContext,
      {
        sectionId: SEC_3B_UUID,
        projectId: PROJ_ALGO_UUID,
        groupCode: 'Group 05',
        leaderStudentId: STUD_1_UUID,
        memberStudentIds: [STUD_1_UUID, STUD_PENDING_UUID],
      }
    );
    assert.equal(unapprovedRes.success, false);
    assert.match(unapprovedRes.error ?? '', /Unapproved student violation/);

    // group_members conflict query error fails closed
    const queryErrRes = await executeCreateProjectGroup(
      createMockSupabase({
        project: sampleProject,
        students: enrolledStudents,
        groupMembersQueryError: 'connection reset',
      }),
      mockRepContext,
      {
        sectionId: SEC_3B_UUID,
        projectId: PROJ_ALGO_UUID,
        groupCode: 'Group 05',
        leaderStudentId: STUD_1_UUID,
        memberStudentIds: [STUD_1_UUID, STUD_2_UUID],
      }
    );
    assert.equal(queryErrRes.success, false);
    assert.match(queryErrRes.error ?? '', /Failed to verify existing group memberships/);

    // Partial failure rollback when group_members insert errors
    const memberFailDb = createMockSupabase({
      project: sampleProject,
      students: enrolledStudents,
      groupMembersInsertError: 'unique violation on group_members',
    });
    const memberFailRes = await executeCreateProjectGroup(memberFailDb, mockRepContext, {
      sectionId: SEC_3B_UUID,
      projectId: PROJ_ALGO_UUID,
      groupCode: 'Group 06',
      leaderStudentId: STUD_1_UUID,
      memberStudentIds: [STUD_1_UUID, STUD_2_UUID],
    });
    assert.equal(memberFailRes.success, false);
    assert.match(memberFailRes.error ?? '', /unique violation on group_members/);
    assert.deepEqual(memberFailDb._state.deletedGroups, [GROUP_GEN_UUID]);

    // Partial failure rollback when audit log fails
    const auditFailDb = createMockSupabase({
      project: sampleProject,
      students: enrolledStudents,
      auditError: 'audit RPC timeout',
    });
    const auditFailRes = await executeCreateProjectGroup(auditFailDb, mockRepContext, {
      sectionId: SEC_3B_UUID,
      projectId: PROJ_ALGO_UUID,
      groupCode: 'Group 07',
      leaderStudentId: STUD_1_UUID,
      memberStudentIds: [STUD_1_UUID, STUD_2_UUID],
    });
    assert.equal(auditFailRes.success, false);
    assert.match(auditFailRes.error ?? '', /Audit log recording failed/);
    assert.deepEqual(auditFailDb._state.deletedGroups, [GROUP_GEN_UUID]);
  });
});
