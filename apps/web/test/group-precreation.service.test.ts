// HU-ASMS: Phase 12 Representative Group Pre-Creation Unit Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeCreateProjectGroup,
  type CreateProjectGroupInput,
} from '../src/lib/rep/group-precreation-service.js';
import type { UserSessionContext } from '../src/lib/auth/roles.js';

describe('Phase 12 — Representative Group Pre-Creation Service Unit Tests', () => {
  const mockRepContext: UserSessionContext = {
    userId: 'user-rep-1',
    profile: {
      id: 'user-rep-1',
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
        profile_id: 'user-rep-1',
        section_id: 'sec-3b',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  };

  const sampleProject = {
    id: 'proj-algo-term',
    title: 'Algorithms Term Project',
    submission_type: 'group',
    file_rules: {
      min_group_size: 2,
      max_group_size: 4,
    },
  };

  const enrolledStudents = [
    { id: 'stud-1', section_id: 'sec-3b', registration_status: 'approved', full_name: 'Abebe Bikila' },
    { id: 'stud-2', section_id: 'sec-3b', registration_status: 'approved', full_name: 'Derartu Tulu' },
    { id: 'stud-3', section_id: 'sec-3b', registration_status: 'approved', full_name: 'Haile Gebrselassie' },
    { id: 'stud-suspended', section_id: 'sec-3b', registration_status: 'suspended', full_name: 'Suspended Student' },
    { id: 'stud-outside', section_id: 'sec-3a', registration_status: 'approved', full_name: 'Outside Section Student' },
  ];

  function createMockSupabase(dbState: {
    project?: any;
    students?: any[];
    existingGroups?: any[];
    existingMemberships?: any[];
    auditLogs?: any[];
  }) {
    const insertedGroups: any[] = [];
    const insertedMembers: any[] = [];
    const insertedAuditLogs: any[] = dbState.auditLogs || [];

    const mockClient = {
      from: (table: string) => {
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
              eq: (col1: string, val1: string) => ({
                eq: (col2: string, val2: string) => ({
                  eq: (col3: string, val3: string) => ({
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
                  const created = { id: 'group-gen-1', ...record };
                  insertedGroups.push(created);
                  return { data: created, error: null };
                },
              }),
            }),
          };
        }

        if (table === 'group_members') {
          return {
            select: () => ({
              eq: (_col: string, _projId: string) => ({
                in: (_col2: string, ids: string[]) => ({
                  neq: (_col3: string, _status: string) => {
                    const match = (dbState.existingMemberships || []).filter((m) =>
                      ids.includes(m.student_id)
                    );
                    return Promise.resolve({ data: match, error: null });
                  },
                }),
              }),
            }),
            insert: (records: any[]) => {
              insertedMembers.push(...records);
              return Promise.resolve({ error: null });
            },
          };
        }

        if (table === 'audit_logs') {
          return {
            insert: (log: any) => {
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
      sectionId: 'sec-3b',
      projectId: 'proj-algo-term',
      groupCode: 'Group 01',
      leaderStudentId: 'stud-1',
      memberStudentIds: ['stud-1', 'stud-2', 'stud-3'],
    };

    const result = await executeCreateProjectGroup(mockDb, mockRepContext, input);

    assert.equal(result.success, true);
    assert.equal(result.groupId, 'group-gen-1');

    // Verify group record
    assert.equal(mockDb._state.insertedGroups.length, 1);
    const group = mockDb._state.insertedGroups[0];
    assert.equal(group.group_code, 'Group 01');
    assert.equal(group.section_id, 'sec-3b');
    assert.equal(group.group_leader_id, 'stud-1');
    assert.equal(group.status, 'pending'); // Strictly 'pending' until members confirm

    // Verify member records
    assert.equal(mockDb._state.insertedMembers.length, 3);
    const leaderMember = mockDb._state.insertedMembers.find((m: any) => m.student_id === 'stud-1');
    assert.ok(leaderMember);
    assert.equal(leaderMember.is_group_leader, true);
    assert.equal(leaderMember.confirmation_status, 'pending');

    const regularMember = mockDb._state.insertedMembers.find((m: any) => m.student_id === 'stud-2');
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
      sectionId: 'sec-unassigned',
      projectId: 'proj-algo-term',
      groupCode: 'Group 01',
      leaderStudentId: 'stud-1',
      memberStudentIds: ['stud-1', 'stud-2'],
    };

    const result = await executeCreateProjectGroup(mockDb, mockRepContext, input);

    assert.equal(result.success, false);
    assert.match(result.error || '', /Forbidden: Access denied for section sec-unassigned/);
    assert.equal(mockDb._state.insertedGroups.length, 0);
  });

  it('should reject pre-creation if project is configured for individual submission only', async () => {
    const indivProject = {
      ...sampleProject,
      submission_type: 'individual',
    };
    const mockDb = createMockSupabase({ project: indivProject });

    const input: CreateProjectGroupInput = {
      sectionId: 'sec-3b',
      projectId: 'proj-algo-term',
      groupCode: 'Group 01',
      leaderStudentId: 'stud-1',
      memberStudentIds: ['stud-1', 'stud-2'],
    };

    const result = await executeCreateProjectGroup(mockDb, mockRepContext, input);

    assert.equal(result.success, false);
    assert.match(result.error || '', /This project does not accept group submissions/);
  });

  it('should reject pre-creation if group size violates min/max bounds', async () => {
    const mockDb = createMockSupabase({ project: sampleProject });

    // Under minimum (1 student, min is 2)
    const underInput: CreateProjectGroupInput = {
      sectionId: 'sec-3b',
      projectId: 'proj-algo-term',
      groupCode: 'Group 01',
      leaderStudentId: 'stud-1',
      memberStudentIds: ['stud-1'],
    };
    const underResult = await executeCreateProjectGroup(mockDb, mockRepContext, underInput);
    assert.equal(underResult.success, false);
    assert.match(underResult.error || '', /Group size violation: Must assign between 2 and 4 members/);

    // Over maximum (5 students, max is 4)
    const overInput: CreateProjectGroupInput = {
      sectionId: 'sec-3b',
      projectId: 'proj-algo-term',
      groupCode: 'Group 01',
      leaderStudentId: 'stud-1',
      memberStudentIds: ['stud-1', 'stud-2', 'stud-3', 'stud-4', 'stud-5'],
    };
    const overResult = await executeCreateProjectGroup(mockDb, mockRepContext, overInput);
    assert.equal(overResult.success, false);
    assert.match(overResult.error || '', /Group size violation: Must assign between 2 and 4 members/);
  });

  it('should reject pre-creation if designated leader is not in members list', async () => {
    const mockDb = createMockSupabase({ project: sampleProject });

    const input: CreateProjectGroupInput = {
      sectionId: 'sec-3b',
      projectId: 'proj-algo-term',
      groupCode: 'Group 01',
      leaderStudentId: 'stud-ghost',
      memberStudentIds: ['stud-1', 'stud-2'],
    };

    const result = await executeCreateProjectGroup(mockDb, mockRepContext, input);

    assert.equal(result.success, false);
    assert.match(result.error || '', /The designated group leader must be included in the assigned members list/);
  });

  it('should reject duplicate group code within the same project and section', async () => {
    const existingGroups = [
      { id: 'grp-dup', project_id: 'proj-algo-term', section_id: 'sec-3b', group_code: 'Group 01' },
    ];
    const mockDb = createMockSupabase({ project: sampleProject, existingGroups });

    const input: CreateProjectGroupInput = {
      sectionId: 'sec-3b',
      projectId: 'proj-algo-term',
      groupCode: 'Group 01',
      leaderStudentId: 'stud-1',
      memberStudentIds: ['stud-1', 'stud-2'],
    };

    const result = await executeCreateProjectGroup(mockDb, mockRepContext, input);

    assert.equal(result.success, false);
    assert.match(result.error || '', /Group "Group 01" already exists for this project in your section/);
  });

  it('should reject cross-section student assignment', async () => {
    const mockDb = createMockSupabase({ project: sampleProject, students: enrolledStudents });

    const input: CreateProjectGroupInput = {
      sectionId: 'sec-3b',
      projectId: 'proj-algo-term',
      groupCode: 'Group 02',
      leaderStudentId: 'stud-1',
      memberStudentIds: ['stud-1', 'stud-outside'], // stud-outside belongs to sec-3a
    };

    const result = await executeCreateProjectGroup(mockDb, mockRepContext, input);

    assert.equal(result.success, false);
    assert.match(result.error || '', /Cross-section violation: Student "Outside Section Student" is not enrolled in this section/);
  });

  it('should reject assigning a suspended student', async () => {
    const mockDb = createMockSupabase({ project: sampleProject, students: enrolledStudents });

    const input: CreateProjectGroupInput = {
      sectionId: 'sec-3b',
      projectId: 'proj-algo-term',
      groupCode: 'Group 02',
      leaderStudentId: 'stud-1',
      memberStudentIds: ['stud-1', 'stud-suspended'],
    };

    const result = await executeCreateProjectGroup(mockDb, mockRepContext, input);

    assert.equal(result.success, false);
    assert.match(result.error || '', /Suspended student violation: Student "Suspended Student" is currently suspended/);
  });

  it('should reject assigning a student who is already in another group for this project', async () => {
    const existingMemberships = [
      { student_id: 'stud-2', group: { project_id: 'proj-algo-term', group_code: 'Group 01' } },
    ];
    const mockDb = createMockSupabase({
      project: sampleProject,
      students: enrolledStudents,
      existingMemberships,
    });

    const input: CreateProjectGroupInput = {
      sectionId: 'sec-3b',
      projectId: 'proj-algo-term',
      groupCode: 'Group 02',
      leaderStudentId: 'stud-1',
      memberStudentIds: ['stud-1', 'stud-2'], // stud-2 already in Group 01
    };

    const result = await executeCreateProjectGroup(mockDb, mockRepContext, input);

    assert.equal(result.success, false);
    assert.match(result.error || '', /is already assigned to another group for this project/);
  });
});
