// HU-ASMS: Phase 12 Teacher Delivery Service Unit Tests
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  executePrepareDeliveryBatch,
  executeDispatchDelivery,
  executeAcknowledgeDelivery,
  executeGetDeliveryPackageManifest,
  type PrepareDeliveryInput,
} from '../src/lib/rep/delivery-service.js';
import type { UserSessionContext } from '../src/lib/auth/roles.js';
import { globalWebRateLimiter } from '../src/lib/security/rate-limiter.js';

const REP_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const YEAR_3_UUID = '10000000-0000-4000-8000-000000000003';
const SEC_3B_UUID = '11111111-1111-4111-8111-11111111113b';
const SEC_4A_UUID = '11111111-1111-4111-8111-11111111114a';
const SEC_3A_UUID = '11111111-1111-4111-8111-11111111113a';
const SEC_5A_UUID = '11111111-1111-4111-8111-11111111115a';
const SEC_1A_UUID = '11111111-1111-4111-8111-11111111111a';
const PROJ_OS_UUID = '22222222-2222-4222-8222-222222222221';
const COURSE_OS_UUID = '33333333-3333-4333-8333-333333333331';
const TEACHER_KEBEDE_UUID = '44444444-4444-4444-8444-444444444441';
const TEACHER_OTHER_UUID = '44444444-4444-4444-8444-444444444442';
const STUD_1_UUID = '55555555-5555-4555-8555-555555555551';
const STUD_2_UUID = '55555555-5555-4555-8555-555555555552';
const SUB_1_UUID = '66666666-6666-4666-8666-666666666661';
const SUB_2_UUID = '66666666-6666-4666-8666-666666666662';
const SUB_FOREIGN_UUID = '66666666-6666-4666-8666-666666666663';
const DELIV_GEN_UUID = '77777777-7777-4777-8777-777777777701';
const DELIV_101_UUID = '77777777-7777-4777-8777-777777777101';
const DELIV_999_UUID = '77777777-7777-4777-8777-777777777999';
const DELIV_PKG_UUID = '77777777-7777-4777-8777-777777777002';
const DELIV_OUT_UUID = '77777777-7777-4777-8777-777777777003';

describe('Phase 12 — Teacher Delivery Service Unit Tests', () => {
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
    id: PROJ_OS_UUID,
    course_id: COURSE_OS_UUID,
    teacher_id: TEACHER_KEBEDE_UUID,
    title: 'Operating Systems Kernel Module Lab',
    is_active: true,
    submission_type: 'individual',
    targets: [{ academic_year_id: YEAR_3_UUID, section_id: SEC_3B_UUID }],
  };

  const sampleSubmissions = [
    {
      id: SUB_1_UUID,
      section_id: SEC_3B_UUID,
      project_id: PROJ_OS_UUID,
      student_id: STUD_1_UUID,
      status: 'active',
    },
    {
      id: SUB_2_UUID,
      section_id: SEC_3B_UUID,
      project_id: PROJ_OS_UUID,
      student_id: STUD_2_UUID,
      status: 'active',
    },
  ];

  function createMockSupabase(dbState: {
    sections?: any[];
    project?: any;
    teachers?: any[];
    submissions?: any[];
    delivery?: any;
    auditLogs?: any[];
    storageSignedUrls?: Record<string, string>;
    deliveryItemsError?: string;
    auditError?: string;
    zeroRowUpdate?: boolean;
    onQuery?: (table: string) => void;
  }) {
    const insertedDeliveries: any[] = [];
    const insertedDeliveryItems: any[] = [];
    const updatedDeliveries: any[] = [];
    const deletedDeliveries: string[] = [];
    const insertedAuditLogs: any[] = dbState.auditLogs || [];
    const defaultSections = [
      { id: SEC_3B_UUID, academic_year_id: YEAR_3_UUID },
      { id: SEC_4A_UUID, academic_year_id: YEAR_3_UUID },
    ];
    const defaultTeachers = [{ id: TEACHER_KEBEDE_UUID, is_active: true }];

    const mockClient = {
      from: (table: string) => {
        dbState.onQuery?.(table);

        if (table === 'sections') {
          return {
            select: () => ({
              eq: (_col: string, val: string) => ({
                single: async () => {
                  const found = (dbState.sections ?? defaultSections).find((s) => s.id === val);
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
              eq: (_col: string, val: string) => ({
                single: async () => {
                  if (dbState.project && dbState.project.id === val) {
                    return { data: dbState.project, error: null };
                  }
                  return { data: null, error: new Error('Project not found') };
                },
              }),
            }),
          };
        }

        if (table === 'teachers') {
          return {
            select: () => ({
              eq: (_col: string, val: string) => ({
                single: async () => {
                  const found = (dbState.teachers ?? defaultTeachers).find((t) => t.id === val);
                  return found
                    ? { data: found, error: null }
                    : { data: null, error: new Error('Teacher not found') };
                },
              }),
            }),
          };
        }

        if (table === 'submissions') {
          return {
            select: () => ({
              in: (_col: string, ids: string[]) => {
                const subs = (dbState.submissions || []).filter((s) => ids.includes(s.id));
                return Promise.resolve({ data: subs, error: null });
              },
            }),
          };
        }

        if (table === 'deliveries') {
          return {
            insert: (record: any) => ({
              select: () => ({
                single: async () => {
                  const created = { id: DELIV_GEN_UUID, ...record };
                  insertedDeliveries.push(created);
                  return { data: created, error: null };
                },
              }),
            }),
            select: () => ({
              eq: (_col: string, id: string) => ({
                single: async () => {
                  if (dbState.delivery && dbState.delivery.id === id) {
                    return { data: dbState.delivery, error: null };
                  }
                  return { data: null, error: new Error('Delivery not found') };
                },
              }),
            }),
            update: (updateFields: any) => ({
              eq: (_col1: string, id: string) => ({
                eq: (_col2: string, expectedStatus: string) => ({
                  select: async () => {
                    if (
                      dbState.zeroRowUpdate ||
                      !dbState.delivery ||
                      dbState.delivery.id !== id ||
                      dbState.delivery.status !== expectedStatus
                    ) {
                      return { data: [], error: null };
                    }
                    dbState.delivery.status = updateFields.status;
                    updatedDeliveries.push({ id, expectedStatus, ...updateFields });
                    return { data: [{ id }], error: null };
                  },
                }),
              }),
            }),
            delete: () => ({
              eq: async (_col: string, id: string) => {
                deletedDeliveries.push(id);
                return { error: null };
              },
            }),
          };
        }

        if (table === 'delivery_items') {
          return {
            insert: (items: any[]) => {
              if (dbState.deliveryItemsError) {
                return Promise.resolve({ error: { message: dbState.deliveryItemsError } });
              }
              insertedDeliveryItems.push(...items);
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
      storage: {
        from: (bucket: string) => ({
          createSignedUrl: async (storagePath: string, expiresIn: number) => {
            const url = `https://mock-storage.hu.edu.et/${bucket}/${storagePath}?expires_in=${expiresIn}&token=valid_15m`;
            return { data: { signedUrl: url }, error: null };
          },
        }),
      },
      _state: {
        insertedDeliveries,
        insertedDeliveryItems,
        updatedDeliveries,
        deletedDeliveries,
        insertedAuditLogs,
      },
    };

    return mockClient as any;
  }

  describe('1. Delivery Batch Preparation & Scope Authorization', () => {
    it('should successfully prepare a delivery batch with submissions from assigned section', async () => {
      const mockDb = createMockSupabase({
        project: sampleProject,
        submissions: sampleSubmissions,
      });

      const input: PrepareDeliveryInput = {
        sectionId: SEC_3B_UUID,
        projectId: PROJ_OS_UUID,
        teacherId: TEACHER_KEBEDE_UUID,
        channel: 'telegram',
        deliveryNotes: 'Section 3B assignment submissions for grading',
        submissionIds: [SUB_1_UUID, SUB_2_UUID],
      };

      const result = await executePrepareDeliveryBatch(mockDb, mockRepContext, input);

      assert.equal(result.success, true);
      assert.equal(result.deliveryId, DELIV_GEN_UUID);

      // Verify delivery master record
      assert.equal(mockDb._state.insertedDeliveries.length, 1);
      const delivery = mockDb._state.insertedDeliveries[0];
      assert.equal(delivery.project_id, PROJ_OS_UUID);
      assert.equal(delivery.section_id, SEC_3B_UUID);
      assert.equal(delivery.course_id, COURSE_OS_UUID);
      assert.equal(delivery.teacher_id, TEACHER_KEBEDE_UUID);
      assert.equal(delivery.batch_count, 2);
      assert.equal(delivery.status, 'prepared');
      assert.equal(delivery.channel, 'telegram');

      // Verify delivery items attached
      assert.equal(mockDb._state.insertedDeliveryItems.length, 2);
      assert.equal(mockDb._state.insertedDeliveryItems[0].submission_id, SUB_1_UUID);
      assert.equal(mockDb._state.insertedDeliveryItems[1].submission_id, SUB_2_UUID);

      // Verify audit log
      assert.equal(mockDb._state.insertedAuditLogs.length, 1);
      assert.equal(mockDb._state.insertedAuditLogs[0].action, 'TEACHER_DELIVERY_PREPARED');
      assert.equal(mockDb._state.insertedAuditLogs[0].actor_role, 'representative');
    });

    it('should reject batch preparation if representative attempts to prepare for an unassigned section', async () => {
      const mockDb = createMockSupabase({
        project: sampleProject,
        submissions: sampleSubmissions,
      });

      const input: PrepareDeliveryInput = {
        sectionId: SEC_4A_UUID, // Unassigned section
        projectId: PROJ_OS_UUID,
        teacherId: TEACHER_KEBEDE_UUID,
        channel: 'email',
        submissionIds: [SUB_1_UUID],
      };

      const result = await executePrepareDeliveryBatch(mockDb, mockRepContext, input);

      assert.equal(result.success, false);
      assert.match(result.error || '', new RegExp(`Forbidden: Access denied for section ${SEC_4A_UUID}`));
      assert.equal(mockDb._state.insertedDeliveries.length, 0);
    });

    it('should reject batch preparation if any submission belongs to a different section', async () => {
      const foreignSubmissions = [
        { id: SUB_1_UUID, section_id: SEC_3B_UUID, project_id: PROJ_OS_UUID, status: 'active' },
        { id: SUB_FOREIGN_UUID, section_id: SEC_3A_UUID, project_id: PROJ_OS_UUID, status: 'active' }, // Cross-section leak!
      ];

      const mockDb = createMockSupabase({
        project: sampleProject,
        submissions: foreignSubmissions,
      });

      const input: PrepareDeliveryInput = {
        sectionId: SEC_3B_UUID,
        projectId: PROJ_OS_UUID,
        teacherId: TEACHER_KEBEDE_UUID,
        channel: 'telegram',
        submissionIds: [SUB_1_UUID, SUB_FOREIGN_UUID],
      };

      const result = await executePrepareDeliveryBatch(mockDb, mockRepContext, input);

      assert.equal(result.success, false);
      assert.match(result.error || '', /Security Violation: Cannot attach submissions outside your assigned section/);
      assert.equal(mockDb._state.insertedDeliveries.length, 0);
    });

    it('should reject batch preparation if submission list is empty', async () => {
      const mockDb = createMockSupabase({
        project: sampleProject,
        submissions: sampleSubmissions,
      });

      const input: PrepareDeliveryInput = {
        sectionId: SEC_3B_UUID,
        projectId: PROJ_OS_UUID,
        teacherId: TEACHER_KEBEDE_UUID,
        channel: 'telegram',
        submissionIds: [],
      };

      const result = await executePrepareDeliveryBatch(mockDb, mockRepContext, input);

      assert.equal(result.success, false);
      assert.match(result.error || '', /At least one submission must be selected/);
    });

    it('should reject malformed UUIDs before DB query, duplicate submissionIds, inactive/non-active submissions, untargeted/inactive projects, and mismatched or inactive teachers', async () => {
      let queryCount = 0;
      const spyDb = createMockSupabase({
        project: sampleProject,
        submissions: sampleSubmissions,
        onQuery: () => {
          queryCount += 1;
        },
      });

      // 1. Service-layer UUID validation before any DB queries
      const badUuidPrep = await executePrepareDeliveryBatch(spyDb, mockRepContext, {
        sectionId: 'bad-section-id',
        projectId: PROJ_OS_UUID,
        teacherId: TEACHER_KEBEDE_UUID,
        channel: 'telegram',
        submissionIds: [SUB_1_UUID],
      });
      assert.equal(badUuidPrep.success, false);
      assert.match(badUuidPrep.error ?? '', /Invalid section identifier/);

      const badDispatchUuid = await executeDispatchDelivery(spyDb, mockRepContext, 'bad-deliv-id');
      assert.equal(badDispatchUuid.success, false);
      assert.equal(badDispatchUuid.error, 'Invalid delivery identifier.');

      const badAckUuid = await executeAcknowledgeDelivery(spyDb, mockRepContext, 'bad-deliv-id');
      assert.equal(badAckUuid.success, false);
      assert.equal(badAckUuid.error, 'Invalid delivery identifier.');
      assert.equal(queryCount, 0);

      // 2. Duplicate submission IDs
      const dupSubsRes = await executePrepareDeliveryBatch(
        createMockSupabase({ project: sampleProject, submissions: sampleSubmissions }),
        mockRepContext,
        {
          sectionId: SEC_3B_UUID,
          projectId: PROJ_OS_UUID,
          teacherId: TEACHER_KEBEDE_UUID,
          channel: 'telegram',
          submissionIds: [SUB_1_UUID, SUB_1_UUID],
        }
      );
      assert.equal(dupSubsRes.success, false);
      assert.match(dupSubsRes.error ?? '', /Duplicate submission identifiers/);

      // 3. Inactive project
      const inactiveProjRes = await executePrepareDeliveryBatch(
        createMockSupabase({
          project: { ...sampleProject, is_active: false },
          submissions: sampleSubmissions,
        }),
        mockRepContext,
        {
          sectionId: SEC_3B_UUID,
          projectId: PROJ_OS_UUID,
          teacherId: TEACHER_KEBEDE_UUID,
          channel: 'telegram',
          submissionIds: [SUB_1_UUID],
        }
      );
      assert.equal(inactiveProjRes.success, false);
      assert.match(inactiveProjRes.error ?? '', /inactive project/);

      // 4. Untargeted project for section/academic year
      const untargetedProjRes = await executePrepareDeliveryBatch(
        createMockSupabase({
          project: { ...sampleProject, targets: [{ academic_year_id: YEAR_3_UUID, section_id: SEC_4A_UUID }] },
          submissions: sampleSubmissions,
        }),
        mockRepContext,
        {
          sectionId: SEC_3B_UUID,
          projectId: PROJ_OS_UUID,
          teacherId: TEACHER_KEBEDE_UUID,
          channel: 'telegram',
          submissionIds: [SUB_1_UUID],
        }
      );
      assert.equal(untargetedProjRes.success, false);
      assert.match(untargetedProjRes.error ?? '', /not targeted to the specified section/);

      // 5. Mismatched teacher vs project.teacher_id
      const wrongTeacherRes = await executePrepareDeliveryBatch(
        createMockSupabase({ project: sampleProject, submissions: sampleSubmissions }),
        mockRepContext,
        {
          sectionId: SEC_3B_UUID,
          projectId: PROJ_OS_UUID,
          teacherId: TEACHER_OTHER_UUID,
          channel: 'telegram',
          submissionIds: [SUB_1_UUID],
        }
      );
      assert.equal(wrongTeacherRes.success, false);
      assert.match(wrongTeacherRes.error ?? '', /not assigned to this academic project/);

      // 6. Inactive teacher record
      const inactiveTeacherRes = await executePrepareDeliveryBatch(
        createMockSupabase({
          project: sampleProject,
          teachers: [{ id: TEACHER_KEBEDE_UUID, is_active: false }],
          submissions: sampleSubmissions,
        }),
        mockRepContext,
        {
          sectionId: SEC_3B_UUID,
          projectId: PROJ_OS_UUID,
          teacherId: TEACHER_KEBEDE_UUID,
          channel: 'telegram',
          submissionIds: [SUB_1_UUID],
        }
      );
      assert.equal(inactiveTeacherRes.success, false);
      assert.match(inactiveTeacherRes.error ?? '', /not found or inactive/i);

      // 7. Non-active submissions ('superseded' / 'delivered')
      const supersededRes = await executePrepareDeliveryBatch(
        createMockSupabase({
          project: sampleProject,
          submissions: [
            { ...sampleSubmissions[0], status: 'superseded' },
            sampleSubmissions[1],
          ],
        }),
        mockRepContext,
        {
          sectionId: SEC_3B_UUID,
          projectId: PROJ_OS_UUID,
          teacherId: TEACHER_KEBEDE_UUID,
          channel: 'telegram',
          submissionIds: [SUB_1_UUID, SUB_2_UUID],
        }
      );
      assert.equal(supersededRes.success, false);
      assert.match(supersededRes.error ?? '', /Only active submissions may be delivered/);
    });

    it('should compensate by deleting deliveries header if delivery_items insert or audit log fails', async () => {
      const itemsFailDb = createMockSupabase({
        project: sampleProject,
        submissions: sampleSubmissions,
        deliveryItemsError: 'foreign key failure on delivery_items',
      });
      const itemsFailRes = await executePrepareDeliveryBatch(itemsFailDb, mockRepContext, {
        sectionId: SEC_3B_UUID,
        projectId: PROJ_OS_UUID,
        teacherId: TEACHER_KEBEDE_UUID,
        channel: 'telegram',
        submissionIds: [SUB_1_UUID],
      });
      assert.equal(itemsFailRes.success, false);
      assert.match(itemsFailRes.error ?? '', /foreign key failure on delivery_items/);
      assert.deepEqual(itemsFailDb._state.deletedDeliveries, [DELIV_GEN_UUID]);

      const auditFailDb = createMockSupabase({
        project: sampleProject,
        submissions: sampleSubmissions,
        auditError: 'audit RPC unavailable',
      });
      const auditFailRes = await executePrepareDeliveryBatch(auditFailDb, mockRepContext, {
        sectionId: SEC_3B_UUID,
        projectId: PROJ_OS_UUID,
        teacherId: TEACHER_KEBEDE_UUID,
        channel: 'telegram',
        submissionIds: [SUB_1_UUID],
      });
      assert.equal(auditFailRes.success, false);
      assert.match(auditFailRes.error ?? '', /Audit log recording failed/);
      assert.deepEqual(auditFailDb._state.deletedDeliveries, [DELIV_GEN_UUID]);
    });
  });

  describe('2. Delivery Dispatch & Teacher Acknowledgment Lifecycle', () => {
    it('should transition status from prepared to sent on dispatch', async () => {
      const existingDelivery = {
        id: DELIV_101_UUID,
        section_id: SEC_3B_UUID,
        status: 'prepared',
      };

      const mockDb = createMockSupabase({
        delivery: existingDelivery,
      });

      const result = await executeDispatchDelivery(
        mockDb,
        mockRepContext,
        DELIV_101_UUID,
        'Forwarded via Telegram to Dr. Kebede'
      );

      assert.equal(result.success, true);
      assert.equal(mockDb._state.updatedDeliveries.length, 1);
      assert.equal(mockDb._state.updatedDeliveries[0].status, 'sent');
      assert.equal(mockDb._state.updatedDeliveries[0].delivery_notes, 'Forwarded via Telegram to Dr. Kebede');
      assert.ok(mockDb._state.updatedDeliveries[0].sent_at);

      // Verify audit log
      const audit = mockDb._state.insertedAuditLogs.find((l: any) => l.action === 'TEACHER_DELIVERY_DISPATCHED');
      assert.ok(audit);
      assert.equal(audit.entity_id, DELIV_101_UUID);
    });

    it('should transition status from sent to acknowledged on teacher confirmation', async () => {
      const existingDelivery = {
        id: DELIV_101_UUID,
        section_id: SEC_3B_UUID,
        status: 'sent',
      };

      const mockDb = createMockSupabase({
        delivery: existingDelivery,
      });

      const result = await executeAcknowledgeDelivery(mockDb, mockRepContext, DELIV_101_UUID);

      assert.equal(result.success, true);
      assert.equal(mockDb._state.updatedDeliveries.length, 1);
      assert.equal(mockDb._state.updatedDeliveries[0].status, 'acknowledged');
      assert.ok(mockDb._state.updatedDeliveries[0].acknowledged_at);

      // Verify audit log
      const audit = mockDb._state.insertedAuditLogs.find((l: any) => l.action === 'TEACHER_DELIVERY_ACKNOWLEDGED');
      assert.ok(audit);
      assert.equal(audit.entity_id, DELIV_101_UUID);
    });

    it('should enforce strict state machine transitions, detect 0-row concurrent updates, and revert status on audit failure', async () => {
      // Cannot dispatch an already sent delivery
      const alreadySentRes = await executeDispatchDelivery(
        createMockSupabase({ delivery: { id: DELIV_101_UUID, section_id: SEC_3B_UUID, status: 'sent' } }),
        mockRepContext,
        DELIV_101_UUID
      );
      assert.equal(alreadySentRes.success, false);
      assert.match(alreadySentRes.error ?? '', /Expected "prepared" before dispatch/);

      // Cannot acknowledge a prepared delivery
      const notYetSentRes = await executeAcknowledgeDelivery(
        createMockSupabase({ delivery: { id: DELIV_101_UUID, section_id: SEC_3B_UUID, status: 'prepared' } }),
        mockRepContext,
        DELIV_101_UUID
      );
      assert.equal(notYetSentRes.success, false);
      assert.match(notYetSentRes.error ?? '', /Expected "sent" before acknowledgment/);

      // 0-row concurrent dispatch
      const concurrentDispatchRes = await executeDispatchDelivery(
        createMockSupabase({
          delivery: { id: DELIV_101_UUID, section_id: SEC_3B_UUID, status: 'prepared' },
          zeroRowUpdate: true,
        }),
        mockRepContext,
        DELIV_101_UUID
      );
      assert.equal(concurrentDispatchRes.success, false);
      assert.match(concurrentDispatchRes.error ?? '', /no longer in "prepared" status/);

      // 0-row concurrent acknowledge
      const concurrentAckRes = await executeAcknowledgeDelivery(
        createMockSupabase({
          delivery: { id: DELIV_101_UUID, section_id: SEC_3B_UUID, status: 'sent' },
          zeroRowUpdate: true,
        }),
        mockRepContext,
        DELIV_101_UUID
      );
      assert.equal(concurrentAckRes.success, false);
      assert.match(concurrentAckRes.error ?? '', /no longer in "sent" status/);

      // Non-RPC fallback must NOT revert 'sent' -> 'prepared' when audit fails
      const dispatchTarget = { id: DELIV_101_UUID, section_id: SEC_3B_UUID, status: 'prepared', delivery_notes: 'Old' };
      const dispatchAuditFailDb = createMockSupabase({
        delivery: dispatchTarget,
        auditError: 'audit write failed',
      });
      const dispatchAuditFailRes = await executeDispatchDelivery(
        dispatchAuditFailDb,
        mockRepContext,
        DELIV_101_UUID,
        'New notes'
      );
      assert.equal(dispatchAuditFailRes.success, false);
      assert.match(dispatchAuditFailRes.error ?? '', /dispatch remains "sent"; audit reconciliation required/);
      assert.equal(dispatchAuditFailDb._state.updatedDeliveries.length, 1);
      assert.equal(dispatchAuditFailDb._state.updatedDeliveries[0].status, 'sent');
      assert.equal(dispatchTarget.status, 'sent');

      // Atomic mark_delivery_sent_with_audit RPC path: success & atomic failure (zero revert mutations)
      const rpcCalls: Array<{ fn: string; params: any }> = [];
      let rpcFallbackUpdateCalled = false;
      const rpcSuccessDb = {
        rpc: async (fn: string, params: any) => {
          rpcCalls.push({ fn, params });
          return {
            data: { delivery_id: params.p_delivery_id, status: 'sent', batch_count: 2 },
            error: null,
          };
        },
        from: (table: string) => {
          if (table === 'deliveries') {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data: { id: DELIV_101_UUID, section_id: SEC_3B_UUID, status: 'prepared', delivery_notes: 'Old' },
                    error: null,
                  }),
                }),
              }),
              update: () => {
                rpcFallbackUpdateCalled = true;
                throw new Error('RPC dispatch must not run fallback client updates');
              },
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const rpcDispatchSuccess = await executeDispatchDelivery(
        rpcSuccessDb,
        mockRepContext,
        DELIV_101_UUID,
        '  Delivered to instructor  '
      );
      assert.equal(rpcDispatchSuccess.success, true);
      assert.equal(rpcCalls.length, 1);
      assert.equal(rpcCalls[0].fn, 'mark_delivery_sent_with_audit');
      assert.deepEqual(rpcCalls[0].params, {
        p_delivery_id: DELIV_101_UUID,
        p_dispatch_notes: 'Delivered to instructor',
      });
      assert.equal(rpcFallbackUpdateCalled, false);

      const rpcFailDb = {
        rpc: async () => ({
          data: null,
          error: { message: 'Delivery integrity check failed: batch_count (2) does not match committed delivery_items count (1).' },
        }),
        from: (table: string) => {
          if (table === 'deliveries') {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data: { id: DELIV_101_UUID, section_id: SEC_3B_UUID, status: 'prepared' },
                    error: null,
                  }),
                }),
              }),
              update: () => {
                throw new Error('Failed RPC dispatch must not call client compensation update');
              },
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const rpcDispatchFail = await executeDispatchDelivery(rpcFailDb, mockRepContext, DELIV_101_UUID);
      assert.equal(rpcDispatchFail.success, false);
      assert.match(rpcDispatchFail.error ?? '', /Delivery integrity check failed/);

      // Revert status to sent when acknowledge audit fails
      const ackAuditFailDb = createMockSupabase({
        delivery: { id: DELIV_101_UUID, section_id: SEC_3B_UUID, status: 'sent', sent_at: '2026-11-10T10:00:00Z' },
        auditError: 'audit write failed',
      });
      const ackAuditFailRes = await executeAcknowledgeDelivery(
        ackAuditFailDb,
        mockRepContext,
        DELIV_101_UUID
      );
      assert.equal(ackAuditFailRes.success, false);
      assert.equal(ackAuditFailDb._state.updatedDeliveries.length, 2);
      assert.equal(ackAuditFailDb._state.updatedDeliveries[0].status, 'acknowledged');
      assert.equal(ackAuditFailDb._state.updatedDeliveries[1].status, 'sent');
    });

    it('should reject dispatch if delivery belongs to an unassigned section', async () => {
      const outsideDelivery = {
        id: DELIV_999_UUID,
        section_id: SEC_5A_UUID, // Unassigned section
        status: 'prepared',
      };

      const mockDb = createMockSupabase({
        delivery: outsideDelivery,
      });

      const result = await executeDispatchDelivery(mockDb, mockRepContext, DELIV_999_UUID);

      assert.equal(result.success, false);
      assert.match(result.error || '', new RegExp(`Forbidden: Access denied for section ${SEC_5A_UUID}`));
    });
  });

  describe('3. Delivery Package Manifest & Signed 15-Minute Download URLs', () => {
    it('should generate signed manifest with 15-minute expiring download links for teacher delivery', async () => {
      const deliveryWithItems = {
        id: DELIV_PKG_UUID,
        section_id: SEC_3B_UUID,
        project_id: PROJ_OS_UUID,
        course_id: COURSE_OS_UUID,
        teacher_id: TEACHER_KEBEDE_UUID,
        batch_count: 2,
        status: 'prepared',
        channel: 'telegram',
        course: { id: COURSE_OS_UUID, code: 'COSC301', title: 'Operating Systems' },
        teacher: { id: TEACHER_KEBEDE_UUID, full_name: 'Dr. Kebede', telegram_username: 'dr_kebede' },
        section: { id: SEC_3B_UUID, name: 'Section B', academic_year: { name: '3rd Year' } },
        project: { id: PROJ_OS_UUID, title: 'OS Kernel Lab' },
        items: [
          {
            id: 'item-1',
            submission: {
              id: SUB_1_UUID,
              section_id: SEC_3B_UUID,
              project_id: PROJ_OS_UUID,
              submission_type: 'individual',
              student: { full_name: 'Abdi Mohammed' },
              files: [
                {
                  storage_path: 'projects/p1/individual/abdi/report.pdf',
                  original_filename: 'Kernel_Lab_Abdi.pdf',
                  file_size_bytes: 2048576,
                },
              ],
            },
          },
          {
            id: 'item-2',
            submission: {
              id: SUB_2_UUID,
              section_id: SEC_3B_UUID,
              project_id: PROJ_OS_UUID,
              submission_type: 'group',
              group: { group_code: 'Group 04' },
              files: [
                {
                  storage_path: 'projects/p1/groups/grp4/project.zip',
                  original_filename: 'Group04_Final.zip',
                  file_size_bytes: 5242880,
                },
              ],
            },
          },
        ],
      };

      const mockDb = createMockSupabase({
        delivery: deliveryWithItems,
      });

      const manifestResult = await executeGetDeliveryPackageManifest(
        mockDb,
        mockRepContext,
        DELIV_PKG_UUID
      );

      assert.equal(manifestResult.error, undefined);
      assert.ok(manifestResult.delivery);
      assert.equal(manifestResult.items?.length, 2);

      // Verify Individual item details and signed URL
      const item1 = manifestResult.items![0];
      assert.equal(item1.submitterName, 'Abdi Mohammed');
      assert.equal(item1.fileName, 'Kernel_Lab_Abdi.pdf');
      assert.equal(item1.fileSizeBytes, 2048576);
      assert.match(item1.signedUrl, /expires_in=900/);
      assert.match(item1.signedUrl, /Kernel_Lab_Abdi\.pdf|projects\/p1\/individual/);

      // Verify Group item details and signed URL
      const item2 = manifestResult.items![1];
      assert.equal(item2.submitterName, 'Group 04 (Team)');
      assert.equal(item2.fileName, 'Group04_Final.zip');
      assert.equal(item2.fileSizeBytes, 5242880);
      assert.match(item2.signedUrl, /expires_in=900/);
    });

    it('should reject manifest generation when representative is not assigned to delivery section', async () => {
      const outsideDelivery = {
        id: DELIV_OUT_UUID,
        section_id: SEC_1A_UUID,
        items: [],
      };

      const mockDb = createMockSupabase({
        delivery: outsideDelivery,
      });

      const manifestResult = await executeGetDeliveryPackageManifest(
        mockDb,
        mockRepContext,
        DELIV_OUT_UUID
      );

      assert.match(manifestResult.error || '', new RegExp(`Forbidden: Access denied for section ${SEC_1A_UUID}`));
    });
  });
});
