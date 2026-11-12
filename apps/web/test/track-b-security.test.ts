// HU-ASMS: Phase 14 Track B — Security Hardening Regression Tests
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isValidUuid } from '@hu-asms/validation';
import {
  SYSTEM_OWNER_ROLE,
  REPRESENTATIVE_ROLE,
  isSystemOwnerRole,
  isRepresentativeRole,
  resolvePostLoginPath,
} from '../src/lib/auth/role-policy.js';
import { evaluateRouteGuard } from '../src/lib/auth/middleware-guard.js';
import {
  assertSystemOwner,
  assertRepresentativeSectionScope,
  resolveAuthorizedSectionScope,
  requireRepresentativeContext,
  getActiveAssignedSectionIds,
  type UserSessionContext,
} from '../src/lib/auth/roles.js';
import {
  executeApproveRegistration,
  executeRejectRegistration,
} from '../src/lib/admin/student-approval-service.js';
import {
  validateUuidIdentifier,
  validateDeliveryBatchUuids,
  validateGroupCreationUuids,
} from '../src/lib/rep/input-validation.js';
import { executeGetDeliveryPackageManifest } from '../src/lib/rep/delivery-service.js';
import { executeGetSubmissionFileDownloadUrl } from '../src/lib/rep/submission-file-service.js';
import { globalWebRateLimiter, MemoryRateLimiter } from '../src/lib/security/rate-limiter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(webRoot, '../..');

const VALID_UUID_1 = '11111111-1111-4111-8111-111111111111';
const VALID_UUID_2 = '22222222-2222-4222-8222-222222222222';
const VALID_UUID_3 = '33333333-3333-4333-8333-333333333333';
const VALID_UUID_4 = '44444444-4444-4444-8444-444444444444';

function makeOwnerContext(overrides: Partial<UserSessionContext> = {}): UserSessionContext {
  return {
    userId: VALID_UUID_1,
    email: 'owner@haramaya.edu.et',
    profile: {
      id: VALID_UUID_1,
      telegram_user_id: 10001,
      full_name: 'System Owner',
      role: 'system_owner',
      is_active: true,
    } as NonNullable<UserSessionContext['profile']>,
    isOwner: true,
    isRepresentative: true,
    assignments: [],
    ...overrides,
  };
}

function makeRepContext(
  sectionIds: string[] = [VALID_UUID_2],
  overrides: Partial<UserSessionContext> = {}
): UserSessionContext {
  return {
    userId: VALID_UUID_2,
    email: 'rep@haramaya.edu.et',
    profile: {
      id: VALID_UUID_2,
      telegram_user_id: 20002,
      full_name: 'Section Representative',
      role: 'representative',
      is_active: true,
    } as NonNullable<UserSessionContext['profile']>,
    isOwner: false,
    isRepresentative: true,
    assignments: sectionIds.map((sectionId, idx) => ({
      id: `assign-${idx}`,
      profile_id: VALID_UUID_2,
      section_id: sectionId,
      is_active: true,
    })) as UserSessionContext['assignments'],
    ...overrides,
  };
}

describe('Phase 14 Track B — Canonical Role Policy', () => {
  it('enforces system_owner and representative roles while rejecting legacy owner alias', () => {
    assert.equal(SYSTEM_OWNER_ROLE, 'system_owner');
    assert.equal(REPRESENTATIVE_ROLE, 'representative');

    assert.equal(isSystemOwnerRole('system_owner'), true);
    assert.equal(isSystemOwnerRole('owner'), false);
    assert.equal(isSystemOwnerRole('representative'), false);
    assert.equal(isSystemOwnerRole(null), false);

    assert.equal(isRepresentativeRole('representative'), true);
    assert.equal(isRepresentativeRole('system_owner'), true);
    assert.equal(isRepresentativeRole('owner'), false);
    assert.equal(isRepresentativeRole('student'), false);
    assert.equal(isRepresentativeRole(undefined), false);

    assert.equal(resolvePostLoginPath('system_owner'), '/admin');
    assert.equal(resolvePostLoginPath('representative'), '/rep');
    assert.equal(resolvePostLoginPath('owner'), null);
    assert.equal(resolvePostLoginPath('student'), null);
    assert.equal(resolvePostLoginPath(null), null);
  });
});

describe('Phase 14 Track B — Fail-Closed Edge Middleware Guard', () => {
  it('allows public routes even without authentication config', () => {
    assert.deepEqual(
      evaluateRouteGuard({
        pathname: '/login',
        method: 'GET',
        hasSupabaseConfig: false,
      }),
      { action: 'allow' }
    );
  });

  it('fails closed with 503 on protected routes when Supabase configuration is missing', () => {
    assert.deepEqual(
      evaluateRouteGuard({
        pathname: '/admin',
        method: 'GET',
        hasSupabaseConfig: false,
      }),
      {
        action: 'deny',
        status: 503,
        error: 'Authentication service is not configured.',
      }
    );
  });

  it('redirects unauthenticated GET requests and denies unauthenticated mutations/Server Actions', () => {
    assert.deepEqual(
      evaluateRouteGuard({
        pathname: '/rep/submissions',
        method: 'GET',
        hasSupabaseConfig: true,
        userId: null,
      }),
      {
        action: 'redirect',
        pathname: '/login',
        redirectTo: '/rep/submissions',
      }
    );

    assert.deepEqual(
      evaluateRouteGuard({
        pathname: '/admin/students',
        method: 'POST',
        hasNextActionHeader: true,
        hasSupabaseConfig: true,
        userId: null,
      }),
      {
        action: 'deny',
        status: 401,
        error: 'Authentication required.',
      }
    );
  });

  it('fails closed when profile lookup errors or account is inactive/missing', () => {
    assert.deepEqual(
      evaluateRouteGuard({
        pathname: '/rep',
        method: 'GET',
        hasSupabaseConfig: true,
        userId: VALID_UUID_1,
        profileError: true,
      }),
      {
        action: 'redirect',
        pathname: '/login',
        error: 'auth_verification_failed',
      }
    );

    assert.deepEqual(
      evaluateRouteGuard({
        pathname: '/rep',
        method: 'GET',
        hasNextActionHeader: true,
        hasSupabaseConfig: true,
        userId: VALID_UUID_1,
        profileError: true,
      }),
      {
        action: 'deny',
        status: 503,
        error: 'Unable to verify authorization profile.',
      }
    );

    assert.deepEqual(
      evaluateRouteGuard({
        pathname: '/admin',
        method: 'GET',
        hasSupabaseConfig: true,
        userId: VALID_UUID_1,
        profile: { role: 'system_owner', is_active: false },
      }),
      {
        action: 'redirect',
        pathname: '/login',
        error: 'inactive_account',
      }
    );

    assert.deepEqual(
      evaluateRouteGuard({
        pathname: '/rep',
        method: 'POST',
        hasSupabaseConfig: true,
        userId: VALID_UUID_1,
        profile: { role: 'representative', is_active: false },
      }),
      {
        action: 'deny',
        status: 403,
        error: 'Inactive or missing staff profile.',
      }
    );
  });

  it('enforces role boundaries on /admin/* and /rep/* and rejects legacy owner role', () => {
    assert.deepEqual(
      evaluateRouteGuard({
        pathname: '/admin/students',
        method: 'GET',
        hasSupabaseConfig: true,
        userId: VALID_UUID_2,
        profile: { role: 'representative', is_active: true },
      }),
      {
        action: 'redirect',
        pathname: '/rep',
      }
    );

    assert.deepEqual(
      evaluateRouteGuard({
        pathname: '/admin/students',
        method: 'POST',
        hasSupabaseConfig: true,
        userId: VALID_UUID_2,
        profile: { role: 'representative', is_active: true },
      }),
      {
        action: 'deny',
        status: 403,
        error: 'Forbidden: System Owner privileges required.',
      }
    );

    assert.deepEqual(
      evaluateRouteGuard({
        pathname: '/rep/groups',
        method: 'GET',
        hasSupabaseConfig: true,
        userId: VALID_UUID_3,
        profile: { role: 'owner', is_active: true },
      }),
      {
        action: 'redirect',
        pathname: '/login',
        error: 'unauthorized_role',
      }
    );

    assert.deepEqual(
      evaluateRouteGuard({
        pathname: '/admin',
        method: 'GET',
        hasSupabaseConfig: true,
        userId: VALID_UUID_1,
        profile: { role: 'system_owner', is_active: true },
      }),
      { action: 'allow' }
    );

    assert.deepEqual(
      evaluateRouteGuard({
        pathname: '/rep',
        method: 'GET',
        hasSupabaseConfig: true,
        userId: VALID_UUID_2,
        profile: { role: 'representative', is_active: true },
      }),
      { action: 'allow' }
    );
  });
});

describe('Phase 14 Track B — Registration Approval & Rejection Service', () => {
  beforeEach(() => {
    globalWebRateLimiter.reset();
  });

  it('rejects unauthenticated and non-owner actors and enforces rate limit', async () => {
    const mockDb = {} as SupabaseClient;

    const repRes = await executeApproveRegistration(mockDb, makeRepContext(), VALID_UUID_3);
    assert.equal(repRes.success, false);
    assert.match(repRes.error ?? '', /System Owner privileges required/);

    const legacyOwnerRes = await executeRejectRegistration(
      mockDb,
      makeOwnerContext({ isOwner: false }),
      VALID_UUID_3,
      'test'
    );
    assert.equal(legacyOwnerRes.success, false);
    assert.match(legacyOwnerRes.error ?? '', /System Owner privileges required/);

    for (let i = 0; i < 15; i += 1) {
      const res = await executeApproveRegistration(mockDb, null, VALID_UUID_3);
      assert.equal(res.success, false);
      assert.match(res.error ?? '', /System Owner privileges required/);
    }

    const rateLimited = await executeApproveRegistration(mockDb, null, VALID_UUID_3);
    assert.equal(rateLimited.success, false);
    assert.match(
      rateLimited.error ?? '',
      /Too many requests: Rate limit for student registration review exceeded/
    );
  });

  it('validates registration request UUID and rejects malformed IDs before DB queries', async () => {
    let fromCalled = false;
    const mockDb = {
      from: () => {
        fromCalled = true;
        return {};
      },
    } as unknown as SupabaseClient;

    const approveBad = await executeApproveRegistration(mockDb, makeOwnerContext(), 'not-a-uuid');
    assert.equal(approveBad.success, false);
    assert.equal(approveBad.error, 'Invalid registration request identifier.');
    assert.equal(fromCalled, false);

    const rejectBad = await executeRejectRegistration(mockDb, makeOwnerContext(), '12345');
    assert.equal(rejectBad.success, false);
    assert.equal(rejectBad.error, 'Invalid registration request identifier.');
    assert.equal(fromCalled, false);
  });

  it('handles missing, already-processed, and valid approve/reject flows cleanly', async () => {
    const updates: Array<Record<string, unknown>> = [];

    const buildMockDb = (reqRow: Record<string, unknown> | null, insertError?: string) =>
      ({
        from: (table: string) => {
          if (table === 'registration_requests') {
            return {
              select: () => ({
                eq: () => ({
                  single: async () =>
                    reqRow
                      ? { data: reqRow, error: null }
                      : { data: null, error: { message: 'Not found' } },
                }),
              }),
              update: (payload: Record<string, unknown>) => {
                updates.push(payload);
                return {
                  eq: () => ({
                    eq: () => ({
                      select: async () => ({
                        data: [{ id: VALID_UUID_3 }],
                        error: null,
                      }),
                    }),
                  }),
                };
              },
            };
          }
          if (table === 'students') {
            return {
              insert: () => ({
                select: () => ({
                  single: async () =>
                    insertError
                      ? { data: null, error: { message: insertError } }
                      : { data: { id: VALID_UUID_4 }, error: null },
                }),
              }),
              delete: () => ({
                eq: async () => ({ error: null }),
              }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      }) as unknown as SupabaseClient;

    const notFound = await executeApproveRegistration(
      buildMockDb(null),
      makeOwnerContext(),
      VALID_UUID_3
    );
    assert.equal(notFound.success, false);
    assert.equal(notFound.error, 'Registration request not found.');

    const alreadyProcessed = await executeRejectRegistration(
      buildMockDb({ id: VALID_UUID_3, status: 'approved' }),
      makeOwnerContext(),
      VALID_UUID_3
    );
    assert.equal(alreadyProcessed.success, false);
    assert.equal(
      alreadyProcessed.error,
      'Registration request has already been processed (approved).'
    );

    const pendingRequest = {
      id: VALID_UUID_3,
      hu_student_id: 'HU/10294/14',
      full_name: 'Abebe Kebede',
      department_id: VALID_UUID_1,
      academic_year_id: VALID_UUID_2,
      section_id: VALID_UUID_4,
      telegram_user_id: 555666,
      telegram_username: 'abebe',
      status: 'pending',
    };

    const insertFailed = await executeApproveRegistration(
      buildMockDb(pendingRequest, 'duplicate key value'),
      makeOwnerContext(),
      VALID_UUID_3
    );
    assert.equal(insertFailed.success, false);
    assert.equal(insertFailed.error, 'duplicate key value');

    const approved = await executeApproveRegistration(
      buildMockDb(pendingRequest),
      makeOwnerContext(),
      VALID_UUID_3
    );
    assert.deepEqual(approved, { success: true, studentId: VALID_UUID_4 });
    assert.equal(updates[0]?.status, 'approved');
    assert.equal(updates[0]?.reviewed_by, VALID_UUID_1);

    const rejected = await executeRejectRegistration(
      buildMockDb({ id: VALID_UUID_3, status: 'pending' }),
      makeOwnerContext(),
      VALID_UUID_3,
      '   '
    );
    assert.deepEqual(rejected, { success: true });
    assert.equal(updates[1]?.status, 'rejected');
    assert.equal(updates[1]?.admin_notes, 'Identity verification mismatch');
  });

  it('detects 0-row concurrent updates and compensates partial failure during approval/rejection', async () => {
    const deletedStudentIds: string[] = [];

    const makeRaceMockDb = (opts: {
      updatedRows?: Array<{ id: string }>;
      updateError?: string;
    }) =>
      ({
        from: (table: string) => {
          if (table === 'registration_requests') {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data: {
                      id: VALID_UUID_3,
                      hu_student_id: 'HU/10294/14',
                      full_name: 'Abebe Kebede',
                      department_id: VALID_UUID_1,
                      academic_year_id: VALID_UUID_2,
                      section_id: VALID_UUID_4,
                      telegram_user_id: 555666,
                      telegram_username: 'abebe',
                      status: 'pending',
                    },
                    error: null,
                  }),
                }),
              }),
              update: () => ({
                eq: () => ({
                  eq: () => ({
                    select: async () =>
                      opts.updateError
                        ? { data: null, error: { message: opts.updateError } }
                        : { data: opts.updatedRows ?? [], error: null },
                  }),
                }),
              }),
            };
          }
          if (table === 'students') {
            return {
              insert: () => ({
                select: () => ({
                  single: async () => ({ data: { id: VALID_UUID_4 }, error: null }),
                }),
              }),
              delete: () => ({
                eq: async (_col: string, id: string) => {
                  deletedStudentIds.push(id);
                  return { error: null };
                },
              }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      }) as unknown as SupabaseClient;

    // 1. Concurrent approval affects 0 rows -> must roll back newly inserted student and fail
    const concurrentApprove = await executeApproveRegistration(
      makeRaceMockDb({ updatedRows: [] }),
      makeOwnerContext(),
      VALID_UUID_3
    );
    assert.equal(concurrentApprove.success, false);
    assert.match(concurrentApprove.error ?? '', /no longer pending/);
    assert.deepEqual(deletedStudentIds, [VALID_UUID_4]);

    // 2. Partial failure when registration_requests update errors -> must roll back student and fail
    const partialFailApprove = await executeApproveRegistration(
      makeRaceMockDb({ updateError: 'lock timeout on registration_requests' }),
      makeOwnerContext(),
      VALID_UUID_3
    );
    assert.equal(partialFailApprove.success, false);
    assert.match(partialFailApprove.error ?? '', /lock timeout on registration_requests/);
    assert.deepEqual(deletedStudentIds, [VALID_UUID_4, VALID_UUID_4]);

    // 3. Concurrent rejection affects 0 rows -> must NOT return success: true
    const concurrentReject = await executeRejectRegistration(
      makeRaceMockDb({ updatedRows: [] }),
      makeOwnerContext(),
      VALID_UUID_3,
      'Duplicate'
    );
    assert.equal(concurrentReject.success, false);
    assert.match(concurrentReject.error ?? '', /no longer pending/);
  });
});

describe('Phase 14 Track B — Representative Scope, Active Guards, and UUID Validation', () => {
  it('resolves authorized section scope and denies unauthorized or empty scopes', () => {
    const repContext = makeRepContext([VALID_UUID_2]);
    const ownerContext = makeOwnerContext();

    assert.deepEqual(resolveAuthorizedSectionScope(null, VALID_UUID_2), {
      authorized: false,
      status: 401,
      error: 'Unauthorized: Active staff authentication required.',
    });

    assert.deepEqual(resolveAuthorizedSectionScope(repContext, 'bad-uuid'), {
      authorized: false,
      status: 400,
      error: 'Invalid section identifier.',
    });

    assert.deepEqual(resolveAuthorizedSectionScope(repContext, VALID_UUID_3), {
      authorized: false,
      status: 403,
      error: `Forbidden: Access denied for section ${VALID_UUID_3}.`,
    });

    assert.deepEqual(resolveAuthorizedSectionScope(repContext, VALID_UUID_2), {
      authorized: true,
      sectionId: VALID_UUID_2,
    });

    assert.deepEqual(resolveAuthorizedSectionScope(repContext, undefined), {
      authorized: true,
      sectionId: VALID_UUID_2,
    });

    assert.deepEqual(resolveAuthorizedSectionScope(makeRepContext([]), undefined), {
      authorized: false,
      status: 403,
      error: 'Forbidden: No active section assignment is configured for your account.',
    });

    assert.deepEqual(resolveAuthorizedSectionScope(ownerContext, undefined), {
      authorized: false,
      status: 403,
      error: 'No section selected. Specify a valid sectionId parameter.',
    });

    assert.deepEqual(resolveAuthorizedSectionScope(ownerContext, VALID_UUID_3), {
      authorized: true,
      sectionId: VALID_UUID_3,
    });
  });

  it('requires active representative context and extracts unique active section IDs', async () => {
    const makeSessionDb = (profile: Record<string, unknown> | null, assignments: unknown[] = []) =>
      ({
        auth: {
          getUser: async () => ({
            data: { user: profile ? { id: profile.id, email: 'staff@hu.edu.et' } : null },
            error: null,
          }),
        },
        from: (table: string) => {
          if (table === 'profiles') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: profile, error: null }),
                }),
              }),
            };
          }
          if (table === 'representative_assignments') {
            return {
              select: () => ({
                eq: () => ({
                  eq: async () => ({ data: assignments, error: null }),
                }),
              }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      }) as unknown as SupabaseClient;

    await assert.rejects(
      () => requireRepresentativeContext(makeSessionDb(null)),
      /Active Representative session required/
    );

    await assert.rejects(
      () =>
        requireRepresentativeContext(
          makeSessionDb({ id: VALID_UUID_2, role: 'representative', is_active: false })
        ),
      /Active Representative session required/
    );

    await assert.rejects(
      () =>
        requireRepresentativeContext(
          makeSessionDb({ id: VALID_UUID_2, role: 'owner', is_active: true })
        ),
      /Active Representative session required/
    );

    const activeRep = await requireRepresentativeContext(
      makeSessionDb(
        { id: VALID_UUID_2, full_name: 'Rep A', role: 'representative', is_active: true },
        [
          { id: '1', profile_id: VALID_UUID_2, section_id: VALID_UUID_3, is_active: true },
          { id: '2', profile_id: VALID_UUID_2, section_id: VALID_UUID_3, is_active: true },
          { id: '3', profile_id: VALID_UUID_2, section_id: VALID_UUID_4, is_active: false },
        ]
      )
    );
    assert.deepEqual(getActiveAssignedSectionIds(activeRep), [VALID_UUID_3]);
    assert.deepEqual(getActiveAssignedSectionIds(null), []);
  });

  it('validates canonical UUIDs across @hu-asms/validation and rep batch validators', () => {
    assert.equal(isValidUuid(VALID_UUID_1), true);
    assert.equal(isValidUuid(`  ${VALID_UUID_1.toUpperCase()}  `), true);
    assert.equal(isValidUuid('not-a-uuid'), false);
    assert.equal(isValidUuid(''), false);
    assert.equal(isValidUuid(null), false);

    assert.equal(validateUuidIdentifier(VALID_UUID_1, 'section'), null);
    assert.equal(validateUuidIdentifier('bad', 'section'), 'Invalid section identifier.');

    assert.equal(
      validateDeliveryBatchUuids({
        sectionId: VALID_UUID_1,
        projectId: VALID_UUID_2,
        teacherId: VALID_UUID_3,
        submissionIds: [VALID_UUID_4],
      }),
      null
    );
    assert.equal(
      validateDeliveryBatchUuids({
        sectionId: VALID_UUID_1,
        projectId: VALID_UUID_2,
        submissionIds: [VALID_UUID_4, 'bad-sub-id'],
      }),
      'Invalid submission identifier in delivery batch.'
    );

    assert.equal(
      validateGroupCreationUuids({
        sectionId: VALID_UUID_1,
        projectId: VALID_UUID_2,
        leaderStudentId: VALID_UUID_3,
        memberStudentIds: [VALID_UUID_4],
      }),
      null
    );
    assert.equal(
      validateGroupCreationUuids({
        sectionId: VALID_UUID_1,
        projectId: VALID_UUID_2,
        leaderStudentId: VALID_UUID_3,
        memberStudentIds: ['bad-member-id'],
      }),
      'Invalid member student identifier.'
    );
  });

  it('guards against null file.submission in executeGetSubmissionFileDownloadUrl', async () => {
    globalWebRateLimiter.reset();

    const makeFileDb = (fileData: unknown) =>
      ({
        from: () => ({
          select: () => ({
            eq: () => ({
              single: async () => ({ data: fileData, error: null }),
            }),
          }),
        }),
        storage: {
          from: () => ({
            createSignedUrl: async () => ({
              data: { signedUrl: 'https://storage.local/signed' },
              error: null,
            }),
          }),
        },
      }) as unknown as SupabaseClient;

    const missingSubmission = await executeGetSubmissionFileDownloadUrl(
      makeFileDb({
        id: VALID_UUID_1,
        storage_path: 'submissions/file.pdf',
        submission: null,
      }),
      makeRepContext([VALID_UUID_2]),
      VALID_UUID_1
    );
    assert.equal(
      missingSubmission.error,
      'Submission file is not linked to a valid submission section.'
    );

    const outOfScope = await executeGetSubmissionFileDownloadUrl(
      makeFileDb({
        id: VALID_UUID_1,
        storage_path: 'submissions/file.pdf',
        submission: { section_id: VALID_UUID_3 },
      }),
      makeRepContext([VALID_UUID_2]),
      VALID_UUID_1
    );
    assert.match(outOfScope.error ?? '', /Forbidden: Access denied for section/);

    const authorized = await executeGetSubmissionFileDownloadUrl(
      makeFileDb({
        id: VALID_UUID_1,
        storage_path: 'submissions/file.pdf',
        submission: { section_id: VALID_UUID_2 },
      }),
      makeRepContext([VALID_UUID_2]),
      VALID_UUID_1
    );
    assert.equal(authorized.signedUrl, 'https://storage.local/signed');
  });
});

describe('Phase 14 Track B — Staged Active-Profile RLS Guard Migration Contract', () => {
  it('enforces active profile checks in auth_is_rep_for_section and auth_get_assigned_section_ids without C1 objects', () => {
    const migrationPath = path.join(
      repoRoot,
      'supabase/migrations/20261111000001_track_b_rep_active_profile_guard.sql'
    );
    assert.equal(fs.existsSync(migrationPath), true, 'Track B forward migration must exist');

    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.auth_is_rep_for_section\(p_section_id UUID\)/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.auth_get_assigned_section_ids\(\)/);
    assert.match(sql, /SECURITY DEFINER/);
    assert.match(sql, /SET search_path = ''/);
    assert.match(sql, /INNER JOIN public\.profiles p ON p\.id = ra\.profile_id/);
    assert.match(sql, /ra\.is_active = true/);
    assert.match(sql, /p\.is_active = true/);
    assert.match(sql, /'representative'::public\.user_role/);
    assert.match(sql, /'system_owner'::public\.user_role/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.auth_is_rep_for_section\(UUID\) FROM PUBLIC, anon;/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.auth_is_rep_for_section\(UUID\) TO authenticated, service_role;/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.auth_get_assigned_section_ids\(\) FROM PUBLIC, anon, authenticated, service_role;/);
    assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.auth_get_assigned_section_ids\(\)/);

    // Verify Track C1 objects remain excluded from this Track B migration
    assert.doesNotMatch(sql, /approve_student_registration/i);
    assert.doesNotMatch(sql, /rate_limit/i);
    assert.doesNotMatch(sql, /webhook/i);
  });
});

describe('Phase 14 Track B — Explicit Active-Profile & Role Assertion Guards', () => {
  it('rejects missing profiles across assertSystemOwner, assertRepresentativeSectionScope, and resolveAuthorizedSectionScope', () => {
    const nullProfileContext: UserSessionContext = {
      userId: VALID_UUID_1,
      profile: null,
      isOwner: true,
      isRepresentative: true,
      assignments: makeRepContext([VALID_UUID_2]).assignments,
    };

    assert.throws(
      () => assertSystemOwner(null),
      /Forbidden: System Owner privileges required/
    );
    assert.throws(
      () => assertSystemOwner(nullProfileContext),
      /Forbidden: System Owner privileges required/
    );
    assert.throws(
      () => assertRepresentativeSectionScope(null, VALID_UUID_2),
      /Unauthorized: Authentication required/
    );
    assert.throws(
      () => assertRepresentativeSectionScope(nullProfileContext, VALID_UUID_2),
      /Unauthorized: Authentication required/
    );
    assert.deepEqual(resolveAuthorizedSectionScope(null, VALID_UUID_2), {
      authorized: false,
      status: 401,
      error: 'Unauthorized: Active staff authentication required.',
    });
    assert.deepEqual(resolveAuthorizedSectionScope(nullProfileContext, VALID_UUID_2), {
      authorized: false,
      status: 401,
      error: 'Unauthorized: Active staff authentication required.',
    });
  });

  it('rejects inactive profiles directly even if context role flags or assignments remain populated', () => {
    const inactiveOwner = makeOwnerContext({
      profile: {
        ...makeOwnerContext().profile!,
        is_active: false,
      },
    });
    const inactiveRep = makeRepContext([VALID_UUID_2], {
      profile: {
        ...makeRepContext([VALID_UUID_2]).profile!,
        is_active: false,
      },
    });

    assert.throws(
      () => assertSystemOwner(inactiveOwner),
      /Forbidden: System Owner privileges required/
    );
    assert.throws(
      () => assertRepresentativeSectionScope(inactiveOwner, VALID_UUID_2),
      /Forbidden: Active staff profile required/
    );
    assert.throws(
      () => assertRepresentativeSectionScope(inactiveRep, VALID_UUID_2),
      /Forbidden: Active staff profile required/
    );

    assert.deepEqual(resolveAuthorizedSectionScope(inactiveOwner, VALID_UUID_2), {
      authorized: false,
      status: 403,
      error: 'Forbidden: Active staff profile required.',
    });
    assert.deepEqual(resolveAuthorizedSectionScope(inactiveRep, VALID_UUID_2), {
      authorized: false,
      status: 403,
      error: 'Forbidden: Active staff profile required.',
    });
  });

  it('rejects invalid roles including legacy owner and student roles despite forged flags or assignments', () => {
    const legacyOwner = makeOwnerContext({
      profile: {
        ...makeOwnerContext().profile!,
        role: 'owner' as any,
        is_active: true,
      },
    });
    const studentWithAssignment = makeRepContext([VALID_UUID_2], {
      profile: {
        ...makeRepContext([VALID_UUID_2]).profile!,
        role: 'student' as any,
        is_active: true,
      },
      isRepresentative: false,
    });
    const repWithOwnerFlag = makeRepContext([VALID_UUID_2], {
      isOwner: true,
    });

    assert.throws(
      () => assertSystemOwner(legacyOwner),
      /Forbidden: System Owner privileges required/
    );
    assert.throws(
      () => assertSystemOwner(repWithOwnerFlag),
      /Forbidden: System Owner privileges required/
    );
    assert.throws(
      () => assertRepresentativeSectionScope(legacyOwner, VALID_UUID_2),
      /Forbidden: Representative privileges required/
    );
    assert.throws(
      () => assertRepresentativeSectionScope(studentWithAssignment, VALID_UUID_2),
      /Forbidden: Representative privileges required/
    );
    assert.throws(
      () => assertRepresentativeSectionScope(repWithOwnerFlag, VALID_UUID_3),
      /Forbidden: Access denied for section/
    );

    assert.deepEqual(resolveAuthorizedSectionScope(legacyOwner, VALID_UUID_2), {
      authorized: false,
      status: 403,
      error: 'Forbidden: Representative privileges required.',
    });
    assert.deepEqual(resolveAuthorizedSectionScope(studentWithAssignment, VALID_UUID_2), {
      authorized: false,
      status: 403,
      error: 'Forbidden: Representative privileges required.',
    });
  });

  it('enforces correct section, incorrect section, and system_owner global access', () => {
    const activeRep = makeRepContext([VALID_UUID_2]);
    const activeOwner = makeOwnerContext();

    assert.doesNotThrow(() => assertSystemOwner(activeOwner));
    assert.doesNotThrow(() => assertRepresentativeSectionScope(activeOwner, VALID_UUID_3));
    assert.doesNotThrow(() => assertRepresentativeSectionScope(activeRep, VALID_UUID_2));
    assert.throws(
      () => assertRepresentativeSectionScope(activeRep, VALID_UUID_3),
      /Forbidden: Access denied for section/
    );

    assert.deepEqual(resolveAuthorizedSectionScope(activeRep, VALID_UUID_2), {
      authorized: true,
      sectionId: VALID_UUID_2,
    });
    assert.deepEqual(resolveAuthorizedSectionScope(activeRep, VALID_UUID_3), {
      authorized: false,
      status: 403,
      error: `Forbidden: Access denied for section ${VALID_UUID_3}.`,
    });
    assert.deepEqual(resolveAuthorizedSectionScope(activeOwner, VALID_UUID_3), {
      authorized: true,
      sectionId: VALID_UUID_3,
    });
  });
});

describe('Phase 14 Track B — Delivery Manifest Relation & Error Integrity', () => {
  beforeEach(() => {
    globalWebRateLimiter.reset();
  });

  function makeManifestDb(delivery: Record<string, unknown> | null, signUrlError?: string) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () =>
              delivery
                ? { data: delivery, error: null }
                : { data: null, error: { message: 'Not found' } },
          }),
        }),
      }),
      storage: {
        from: () => ({
          createSignedUrl: async (storagePath: string) =>
            signUrlError
              ? { data: null, error: { message: signUrlError } }
              : {
                  data: {
                    signedUrl: `https://storage.local/signed/${storagePath}?expires_in=900`,
                  },
                  error: null,
                },
        }),
      },
    } as unknown as SupabaseClient;
  }

  it('fails closed when a delivery item has a missing or null submission record', async () => {
    const result = await executeGetDeliveryPackageManifest(
      makeManifestDb({
        id: VALID_UUID_1,
        section_id: VALID_UUID_2,
        items: [{ id: 'item-1', submission: null }],
      }),
      makeRepContext([VALID_UUID_2]),
      VALID_UUID_1
    );

    assert.equal(result.delivery, undefined);
    assert.equal(result.items, undefined);
    assert.equal(
      result.error,
      'Delivery batch contains an item with a missing submission record.'
    );
  });

  it('fails closed when an individual submission is missing its student relation or blank name', async () => {
    const nullStudentRes = await executeGetDeliveryPackageManifest(
      makeManifestDb({
        id: VALID_UUID_1,
        section_id: VALID_UUID_2,
        items: [
          {
            id: 'item-1',
            submission: {
              id: VALID_UUID_3,
              section_id: VALID_UUID_2,
              submission_type: 'individual',
              student: null,
              files: [{ storage_path: 'a/b.pdf', original_filename: 'b.pdf', file_size_bytes: 100 }],
            },
          },
        ],
      }),
      makeRepContext([VALID_UUID_2]),
      VALID_UUID_1
    );

    assert.equal(nullStudentRes.items, undefined);
    assert.match(nullStudentRes.error ?? '', /missing its student relation/);

    const blankStudentRes = await executeGetDeliveryPackageManifest(
      makeManifestDb({
        id: VALID_UUID_1,
        section_id: VALID_UUID_2,
        items: [
          {
            id: 'item-1',
            submission: {
              id: VALID_UUID_3,
              section_id: VALID_UUID_2,
              submission_type: 'individual',
              student: { full_name: '   ' },
              files: [{ storage_path: 'a/b.pdf', original_filename: 'b.pdf', file_size_bytes: 100 }],
            },
          },
        ],
      }),
      makeRepContext([VALID_UUID_2]),
      VALID_UUID_1
    );

    assert.equal(blankStudentRes.items, undefined);
    assert.match(blankStudentRes.error ?? '', /missing its student relation/);
  });

  it('fails closed when a group submission is missing its group relation or blank code', async () => {
    const nullGroupRes = await executeGetDeliveryPackageManifest(
      makeManifestDb({
        id: VALID_UUID_1,
        section_id: VALID_UUID_2,
        items: [
          {
            id: 'item-1',
            submission: {
              id: VALID_UUID_3,
              section_id: VALID_UUID_2,
              submission_type: 'group',
              group: null,
              files: [{ storage_path: 'a/g.zip', original_filename: 'g.zip', file_size_bytes: 200 }],
            },
          },
        ],
      }),
      makeRepContext([VALID_UUID_2]),
      VALID_UUID_1
    );

    assert.equal(nullGroupRes.items, undefined);
    assert.match(nullGroupRes.error ?? '', /missing its group relation/);
  });

  it('rejects cross-section submissions and missing/unsignable file attachments cleanly', async () => {
    const crossSectionRes = await executeGetDeliveryPackageManifest(
      makeManifestDb({
        id: VALID_UUID_1,
        section_id: VALID_UUID_2,
        items: [
          {
            id: 'item-1',
            submission: {
              id: VALID_UUID_3,
              section_id: VALID_UUID_4,
              submission_type: 'individual',
              student: { full_name: 'Abebe' },
              files: [{ storage_path: 'a/b.pdf', original_filename: 'b.pdf', file_size_bytes: 100 }],
            },
          },
        ],
      }),
      makeRepContext([VALID_UUID_2]),
      VALID_UUID_1
    );

    assert.match(crossSectionRes.error ?? '', /outside the delivery section/);

    const missingFileRes = await executeGetDeliveryPackageManifest(
      makeManifestDb({
        id: VALID_UUID_1,
        section_id: VALID_UUID_2,
        items: [
          {
            id: 'item-1',
            submission: {
              id: VALID_UUID_3,
              section_id: VALID_UUID_2,
              submission_type: 'individual',
              student: { full_name: 'Abebe' },
              files: [],
            },
          },
        ],
      }),
      makeRepContext([VALID_UUID_2]),
      VALID_UUID_1
    );

    assert.match(missingFileRes.error ?? '', /missing its file metadata/);

    const signFailRes = await executeGetDeliveryPackageManifest(
      makeManifestDb(
        {
          id: VALID_UUID_1,
          section_id: VALID_UUID_2,
          items: [
            {
              id: 'item-1',
              submission: {
                id: VALID_UUID_3,
                section_id: VALID_UUID_2,
                submission_type: 'individual',
                student: { full_name: 'Abebe' },
                files: [
                  { storage_path: 'a/b.pdf', original_filename: 'b.pdf', file_size_bytes: 100 },
                ],
              },
            },
          ],
        },
        'Bucket unavailable'
      ),
      makeRepContext([VALID_UUID_2]),
      VALID_UUID_1
    );

    assert.match(signFailRes.error ?? '', /Failed to generate signed URL.*Bucket unavailable/);
  });

  it('builds complete manifest when all submission, relation, and file records are valid', async () => {
    const validRes = await executeGetDeliveryPackageManifest(
      makeManifestDb({
        id: VALID_UUID_1,
        section_id: VALID_UUID_2,
        items: [
          {
            id: 'item-1',
            submission: {
              id: VALID_UUID_3,
              section_id: VALID_UUID_2,
              submission_type: 'individual',
              student: { full_name: 'Almaz Kebede' },
              files: [
                {
                  storage_path: 'projects/p1/almaz.pdf',
                  original_filename: 'almaz.pdf',
                  file_size_bytes: 512,
                },
              ],
            },
          },
        ],
      }),
      makeRepContext([VALID_UUID_2]),
      VALID_UUID_1
    );

    assert.equal(validRes.error, undefined);
    assert.equal(validRes.items?.length, 1);
    assert.equal(validRes.items?.[0]?.submitterName, 'Almaz Kebede');
    assert.equal(
      validRes.items?.[0]?.signedUrl,
      'https://storage.local/signed/projects/p1/almaz.pdf?expires_in=900'
    );
  });

  it('rejects empty delivery batches, batch_count mismatch, missing submission section_id, and project_id mismatch', async () => {
    const emptyItemsRes = await executeGetDeliveryPackageManifest(
      makeManifestDb({
        id: VALID_UUID_1,
        section_id: VALID_UUID_2,
        items: [],
      }),
      makeRepContext([VALID_UUID_2]),
      VALID_UUID_1
    );
    assert.equal(emptyItemsRes.error, 'Delivery batch contains no attached submissions.');

    const countMismatchRes = await executeGetDeliveryPackageManifest(
      makeManifestDb({
        id: VALID_UUID_1,
        section_id: VALID_UUID_2,
        batch_count: 2,
        items: [
          {
            id: 'item-1',
            submission: {
              id: VALID_UUID_3,
              section_id: VALID_UUID_2,
              submission_type: 'individual',
              student: { full_name: 'Almaz' },
              files: [{ storage_path: 'a/b.pdf', original_filename: 'b.pdf', file_size_bytes: 10 }],
            },
          },
        ],
      }),
      makeRepContext([VALID_UUID_2]),
      VALID_UUID_1
    );
    assert.equal(
      countMismatchRes.error,
      'Delivery batch integrity mismatch between recorded batch count and items.'
    );

    const missingSubSectionRes = await executeGetDeliveryPackageManifest(
      makeManifestDb({
        id: VALID_UUID_1,
        section_id: VALID_UUID_2,
        items: [
          {
            id: 'item-1',
            submission: {
              id: VALID_UUID_3,
              section_id: undefined,
              submission_type: 'individual',
              student: { full_name: 'Almaz' },
              files: [{ storage_path: 'a/b.pdf', original_filename: 'b.pdf', file_size_bytes: 10 }],
            },
          },
        ],
      }),
      makeRepContext([VALID_UUID_2]),
      VALID_UUID_1
    );
    assert.equal(
      missingSubSectionRes.error,
      'Security Violation: Delivery batch contains a submission outside the delivery section.'
    );

    const wrongProjectRes = await executeGetDeliveryPackageManifest(
      makeManifestDb({
        id: VALID_UUID_1,
        section_id: VALID_UUID_2,
        project_id: VALID_UUID_4,
        items: [
          {
            id: 'item-1',
            submission: {
              id: VALID_UUID_3,
              section_id: VALID_UUID_2,
              project_id: VALID_UUID_3,
              submission_type: 'individual',
              student: { full_name: 'Almaz' },
              files: [{ storage_path: 'a/b.pdf', original_filename: 'b.pdf', file_size_bytes: 10 }],
            },
          },
        ],
      }),
      makeRepContext([VALID_UUID_2]),
      VALID_UUID_1
    );
    assert.equal(
      wrongProjectRes.error,
      'Security Violation: Delivery batch contains a submission from another project.'
    );
  });

  it('rejects inactive profiles, empty assignments, and malformed UUIDs BEFORE querying submission_files or deliveries', async () => {
    let queryCount = 0;
    const spyDb = {
      from: () => {
        queryCount += 1;
        throw new Error('DB should not be queried for invalid actor or invalid UUID');
      },
    } as unknown as SupabaseClient;

    const inactiveProfileCtx = makeRepContext([VALID_UUID_2], {
      profile: {
        id: VALID_UUID_2,
        telegram_user_id: 20002,
        full_name: 'Inactive Rep',
        role: 'representative',
        is_active: false,
      } as NonNullable<UserSessionContext['profile']>,
    });

    const inactiveDownload = await executeGetSubmissionFileDownloadUrl(
      spyDb,
      inactiveProfileCtx,
      VALID_UUID_1
    );
    assert.equal(inactiveDownload.error, 'Forbidden: Active staff profile required.');

    const emptyAssignDownload = await executeGetSubmissionFileDownloadUrl(
      spyDb,
      makeRepContext([]),
      VALID_UUID_1
    );
    assert.match(emptyAssignDownload.error ?? '', /No active section assignment/);

    const badUuidDownload = await executeGetSubmissionFileDownloadUrl(
      spyDb,
      makeRepContext([VALID_UUID_2]),
      'not-a-uuid'
    );
    assert.equal(badUuidDownload.error, 'Invalid submission file identifier.');

    const inactiveManifest = await executeGetDeliveryPackageManifest(
      spyDb,
      inactiveProfileCtx,
      VALID_UUID_1
    );
    assert.equal(inactiveManifest.error, 'Forbidden: Active staff profile required.');

    const badUuidManifest = await executeGetDeliveryPackageManifest(
      spyDb,
      makeRepContext([VALID_UUID_2]),
      'not-a-uuid'
    );
    assert.equal(badUuidManifest.error, 'Invalid delivery identifier.');

    assert.equal(queryCount, 0);
  });
});

describe('Phase 14 Track B — Atomic RPC Wrappers, Reconciliation & Migration 20261111000002 Contracts', () => {
  it('executeApproveRegistration and executeRejectRegistration invoke atomic RPCs when available', async () => {
    const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];
    let tableQueries = 0;

    const rpcDb = {
      rpc: async (fn: string, params: Record<string, unknown>) => {
        rpcCalls.push({ fn, params });
        if (fn === 'approve_student_registration') {
          return {
            data: {
              request_id: params.p_request_id,
              student_id: VALID_UUID_4,
              status: 'approved',
            },
            error: null,
          };
        }
        return {
          data: {
            request_id: params.p_request_id,
            status: 'rejected',
            reason: params.p_reason,
          },
          error: null,
        };
      },
      from: () => {
        tableQueries += 1;
        throw new Error('Table API should not be called directly when RPC succeeds');
      },
    } as unknown as SupabaseClient;

    const approveRes = await executeApproveRegistration(rpcDb, makeOwnerContext(), VALID_UUID_3);
    assert.deepEqual(approveRes, { success: true, studentId: VALID_UUID_4 });

    const rejectRes = await executeRejectRegistration(rpcDb, makeOwnerContext(), VALID_UUID_3, '  Invalid ID card  ');
    assert.deepEqual(rejectRes, { success: true });

    assert.equal(tableQueries, 0);
    assert.deepEqual(rpcCalls, [
      {
        fn: 'approve_student_registration',
        params: { p_request_id: VALID_UUID_3, p_notes: null },
      },
      {
        fn: 'reject_student_registration',
        params: { p_request_id: VALID_UUID_3, p_reason: 'Invalid ID card' },
      },
    ]);

    // Missing student_id in RPC payload must fail closed
    const malformedRpcDb = {
      rpc: async () => ({ data: { status: 'approved' }, error: null }),
    } as unknown as SupabaseClient;
    const malformedRes = await executeApproveRegistration(malformedRpcDb, makeOwnerContext(), VALID_UUID_3);
    assert.equal(malformedRes.success, false);
    assert.match(malformedRes.error ?? '', /without returning the created student identifier/);

    // DB RPC error propagates cleanly
    const duplicateRpcDb = {
      rpc: async () => ({
        data: null,
        error: { message: 'Duplicate student conflict: HU Student ID or Telegram account is already registered.' },
      }),
    } as unknown as SupabaseClient;
    const dupRes = await executeApproveRegistration(duplicateRpcDb, makeOwnerContext(), VALID_UUID_3);
    assert.equal(dupRes.success, false);
    assert.match(dupRes.error ?? '', /Duplicate student conflict/);
  });

  it('executeApproveRegistration surfaces orphan reconciliation warning when rollback delete fails (FK/23503)', async () => {
    const fkBlockDb = {
      from: (table: string) => {
        if (table === 'registration_requests') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: VALID_UUID_3,
                    hu_student_id: 'HU/99999/17',
                    full_name: 'Student One',
                    department_id: VALID_UUID_1,
                    academic_year_id: VALID_UUID_2,
                    section_id: VALID_UUID_4,
                    telegram_user_id: 987654,
                    telegram_username: 'stu1',
                    status: 'pending',
                  },
                  error: null,
                }),
              }),
            }),
            update: () => ({
              eq: () => ({
                eq: () => ({
                  select: async () => ({ data: [], error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'students') {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({ data: { id: VALID_UUID_4 }, error: null }),
              }),
            }),
            delete: () => ({
              eq: async () => ({
                error: { code: '23503', message: 'update or delete on table "students" violates foreign key constraint' },
              }),
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    } as unknown as SupabaseClient;

    const res = await executeApproveRegistration(fkBlockDb, makeOwnerContext(), VALID_UUID_3);
    assert.equal(res.success, false);
    assert.match(res.error ?? '', new RegExp(`orphaned student ${VALID_UUID_4} requires reconciliation`));
  });

  it('MemoryRateLimiter enforces bounded capacity and LRU eviction without blocking active keys', () => {
    const smallLimiter = new MemoryRateLimiter(3, 60_000);
    const t0 = 1_000_000;

    assert.equal(smallLimiter.check('k1', 5, 10_000, t0).remaining, 4);
    assert.equal(smallLimiter.check('k2', 5, 10_000, t0 + 1).remaining, 4);
    assert.equal(smallLimiter.check('k3', 5, 10_000, t0 + 2).remaining, 4);
    assert.equal(smallLimiter.size(), 3);

    // Refresh 'k1' so 'k2' becomes the least-recently-used key
    assert.equal(smallLimiter.check('k1', 5, 10_000, t0 + 3).remaining, 3);
    // Adding 'k4' must keep capacity bounded at 3 and evict 'k2' (preserving 'k1' and 'k3')
    assert.equal(smallLimiter.check('k4', 5, 10_000, t0 + 4).remaining, 4);
    assert.equal(smallLimiter.size(), 3);
    // 'k1' retained its prior hits (now 3 hits used => remaining 2), whereas evicted 'k2' resets if re-added
    assert.equal(smallLimiter.check('k1', 5, 10_000, t0 + 5).remaining, 2);
    assert.equal(smallLimiter.check('k2', 5, 10_000, t0 + 6).remaining, 4);

    // Expired bucket pruning reclaims stale keys once window expires
    const pruned = smallLimiter.pruneExpired(t0 + 20_000);
    assert.equal(pruned, 3);
    assert.equal(smallLimiter.size(), 0);
  });

  it('Migration 20261111000002 defines C1/C2/C3 RPCs, indexes, triggers, and tightened RLS policies', () => {
    const sqlPath = path.resolve(
      repoRoot,
      'supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql'
    );
    assert.equal(fs.existsSync(sqlPath), true, 'Expected Track B C1/C2/C3 migration file');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // C2: Pending registration partial unique indexes & atomic RPCs
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_registration_request_hu_id/i);
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_registration_request_telegram_id/i);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.approve_student_registration\(/i);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.reject_student_registration\(/i);
    assert.match(sql, /SELECT \*\s+INTO v_req\s+FROM public\.registration_requests[\s\S]*?FOR UPDATE/i);
    assert.match(sql, /STUDENT_REGISTRATION_APPROVED/);
    assert.match(sql, /STUDENT_REGISTRATION_REJECTED/);

    // C1: Atomic delivery dispatch RPC & non-revert parity
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.mark_delivery_sent_with_audit\(/i);
    assert.match(sql, /TEACHER_DELIVERY_DISPATCHED/);
    assert.match(sql, /prepared_by/);
    assert.match(sql, /dispatched_by/);

    // SECURITY DEFINER hygiene & explicit grants
    const definerMatches = sql.match(/SECURITY DEFINER/g) || [];
    assert.equal(definerMatches.length, 3);
    assert.equal((sql.match(/SET search_path = ''/g) || []).length >= 9, true);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.approve_student_registration\(UUID, TEXT\) FROM PUBLIC, anon;/i);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.approve_student_registration\(UUID, TEXT\) TO authenticated, service_role;/i);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.reject_student_registration\(UUID, TEXT\) FROM PUBLIC, anon;/i);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.reject_student_registration\(UUID, TEXT\) TO authenticated, service_role;/i);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.mark_delivery_sent_with_audit\(UUID, TEXT\) FROM PUBLIC, anon;/i);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.mark_delivery_sent_with_audit\(UUID, TEXT\) TO authenticated, service_role;/i);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.is_project_targeted_to_section\(UUID, UUID\) FROM PUBLIC, anon;/i);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.is_project_targeted_to_section\(UUID, UUID\) TO authenticated, service_role;/i);

    const revOnlyTriggerFns = [
      'public\\.enforce_group_integrity\\(\\)',
      'public\\.enforce_group_member_integrity\\(\\)',
      'public\\.enforce_group_member_size_bounds\\(\\)',
      'public\\.check_and_update_group_verification\\(\\)',
      'public\\.enforce_delivery_integrity\\(\\)',
      'public\\.enforce_delivery_item_integrity\\(\\)',
    ];
    for (const fnSig of revOnlyTriggerFns) {
      assert.match(
        sql,
        new RegExp(`REVOKE ALL ON FUNCTION ${fnSig} FROM PUBLIC, anon, authenticated, service_role;`, 'i')
      );
      assert.doesNotMatch(sql, new RegExp(`GRANT EXECUTE ON FUNCTION ${fnSig}`, 'i'));
    }

    // C3: Integrity triggers & tightened RLS policies
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.is_project_targeted_to_section\(/i);
    assert.match(sql, /CREATE TRIGGER trg_enforce_group_integrity/i);
    assert.match(sql, /CREATE TRIGGER trg_enforce_group_member_integrity/i);
    assert.match(sql, /CREATE CONSTRAINT TRIGGER trg_enforce_group_member_size_bounds[\s\S]*?DEFERRABLE INITIALLY DEFERRED/i);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.check_and_update_group_verification\(/i);
    assert.match(sql, /CREATE TRIGGER trg_enforce_delivery_integrity/i);
    assert.match(sql, /CREATE TRIGGER trg_enforce_delivery_item_integrity/i);
    assert.match(sql, /CREATE POLICY "rep_access_assigned_section_groups" ON public\.groups/i);
    assert.match(sql, /CREATE POLICY "rep_access_assigned_section_group_members" ON public\.group_members/i);
    assert.match(sql, /CREATE POLICY "rep_manage_section_delivery_items" ON public\.delivery_items/i);
    assert.doesNotMatch(sql, /GRANT EXECUTE .* TO .*(anon|PUBLIC)/i);
  });
});
