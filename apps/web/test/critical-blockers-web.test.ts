// Critical Blockers Phases A & C Regression Tests (Web Admin Approval, Tokens & Distributed Rate Limit)
// Note: Uses mocked Supabase clients (does NOT connect to live Supabase Postgres/Auth).

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserSessionContext } from '../src/lib/auth/roles';
import {
  executeApproveRegistration,
  executeIssueStudentVerificationToken,
  executeIssueStudentVerificationTokenForHuId,
  resolveTargetStudentForRequest,
  type TargetStudentSummary,
} from '../src/lib/admin/student-approval-service';
import {
  assertDistributedRateLimit,
  globalWebRateLimiter,
} from '../src/lib/security/rate-limiter';

const OWNER_UUID = '11111111-1111-4111-8111-111111111111';
const REQ_UUID = '22222222-2222-4222-8222-222222222222';
const STU_UUID = '33333333-3333-4333-8333-333333333333';
const OTHER_STU_UUID = '44444444-4444-4444-8444-444444444444';

function buildOwnerContext(): UserSessionContext {
  return {
    userId: OWNER_UUID,
    email: 'owner@hu.edu.et',
    profile: {
      id: OWNER_UUID,
      telegram_user_id: 111111,
      full_name: 'System Owner',
      role: 'system_owner',
      is_active: true,
    } as NonNullable<UserSessionContext['profile']>,
    isOwner: true,
    isRepresentative: false,
    assignments: [],
  };
}

describe('Phase A Web Admin Controls — Claim/Recovery Approval & Hashed Token Issuance [Mocked Unit Test]', () => {
  beforeEach(() => {
    globalWebRateLimiter.reset();
  });

  it('executeApproveRegistration safely processes roster_claim & account_recovery and prevents duplicate Telegram IDs', async () => {
    const students: any[] = [
      {
        id: STU_UUID,
        hu_student_id: 'HU/10002/14',
        full_name: 'Roster Student',
        telegram_user_id: null,
        telegram_username: null,
        registration_status: 'pending',
        is_locked: false,
      },
      {
        id: OTHER_STU_UUID,
        hu_student_id: 'HU/10099/14',
        full_name: 'Other Student',
        telegram_user_id: 900111,
        telegram_username: 'other_stu',
        registration_status: 'locked',
        is_locked: true,
      },
    ];

    let reqRow: any = {
      id: REQ_UUID,
      hu_student_id: 'HU/10002/14',
      full_name: 'Applicant Entered Name',
      department_id: 'dept-1',
      academic_year_id: 'yr-1',
      section_id: 'sec-1',
      telegram_user_id: 777123,
      telegram_username: 'new_claim_user',
      request_type: 'roster_claim',
      target_student_id: STU_UUID,
      recovery_reason: 'Roster account claim request',
      status: 'pending',
    };

    const mockDb = {
      from: (table: string) => {
        if (table === 'registration_requests') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: reqRow, error: null }),
              }),
            }),
            update: (vals: any) => ({
              eq: () => ({
                eq: (_c: string, expectedStatus: string) => ({
                  select: async () => {
                    if (reqRow.status !== expectedStatus) return { data: [], error: null };
                    Object.assign(reqRow, vals);
                    return { data: [{ id: reqRow.id }], error: null };
                  },
                }),
              }),
            }),
          };
        }

        if (table === 'students') {
          return {
            select: () => ({
              eq: (col: string, val: unknown) => ({
                maybeSingle: async () => ({
                  data: students.find((s) => s[col] === val) || null,
                  error: null,
                }),
              }),
            }),
            update: (vals: any) => ({
              eq: async (_c: string, id: string) => {
                const target = students.find((s) => s.id === id);
                if (target) Object.assign(target, vals);
                return { error: null };
              },
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      },
    } as unknown as SupabaseClient;

    // 1. Reject duplicate Telegram ID already held by another student
    reqRow.telegram_user_id = 900111;
    const dupFail = await executeApproveRegistration(mockDb, buildOwnerContext(), REQ_UUID);
    assert.equal(dupFail.success, false);
    assert.match(dupFail.error || '', /already linked to another student/i);

    // 2. Approve legitimate roster claim -> links & locks student
    reqRow.telegram_user_id = 777123;
    const claimOk = await executeApproveRegistration(mockDb, buildOwnerContext(), REQ_UUID);
    assert.equal(claimOk.success, true);
    assert.equal(claimOk.studentId, STU_UUID);
    assert.equal(students[0].telegram_user_id, 777123);
    assert.equal(students[0].is_locked, true);

    // 3. Approve account recovery -> cleanly rebinds target student to recovered Telegram ID
    reqRow = {
      ...reqRow,
      request_type: 'account_recovery',
      telegram_user_id: 888456,
      telegram_username: 'recovered_tg',
      status: 'pending',
    };
    const recOk = await executeApproveRegistration(mockDb, buildOwnerContext(), REQ_UUID);
    assert.equal(recOk.success, true);
    assert.equal(students[0].telegram_user_id, 888456);
    assert.equal(students[0].telegram_username, 'recovered_tg');
  });

  it('executeIssueStudentVerificationToken stores ONLY SHA-256 hash and enforces System Owner + roster state', async () => {
    const storedTokens: any[] = [];
    let mockStudent: any = {
      id: STU_UUID,
      hu_student_id: 'HU/10002/14',
      telegram_user_id: null,
      registration_status: 'pending',
    };

    const mockDb = {
      from: (table: string) => {
        if (table === 'students') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: mockStudent, error: null }),
              }),
            }),
          };
        }
        if (table === 'student_verification_tokens') {
          return {
            insert: async (row: any) => {
              storedTokens.push(row);
              return { error: null };
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    } as unknown as SupabaseClient;

    const res = await executeIssueStudentVerificationToken(mockDb, buildOwnerContext(), {
      studentId: STU_UUID,
      purpose: 'roster_claim',
      expiresHours: 12,
    });

    assert.equal(res.success, true);
    assert.ok(res.token && res.token.length >= 16);
    assert.equal(storedTokens.length, 1);
    assert.notEqual(storedTokens[0].token_hash, res.token);
    assert.equal(
      storedTokens[0].token_hash,
      createHash('sha256').update(res.token).digest('hex')
    );

    // Suspended accounts cannot receive tokens
    mockStudent = { ...mockStudent, registration_status: 'suspended' };
    const suspFail = await executeIssueStudentVerificationToken(mockDb, buildOwnerContext(), {
      studentId: STU_UUID,
      purpose: 'account_recovery',
    });
    assert.equal(suspFail.success, false);
    assert.match(suspFail.error || '', /suspended/i);
  });

  it('executeIssueStudentVerificationTokenForHuId sanitizes HU Student ID, wires admin actions UI, and resolves target student comparison', async () => {
    const storedTokens: any[] = [];
    const mockDb = {
      from: (table: string) => {
        if (table === 'students') {
          return {
            select: () => ({
              eq: (col: string, val: unknown) => ({
                maybeSingle: async () => ({
                  data:
                    col === 'hu_student_id' && val === 'HU/10002/14'
                      ? {
                          id: STU_UUID,
                          hu_student_id: 'HU/10002/14',
                          full_name: 'Enrolled Student Target',
                          telegram_user_id: 900111,
                          registration_status: 'locked',
                        }
                      : null,
                  error: null,
                }),
                single: async () => ({
                  data: {
                    id: STU_UUID,
                    hu_student_id: 'HU/10002/14',
                    full_name: 'Enrolled Student Target',
                    telegram_user_id: 900111,
                    registration_status: 'locked',
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'student_verification_tokens') {
          return {
            insert: async (row: any) => {
              storedTokens.push(row);
              return { error: null };
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    } as unknown as SupabaseClient;

    const issued = await executeIssueStudentVerificationTokenForHuId(mockDb, buildOwnerContext(), {
      huStudentId: '  hu/10002/14  ',
      purpose: 'account_recovery',
      expiresHours: 12,
    });
    assert.equal(issued.success, true);
    assert.equal(issued.huStudentId, 'HU/10002/14');
    assert.equal(storedTokens.length, 1);

    // Target student resolution for account recovery displays bound owner accurately
    const boundTarget: TargetStudentSummary = {
      id: STU_UUID,
      hu_student_id: 'HU/10002/14',
      full_name: 'Enrolled Student Target',
      telegram_user_id: 900111,
      telegram_username: 'real_student_tg',
      registration_status: 'locked',
    };
    const byId = new Map([[STU_UUID, boundTarget]]);
    const byHuId = new Map([['HU/10002/14', boundTarget]]);

    const resolvedById = resolveTargetStudentForRequest(
      { request_type: 'account_recovery', target_student_id: STU_UUID, hu_student_id: 'HU/10002/14' },
      byId,
      byHuId
    );
    assert.equal(resolvedById?.telegram_user_id, 900111);
    assert.equal(resolvedById?.full_name, 'Enrolled Student Target');

    const resolvedFallbackHu = resolveTargetStudentForRequest(
      { request_type: 'account_recovery', target_student_id: null, hu_student_id: 'hu/10002/14' },
      byId,
      byHuId
    );
    assert.equal(resolvedFallbackHu?.id, STU_UUID);

    // Verify Server Actions & Client UI files in /admin/students wire token issuance and target display
    const actionsSource = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/app/admin/students/actions.ts'),
      'utf8'
    );
    assert.match(actionsSource, /executeIssueStudentVerificationToken/);
    assert.match(actionsSource, /executeIssueStudentVerificationTokenForHuId/);
    assert.match(actionsSource, /assertDistributedRateLimit/);

    const pageSource = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/app/admin/students/page.tsx'),
      'utf8'
    );
    assert.match(pageSource, /resolveTargetStudentForRequest/);
    assert.match(pageSource, /StudentVerificationRosterConsole/);
  });
});

describe('Phase C Web Distributed Rate Limiter [Mocked Unit Test]', () => {
  beforeEach(() => {
    globalWebRateLimiter.reset();
  });

  it('assertDistributedRateLimit enforces Postgres RPC sliding window across independent callers and fails closed on RPC error', async () => {
    let calls = 0;
    const sharedClient = {
      rpc: async (fn: string, params: Record<string, unknown>) => {
        assert.equal(fn, 'check_and_increment_rate_limit');
        assert.equal(params.p_key, 'web:rep-delivery:user-1');
        calls += 1;
        if (calls <= 2) {
          return { data: [{ allowed: true, remaining: 2 - calls, retry_after_ms: 0 }], error: null };
        }
        return { data: [{ allowed: false, remaining: 0, retry_after_ms: 5000 }], error: null };
      },
    };

    await assertDistributedRateLimit('web:rep-delivery:user-1', 2, 60_000, 'delivery', sharedClient);
    await assertDistributedRateLimit('web:rep-delivery:user-1', 2, 60_000, 'delivery', sharedClient);

    await assert.rejects(
      () => assertDistributedRateLimit('web:rep-delivery:user-1', 2, 60_000, 'delivery', sharedClient),
      /Too many requests: Rate limit for delivery exceeded\. Please wait 5 seconds\./
    );

    // Fails closed if distributed rate-limit RPC fails
    await assert.rejects(
      () =>
        assertDistributedRateLimit('web:rep-delivery:user-1', 2, 60_000, 'delivery', {
          rpc: async () => ({ data: null, error: { message: 'Postgres unavailable' } }),
        }),
      /Rate limit verification service unavailable/
    );
  });
});
