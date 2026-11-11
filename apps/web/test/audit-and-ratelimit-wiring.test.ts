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

function createRepContext(userId = 'rep-1'): UserSessionContext {
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
        section_id: 'sec-a',
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

    const mockSupabase = {
      rpc: async (fn: string, params: any) => {
        rpcCalls.push({ fn, params });
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
                if (table === 'projects') {
                  return {
                    data: {
                      id: 'proj-1',
                      course_id: 'course-1',
                      title: 'P1',
                      submission_type: 'group',
                      file_rules: { min_group_size: 2, max_group_size: 4 },
                    },
                    error: null,
                  };
                }
                if (table === 'deliveries') {
                  return { data: { id: 'deliv-1', section_id: 'sec-a' }, error: null };
                }
                return { data: null, error: null };
              },
              maybeSingle: async () => ({ data: null, error: null }),
              then: (resolve: any) => {
                if (table === 'submissions') {
                  return resolve({
                    data: [{ id: 'sub-1', section_id: 'sec-a', project_id: 'proj-1', status: 'submitted' }],
                    error: null,
                  });
                }
                if (table === 'students') {
                  return resolve({
                    data: [
                      { id: 'stu-1', section_id: 'sec-a', registration_status: 'active', full_name: 'Stu 1' },
                      { id: 'stu-2', section_id: 'sec-a', registration_status: 'active', full_name: 'Stu 2' },
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
                if (table === 'deliveries') return { data: { id: 'deliv-1', ...payload }, error: null };
                if (table === 'groups') return { data: { id: 'grp-1', ...payload }, error: null };
                return { data: { id: 'row-1' }, error: null };
              },
            }),
            then: (resolve: any) => resolve({ error: null }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      },
    } as any;

    const ctx = createRepContext('rep-rpc-test');

    const prep = await executePrepareDeliveryBatch(mockSupabase, ctx, {
      sectionId: 'sec-a',
      projectId: 'proj-1',
      teacherId: 'teacher-1',
      channel: 'email',
      submissionIds: ['sub-1'],
    });
    assert.equal(prep.success, true);

    const disp = await executeDispatchDelivery(mockSupabase, ctx, 'deliv-1', 'Sent');
    assert.equal(disp.success, true);

    const ack = await executeAcknowledgeDelivery(mockSupabase, ctx, 'deliv-1');
    assert.equal(ack.success, true);

    const grp = await executeCreateProjectGroup(mockSupabase, ctx, {
      sectionId: 'sec-a',
      projectId: 'proj-1',
      groupCode: 'G-99',
      leaderStudentId: 'stu-1',
      memberStudentIds: ['stu-1', 'stu-2'],
    });
    assert.equal(grp.success, true);

    assert.equal(directAuditInsertAttempted, false);
    assert.deepEqual(
      rpcCalls.map((c) => c.params.p_action),
      [
        'TEACHER_DELIVERY_PREPARED',
        'TEACHER_DELIVERY_DISPATCHED',
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
                id: 'file-1',
                storage_path: 'sec-a/sub-1/report.pdf',
                submission: { section_id: 'sec-a' },
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

    const ctx = createRepContext('rep-rl-url');
    for (let i = 0; i < 30; i++) {
      const res = await executeGetSubmissionFileDownloadUrl(supabase, ctx, 'file-1');
      assert.equal(res.signedUrl, 'https://storage.local/signed?token=abc');
    }

    const blocked = await executeGetSubmissionFileDownloadUrl(supabase, ctx, 'file-1');
    assert.equal(blocked.signedUrl, undefined);
    assert.match(blocked.error || '', /Too many requests: Rate limit for file download URL generation exceeded/);
  });

  it('executePrepareDeliveryBatch enforces per-user rate limit after 20 requests', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: null, error: { message: 'Not found' } }),
          }),
        }),
      }),
    } as any;

    const ctx = createRepContext('rep-rl-delivery');
    for (let i = 0; i < 20; i++) {
      const res = await executePrepareDeliveryBatch(supabase, ctx, {
        sectionId: 'sec-a',
        projectId: 'proj-missing',
        teacherId: 'teacher-1',
        channel: 'email',
        submissionIds: ['sub-1'],
      });
      assert.equal(res.success, false);
      assert.equal(res.error, 'Academic project record not found.');
    }

    const blocked = await executePrepareDeliveryBatch(supabase, ctx, {
      sectionId: 'sec-a',
      projectId: 'proj-missing',
      teacherId: 'teacher-1',
      channel: 'email',
      submissionIds: ['sub-1'],
    });
    assert.equal(blocked.success, false);
    assert.match(blocked.error || '', /Too many requests: Rate limit for delivery batch operations exceeded/);
  });

  it('executeCreateProjectGroup enforces per-user rate limit after 20 requests', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: null, error: { message: 'Not found' } }),
          }),
        }),
      }),
    } as any;

    const ctx = createRepContext('rep-rl-group');
    for (let i = 0; i < 20; i++) {
      const res = await executeCreateProjectGroup(supabase, ctx, {
        sectionId: 'sec-a',
        projectId: 'proj-missing',
        groupCode: 'G-1',
        leaderStudentId: 's1',
        memberStudentIds: ['s1'],
      });
      assert.equal(res.success, false);
      assert.equal(res.error, 'Project record not found.');
    }

    const blocked = await executeCreateProjectGroup(supabase, ctx, {
      sectionId: 'sec-a',
      projectId: 'proj-missing',
      groupCode: 'G-1',
      leaderStudentId: 's1',
      memberStudentIds: ['s1'],
    });
    assert.equal(blocked.success, false);
    assert.match(blocked.error || '', /Too many requests: Rate limit for project group creation exceeded/);
  });
});
