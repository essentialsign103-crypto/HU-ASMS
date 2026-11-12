// HU-ASMS: Phase 14 Security Remediation Tests — Audit RPC & Web Rate-Limit Wiring
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { globalWebRateLimiter } from '../src/lib/security/rate-limiter.js';
import { writeScopedAuditLog } from '../src/lib/rep/audit-helper.js';
import { executeGetSubmissionFileDownloadUrl } from '../src/lib/rep/submission-file-service.js';
import {
  executePrepareDeliveryBatch,
  executeDispatchDelivery,
  executeAcknowledgeDelivery,
} from '../src/lib/rep/delivery-service.js';
import { executeCreateProjectGroup } from '../src/lib/rep/group-precreation-service.js';
import type { UserSessionContext } from '../src/lib/auth/roles.js';

const REP_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REP_URL_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-bbbbbbbbbbbb';
const REP_DELIV_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-cccccccccccc';
const REP_GROUP_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-dddddddddddd';
const SEC_A_UUID = '11111111-1111-4111-8111-111111111111';
const PROJ_1_UUID = '22222222-2222-4222-8222-222222222222';
const PROJ_MISSING_UUID = '22222222-2222-4222-8222-999999999999';
const COURSE_1_UUID = '33333333-3333-4333-8333-333333333333';
const YEAR_1_UUID = '44444444-4444-4444-8444-444444444444';
const TEACHER_1_UUID = '55555555-5555-4555-8555-555555555555';
const SUB_1_UUID = '66666666-6666-4666-8666-666666666666';
const DELIV_1_UUID = '77777777-7777-4777-8777-777777777777';
const GRP_1_UUID = '88888888-8888-4888-8888-888888888888';
const STU_1_UUID = '99999999-9999-4999-8999-999999999991';
const STU_2_UUID = '99999999-9999-4999-8999-999999999992';
const FILE_1_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function createRepContext(userId = REP_UUID): UserSessionContext {
  return {
    userId,
    profile: {
      id: userId,
      telegram_user_id: 222333,
      full_name: 'Rep Test',
      email: 'rep@hu.edu.et',
      role: 'representative',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    isOwner: false,
    isRepresentative: true,
    assignments: [
      {
        id: 'asg-sec-a',
        profile_id: userId,
        section_id: SEC_A_UUID,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  };
}

describe('Phase 14 — Scoped Audit Log RPC Routing', () => {
  beforeEach(() => globalWebRateLimiter.reset());
  afterEach(() => globalWebRateLimiter.reset());

  it('writeScopedAuditLog routes via rpc("record_scoped_audit_log") and never calls .from("audit_logs").insert when rpc exists', async () => {
    const rpcCalls: Array<{ fn: string; params: any }> = [];
    let directInsertCalled = false;

    const supabase = {
      rpc: async (fn: string, params: any) => {
        rpcCalls.push({ fn, params });
        return { data: 'audit-uuid-1', error: null };
      },
      from: (table: string) => ({
        insert: async () => {
          if (table === 'audit_logs') {
            directInsertCalled = true;
          }
          return { error: null };
        },
      }),
    } as any;

    await writeScopedAuditLog(supabase, {
      actorId: 'rep-1',
      actorRole: 'representative',
      action: 'TEACHER_DELIVERY_PREPARED',
      entityType: 'delivery',
      entityId: 'deliv-1',
      metadata: { section_id: 'sec-a', batch_count: 2 },
    });

    assert.equal(directInsertCalled, false);
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].fn, 'record_scoped_audit_log');
    assert.deepEqual(rpcCalls[0].params, {
      p_action: 'TEACHER_DELIVERY_PREPARED',
      p_entity_type: 'delivery',
      p_entity_id: 'deliv-1',
      p_metadata: { section_id: 'sec-a', batch_count: 2 },
    });
  });

  it('writeScopedAuditLog propagates RPC authorization rejection (fail-closed)', async () => {
    const supabase = {
      rpc: async () => ({
        data: null,
        error: { message: 'Forbidden: Access denied for audit logging in section sec-b.' },
      }),
    } as any;

    await assert.rejects(
      () =>
        writeScopedAuditLog(supabase, {
          actorId: 'rep-1',
          actorRole: 'representative',
          action: 'GROUP_PRECREATED',
          entityType: 'group',
          entityId: 'grp-1',
          metadata: {},
        }),
      /Audit log recording failed: Forbidden: Access denied/
    );
  });

  it('executeDispatchDelivery, executeAcknowledgeDelivery, executePrepareDeliveryBatch, and executeCreateProjectGroup use RPC audit path', async () => {
    const rpcCalls: Array<{ fn: string; params: any }> = [];
    let directAuditInsertAttempted = false;
    let deliveryStatus = 'prepared';

    const mockSupabase = {
      rpc: async (fn: string, params: any) => {
        rpcCalls.push({ fn, params });
        if (fn === 'mark_delivery_sent_with_audit') {
          deliveryStatus = 'sent';
          return {
            data: { delivery_id: params.p_delivery_id, status: 'sent', audit_id: 'audit-id' },
            error: null,
          };
        }
        return { data: 'audit-id', error: null };
      },
      from: (table: string) => {
        if (table === 'audit_logs') {
          return {
            insert: async () => {
              directAuditInsertAttempted = true;
              return { error: { message: 'permission denied for table audit_logs' } };
            },
          };
        }
        return {
          select: () => {
            const chain: any = {
              eq: () => chain,
              in: () => chain,
              neq: () => chain,
              single: async () => {
                if (table === 'sections') {
                  return {
                    data: { id: SEC_A_UUID, academic_year_id: YEAR_1_UUID },
                    error: null,
                  };
                }
                if (table === 'projects') {
                  return {
                    data: {
                      id: PROJ_1_UUID,
                      course_id: COURSE_1_UUID,
                      teacher_id: TEACHER_1_UUID,
                      title: 'P1',
                      is_active: true,
                      submission_type: 'group',
                      file_rules: { min_group_size: 2, max_group_size: 4 },
                      targets: [{ academic_year_id: YEAR_1_UUID, section_id: SEC_A_UUID }],
                    },
                    error: null,
                  };
                }
                if (table === 'teachers') {
                  return {
                    data: { id: TEACHER_1_UUID, is_active: true },
                    error: null,
                  };
                }
                if (table === 'deliveries') {
                  return {
                    data: { id: DELIV_1_UUID, section_id: SEC_A_UUID, status: deliveryStatus },
                    error: null,
                  };
                }
                return { data: null, error: null };
              },
              maybeSingle: async () => ({ data: null, error: null }),
              then: (resolve: any) => {
                if (table === 'submissions') {
                  return resolve({
                    data: [{ id: SUB_1_UUID, section_id: SEC_A_UUID, project_id: PROJ_1_UUID, status: 'active' }],
                    error: null,
                  });
                }
                if (table === 'students') {
                  return resolve({
                    data: [
                      { id: STU_1_UUID, section_id: SEC_A_UUID, registration_status: 'approved', full_name: 'Stu 1' },
                      { id: STU_2_UUID, section_id: SEC_A_UUID, registration_status: 'approved', full_name: 'Stu 2' },
                    ],
                    error: null,
                  });
                }
                if (table === 'group_members') {
                  return resolve({ data: [], error: null });
                }
                return resolve({ data: [], error: null });
              },
            };
            return chain;
          },
          insert: (payload: any) => ({
            select: () => ({
              single: async () => {
                if (table === 'deliveries') return { data: { id: DELIV_1_UUID, ...payload }, error: null };
                if (table === 'groups') return { data: { id: GRP_1_UUID, ...payload }, error: null };
                return { data: { id: 'row-1' }, error: null };
              },
            }),
            then: (resolve: any) => resolve({ error: null }),
          }),
          update: (payload: any) => ({
            eq: () => ({
              eq: () => ({
                select: async () => {
                  if (table === 'deliveries' && typeof payload?.status === 'string') {
                    deliveryStatus = payload.status;
                  }
                  return { data: [{ id: DELIV_1_UUID }], error: null };
                },
              }),
            }),
          }),
          delete: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      },
    } as any;

    const ctx = createRepContext(REP_UUID);

    const prep = await executePrepareDeliveryBatch(mockSupabase, ctx, {
      sectionId: SEC_A_UUID,
      projectId: PROJ_1_UUID,
      teacherId: TEACHER_1_UUID,
      channel: 'email',
      submissionIds: [SUB_1_UUID],
    });
    assert.equal(prep.success, true);

    const disp = await executeDispatchDelivery(mockSupabase, ctx, DELIV_1_UUID, 'Sent');
    assert.equal(disp.success, true);

    const ack = await executeAcknowledgeDelivery(mockSupabase, ctx, DELIV_1_UUID);
    assert.equal(ack.success, true);

    const grp = await executeCreateProjectGroup(mockSupabase, ctx, {
      sectionId: SEC_A_UUID,
      projectId: PROJ_1_UUID,
      groupCode: 'G-99',
      leaderStudentId: STU_1_UUID,
      memberStudentIds: [STU_1_UUID, STU_2_UUID],
    });
    assert.equal(grp.success, true);

    assert.equal(directAuditInsertAttempted, false);
    assert.deepEqual(
      rpcCalls.map((c) => (c.fn === 'mark_delivery_sent_with_audit' ? c.fn : c.params.p_action)),
      [
        'TEACHER_DELIVERY_PREPARED',
        'mark_delivery_sent_with_audit',
        'TEACHER_DELIVERY_ACKNOWLEDGED',
        'GROUP_PRECREATED',
      ]
    );
  });
});

describe('Phase 14 — Web Service Runtime Rate-Limit Enforcement', () => {
  beforeEach(() => globalWebRateLimiter.reset());
  afterEach(() => globalWebRateLimiter.reset());

  it('executeGetSubmissionFileDownloadUrl allows within limit (30/min) and blocks 31st request', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                id: FILE_1_UUID,
                storage_path: 'sec-a/sub-1/report.pdf',
                submission: { section_id: SEC_A_UUID },
              },
              error: null,
            }),
          }),
        }),
      }),
      storage: {
        from: () => ({
          createSignedUrl: async () => ({
            data: { signedUrl: 'https://storage.local/signed?token=abc' },
            error: null,
          }),
        }),
      },
    } as any;

    const ctx = createRepContext(REP_URL_UUID);
    for (let i = 0; i < 30; i++) {
      const res = await executeGetSubmissionFileDownloadUrl(supabase, ctx, FILE_1_UUID);
      assert.equal(res.signedUrl, 'https://storage.local/signed?token=abc');
    }

    const blocked = await executeGetSubmissionFileDownloadUrl(supabase, ctx, FILE_1_UUID);
    assert.equal(blocked.signedUrl, undefined);
    assert.match(blocked.error || '', /Too many requests: Rate limit for file download URL generation exceeded/);
  });

  it('executePrepareDeliveryBatch enforces per-user rate limit after 20 requests', async () => {
    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            single: async () =>
              table === 'sections'
                ? { data: { id: SEC_A_UUID, academic_year_id: YEAR_1_UUID }, error: null }
                : { data: null, error: { message: 'Not found' } },
          }),
        }),
      }),
    } as any;

    const ctx = createRepContext(REP_DELIV_UUID);
    for (let i = 0; i < 20; i++) {
      const res = await executePrepareDeliveryBatch(supabase, ctx, {
        sectionId: SEC_A_UUID,
        projectId: PROJ_MISSING_UUID,
        teacherId: TEACHER_1_UUID,
        channel: 'email',
        submissionIds: [SUB_1_UUID],
      });
      assert.equal(res.success, false);
      assert.equal(res.error, 'Academic project record not found.');
    }

    const blocked = await executePrepareDeliveryBatch(supabase, ctx, {
      sectionId: SEC_A_UUID,
      projectId: PROJ_MISSING_UUID,
      teacherId: TEACHER_1_UUID,
      channel: 'email',
      submissionIds: [SUB_1_UUID],
    });
    assert.equal(blocked.success, false);
    assert.match(blocked.error || '', /Too many requests: Rate limit for delivery batch operations exceeded/);
  });

  it('executeCreateProjectGroup enforces per-user rate limit after 20 requests', async () => {
    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            single: async () =>
              table === 'sections'
                ? { data: { id: SEC_A_UUID, academic_year_id: YEAR_1_UUID }, error: null }
                : { data: null, error: { message: 'Not found' } },
          }),
        }),
      }),
    } as any;

    const ctx = createRepContext(REP_GROUP_UUID);
    for (let i = 0; i < 20; i++) {
      const res = await executeCreateProjectGroup(supabase, ctx, {
        sectionId: SEC_A_UUID,
        projectId: PROJ_MISSING_UUID,
        groupCode: 'G-1',
        leaderStudentId: STU_1_UUID,
        memberStudentIds: [STU_1_UUID],
      });
      assert.equal(res.success, false);
      assert.equal(res.error, 'Project record not found.');
    }

    const blocked = await executeCreateProjectGroup(supabase, ctx, {
      sectionId: SEC_A_UUID,
      projectId: PROJ_MISSING_UUID,
      groupCode: 'G-1',
      leaderStudentId: STU_1_UUID,
      memberStudentIds: [STU_1_UUID],
    });
    assert.equal(blocked.success, false);
    assert.match(blocked.error || '', /Too many requests: Rate limit for project group creation exceeded/);
  });
});
