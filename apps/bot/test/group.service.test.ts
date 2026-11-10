// HU-ASMS: Phase 08 Group Management & Membership Verification Unit Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GroupManagementService,
  GroupManagementError,
} from '../src/services/group.service.js';

describe('Phase 08 — Group Management & Membership Verification Unit Tests', () => {

  const mockStudents = [
    {
      id: 'stud-1',
      hu_student_id: 'HU/10294/14',
      full_name: 'Student One',
      academic_year_id: 'year-3',
      section_id: 'sec-3b',
      telegram_user_id: 11111111,
      registration_status: 'locked',
    },
    {
      id: 'stud-2',
      hu_student_id: 'HU/10295/14',
      full_name: 'Student Two',
      academic_year_id: 'year-3',
      section_id: 'sec-3b',
      telegram_user_id: 22222222,
      registration_status: 'locked',
    },
    {
      id: 'stud-3',
      hu_student_id: 'HU/10296/14',
      full_name: 'Student Three',
      academic_year_id: 'year-3',
      section_id: 'sec-3b',
      telegram_user_id: 33333333,
      registration_status: 'locked',
    },
    {
      id: 'stud-cross-sec',
      hu_student_id: 'HU/10297/14',
      full_name: 'Cross Section Student',
      academic_year_id: 'year-3',
      section_id: 'sec-3a', // Different section!
      telegram_user_id: 44444444,
      registration_status: 'locked',
    },
    {
      id: 'stud-unapproved',
      hu_student_id: 'HU/10298/14',
      full_name: 'Pending Student',
      academic_year_id: 'year-3',
      section_id: 'sec-3b',
      telegram_user_id: 55555555,
      registration_status: 'pending', // Not approved!
    },
  ];

  const mockProjects: Record<string, any> = {
    'proj-se': {
      id: 'proj-se',
      title: 'Software Engineering Architecture Term Project',
      submission_type: 'group',
      targets: [{ academic_year_id: 'year-3', section_id: 'sec-3b' }],
      file_rules: {
        min_group_size: 2,
        max_group_size: 4,
      },
    },
    'proj-networks': {
      id: 'proj-networks',
      title: 'Computer Networks Socket Lab',
      submission_type: 'group',
      targets: [{ academic_year_id: 'year-3', section_id: 'sec-3b' }],
      file_rules: {
        min_group_size: 2,
        max_group_size: 3,
      },
    },
    'proj-term-paper': {
      id: 'proj-term-paper',
      title: 'Term Research Paper',
      submission_type: 'group',
      targets: [{ academic_year_id: 'year-3', section_id: 'sec-3b' }],
      file_rules: {
        min_group_size: 2,
        max_group_size: 3,
      },
    },
    'proj-individual-only': {
      id: 'proj-individual-only',
      title: 'Individual Research Paper',
      submission_type: 'individual',
      targets: [{ academic_year_id: 'year-3', section_id: 'sec-3b' }],
    },
  };

  const mockGroups: any[] = [];
  const mockGroupMembers: any[] = [];

  function createMockSupabaseClient() {
    return {
      from: (table: string) => {
        if (table === 'projects') {
          return {
            select: () => ({
              eq: (_col: string, val: unknown) => ({
                maybeSingle: async () => {
                  const match = mockProjects[val as string];
                  return { data: match || null, error: null };
                },
              }),
            }),
          };
        }

        if (table === 'students') {
          return {
            select: () => ({
              eq: (col: string, val: unknown) => ({
                maybeSingle: async () => {
                  if (col === 'hu_student_id') {
                    const match = mockStudents.find((s) => s.hu_student_id === val);
                    return { data: match || null, error: null };
                  }
                  if (col === 'telegram_user_id') {
                    const match = mockStudents.find((s) => s.telegram_user_id === val);
                    return { data: match || null, error: null };
                  }
                  return { data: null, error: null };
                },
              }),
            }),
          };
        }

        if (table === 'groups') {
          return {
            select: () => ({
              eq: (_col1: string, projId: unknown) => ({
                eq: (_col2: string, secId: unknown) => ({
                  eq: (_col3: string, groupCode: unknown) => ({
                    maybeSingle: async () => {
                      const match = mockGroups.find(
                        (g) =>
                          g.project_id === projId &&
                          g.section_id === secId &&
                          g.group_code === groupCode
                      );
                      return { data: match || null, error: null };
                    },
                  }),
                }),
              }),
            }),
            insert: (groupData: any) => {
              const newGrp = {
                id: `grp-${mockGroups.length + 1}`,
                ...groupData,
                created_at: new Date().toISOString(),
                project: mockProjects[groupData.project_id],
              };
              mockGroups.push(newGrp);
              return {
                select: () => ({
                  single: async () => ({ data: newGrp, error: null }),
                }),
              };
            },
            update: (updates: any) => ({
              eq: (_col: string, groupId: string) => {
                const grp = mockGroups.find((g) => g.id === groupId);
                if (grp) Object.assign(grp, updates);
                return Promise.resolve({ data: grp, error: null });
              },
            }),
          };
        }

        if (table === 'group_members') {
          const createMemberQuery = (filters: Array<{ col: string; val: unknown; op: 'eq' | 'neq' }> = []) => ({
            eq(col: string, val: unknown) {
              return createMemberQuery([...filters, { col, val, op: 'eq' }]);
            },
            neq(col: string, val: unknown) {
              return createMemberQuery([...filters, { col, val, op: 'neq' }]);
            },
            maybeSingle: async () => {
              const matches = mockGroupMembers.filter((m) =>
                filters.every((f) => {
                  if (f.col === 'group.project_id') {
                    const grp = mockGroups.find((g) => g.id === m.group_id);
                    return f.op === 'eq' ? grp?.project_id === f.val : grp?.project_id !== f.val;
                  }
                  return f.op === 'eq' ? (m as any)[f.col] === f.val : (m as any)[f.col] !== f.val;
                })
              );
              return { data: matches[0] || null, error: null };
            },
            then(resolve: any) {
              const matches = mockGroupMembers.filter((m) =>
                filters.every((f) =>
                  f.op === 'eq' ? (m as any)[f.col] === f.val : (m as any)[f.col] !== f.val
                )
              );
              return Promise.resolve({ data: matches, error: null }).then(resolve);
            },
          });

          return {
            select: () => createMemberQuery(),
            insert: (memberData: any[]) => {
              const newMembers = memberData.map((m, idx) => ({
                id: `mem-${mockGroupMembers.length + idx + 1}`,
                ...m,
                student: mockStudents.find((s) => s.id === m.student_id),
              }));
              mockGroupMembers.push(...newMembers);
              return {
                select: () => Promise.resolve({ data: newMembers, error: null }),
              };
            },
            update: (updates: any) => ({
              eq: (_col: string, memId: string) => {
                const mem = mockGroupMembers.find((m) => m.id === memId);
                if (mem) Object.assign(mem, updates);
                return {
                  select: () => ({
                    single: async () => ({ data: mem, error: null }),
                  }),
                };
              },
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    } as any;
  }

  describe('1. Pre-Created Groups & Scope Integrity', () => {
    it('should create a valid group with leader and pending members', async () => {
      const service = new GroupManagementService(createMockSupabaseClient());

      const group = await service.createGroup({
        projectId: 'proj-se',
        sectionId: 'sec-3b',
        groupCode: 'Group 01',
        groupLeaderHuId: 'HU/10294/14',
        memberHuStudentIds: ['HU/10294/14', 'HU/10295/14'],
      });

      assert.ok(group.id);
      assert.equal(group.group_code, 'Group 01');
      assert.equal(group.status, 'pending', 'Initial status must be pending');
      assert.equal(group.members.length, 2);

      // Verify leader designation
      const leader = group.members.find((m) => m.is_group_leader);
      assert.ok(leader);
      assert.equal(leader.student?.hu_student_id, 'HU/10294/14');
      assert.equal(leader.confirmation_status, 'pending');
    });

    it('should allow the SAME group code in a DIFFERENT project', async () => {
      const service = new GroupManagementService(createMockSupabaseClient());

      // Same code "Group 01" in "proj-networks"
      const groupInOtherProject = await service.createGroup({
        projectId: 'proj-networks',
        sectionId: 'sec-3b',
        groupCode: 'Group 01',
        memberHuStudentIds: ['HU/10294/14', 'HU/10296/14'],
      });

      assert.ok(groupInOtherProject.id);
      assert.equal(groupInOtherProject.group_code, 'Group 01');
      assert.equal(groupInOtherProject.project_id, 'proj-networks');
    });

    it('should reject duplicate group code within the same project and section', async () => {
      const service = new GroupManagementService(createMockSupabaseClient());

      await assert.rejects(
        async () => {
          await service.createGroup({
            projectId: 'proj-se',
            sectionId: 'sec-3b',
            groupCode: 'Group 01', // Already exists in proj-se
            memberHuStudentIds: ['HU/10295/14', 'HU/10296/14'],
          });
        },
        (err: any) => {
          assert.equal(err.code, 'DUPLICATE_GROUP_CODE');
          return true;
        }
      );
    });

    it('should reject group creation for individual-only project', async () => {
      const service = new GroupManagementService(createMockSupabaseClient());

      await assert.rejects(
        async () => {
          await service.createGroup({
            projectId: 'proj-individual-only',
            sectionId: 'sec-3b',
            groupCode: 'Group 01',
            memberHuStudentIds: ['HU/10294/14', 'HU/10295/14'],
          });
        },
        (err: any) => {
          assert.equal(err.code, 'INVALID_PROJECT_TYPE');
          return true;
        }
      );
    });

    it('should reject cross-section membership assignment', async () => {
      const service = new GroupManagementService(createMockSupabaseClient());

      // Student HU/10297/14 belongs to Section 3A, attempting to assign to Section 3B group
      await assert.rejects(
        async () => {
          await service.createGroup({
            projectId: 'proj-se',
            sectionId: 'sec-3b',
            groupCode: 'Group 02',
            memberHuStudentIds: ['HU/10294/14', 'HU/10297/14'],
          });
        },
        (err: any) => {
          assert.equal(err.code, 'CROSS_SECTION_FORBIDDEN');
          return true;
        }
      );
    });

    it('should reject unapproved or unregistered student assignments', async () => {
      const service = new GroupManagementService(createMockSupabaseClient());

      await assert.rejects(
        async () => {
          await service.createGroup({
            projectId: 'proj-se',
            sectionId: 'sec-3b',
            groupCode: 'Group 03',
            memberHuStudentIds: ['HU/10294/14', 'HU/10298/14'], // Unapproved student
          });
        },
        (err: any) => {
          assert.equal(err.code, 'STUDENT_NOT_APPROVED');
          return true;
        }
      );
    });

    it('should enforce group capacity bounds (min & max)', async () => {
      const service = new GroupManagementService(createMockSupabaseClient());

      // Min size is 2; 1 student provided
      await assert.rejects(
        async () => {
          await service.createGroup({
            projectId: 'proj-se',
            sectionId: 'sec-3b',
            groupCode: 'Group 04',
            memberHuStudentIds: ['HU/10294/14'],
          });
        },
        (err: any) => {
          assert.equal(err.code, 'GROUP_TOO_SMALL');
          return true;
        }
      );
    });
  });

  describe('2. Independent Membership Confirmation Lifecycle', () => {
    it('should allow student to independently confirm their own membership', async () => {
      const service = new GroupManagementService(createMockSupabaseClient());

      // Student One (11111111) confirms membership in grp-1
      const result = await service.confirmMembership(11111111, 'grp-1', 'confirmed');

      assert.equal(result.membership.confirmation_status, 'confirmed');
      assert.ok(result.membership.confirmed_at);
      // Group is NOT fully verified yet because Student Two (22222222) is still pending!
      assert.equal(result.groupStatus, 'pending');
      assert.equal(result.isGroupVerified, false);
    });

    it('should prevent an unassigned student from confirming membership', async () => {
      const service = new GroupManagementService(createMockSupabaseClient());

      // Student Three (33333333) is not in grp-1
      await assert.rejects(
        async () => {
          await service.confirmMembership(33333333, 'grp-1', 'confirmed');
        },
        (err: any) => {
          assert.equal(err.code, 'NOT_GROUP_MEMBER');
          return true;
        }
      );
    });

    it('should automatically verify group when all members confirm', async () => {
      const service = new GroupManagementService(createMockSupabaseClient());

      // Student Two (22222222) confirms membership in grp-1
      const result = await service.confirmMembership(22222222, 'grp-1', 'confirmed');

      assert.equal(result.membership.confirmation_status, 'confirmed');
      // Both Student One and Student Two confirmed -> Group status must become 'verified'!
      assert.equal(result.groupStatus, 'verified');
      assert.equal(result.isGroupVerified, true);

      // Verify group in mock storage
      const grp = mockGroups.find((g) => g.id === 'grp-1');
      assert.equal(grp.status, 'verified');
    });

    it('should keep group status pending if any member declines membership', async () => {
      const service = new GroupManagementService(createMockSupabaseClient());

      // Create Group 05 with Student One and Student Three in proj-term-paper
      await service.createGroup({
        projectId: 'proj-term-paper',
        sectionId: 'sec-3b',
        groupCode: 'Group 05',
        memberHuStudentIds: ['HU/10294/14', 'HU/10296/14'],
      });

      const grp5 = mockGroups.find((g) => g.group_code === 'Group 05');

      // Student One confirms
      await service.confirmMembership(11111111, grp5.id, 'confirmed');

      // Student Three declines
      const declineResult = await service.confirmMembership(
        33333333,
        grp5.id,
        'declined',
        'I am not in this group'
      );

      assert.equal(declineResult.membership.confirmation_status, 'declined');
      assert.equal(declineResult.groupStatus, 'pending');
      assert.equal(declineResult.isGroupVerified, false);
      assert.equal(grp5.status, 'pending');
    });
  });

});
