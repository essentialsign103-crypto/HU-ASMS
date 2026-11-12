// HU-ASMS: Track B — Public Function Privilege, Default ACL & End-to-End Security Contract Tests
// Explicitly distinguishes static SQL contract verification from mocked unit/service tests.
// Note: Live PostgreSQL integration tests are NOT executed here because the remote DB is under deployment freeze
// and no local Docker/PostgreSQL daemon is running in this environment.

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserSessionContext } from '../src/lib/auth/roles.js';
import { globalWebRateLimiter } from '../src/lib/security/rate-limiter.js';
import {
  executeApproveRegistration,
  executeRejectRegistration,
} from '../src/lib/admin/student-approval-service.js';
import {
  executePrepareDeliveryBatch,
  executeDispatchDelivery,
  executeAcknowledgeDelivery,
  executeGetDeliveryPackageManifest,
} from '../src/lib/rep/delivery-service.js';
import { executeCreateProjectGroup } from '../src/lib/rep/group-precreation-service.js';
import { executeGetSubmissionFileDownloadUrl } from '../src/lib/rep/submission-file-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(repoRoot, 'supabase/migrations');

const MIGRATION_05 = path.join(migrationsDir, '20261110000005_security_hardening.sql');
const MIGRATION_TB_1 = path.join(migrationsDir, '20261111000001_track_b_rep_active_profile_guard.sql');
const MIGRATION_TB_2 = path.join(migrationsDir, '20261111000002_track_b_atomic_rpcs_and_db_parity.sql');
const MIGRATION_TB_3 = path.join(migrationsDir, '20261111000003_track_b_function_privilege_and_default_acl_hardening.sql');

const UUID_OWNER = '11111111-1111-4111-8111-111111111111';
const UUID_REP = '22222222-2222-4222-8222-222222222222';
const UUID_SEC_ASSIGNED = '33333333-3333-4333-8333-333333333331';
const UUID_SEC_FOREIGN = '33333333-3333-4333-8333-333333333332';
const UUID_YEAR = '44444444-4444-4444-8444-444444444444';
const UUID_PROJ = '55555555-5555-4555-8555-555555555555';
const UUID_COURSE = '66666666-6666-4666-8666-666666666666';
const UUID_TEACHER = '77777777-7777-4777-8777-777777777777';
const UUID_SUB_1 = '88888888-8888-4888-8888-888888888881';
const UUID_STU_1 = '99999999-9999-4999-8999-999999999991';
const UUID_STU_2 = '99999999-9999-4999-8999-999999999992';
const UUID_DELIV_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const UUID_REQ_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const UUID_FILE_1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';

function buildRepContext(
  overrides: Partial<UserSessionContext> = {},
  profileOverrides: Partial<NonNullable<UserSessionContext['profile']>> = {},
  sectionIds: string[] = [UUID_SEC_ASSIGNED]
): UserSessionContext {
  return {
    userId: UUID_REP,
    email: 'rep@haramaya.edu.et',
    profile: {
      id: UUID_REP,
      telegram_user_id: 222222,
      full_name: 'Section Representative',
      role: 'representative',
      is_active: true,
      ...profileOverrides,
    } as NonNullable<UserSessionContext['profile']>,
    isOwner: false,
    isRepresentative: true,
    assignments: sectionIds.map((sectionId, idx) => ({
      id: `asg-${idx}`,
      profile_id: UUID_REP,
      section_id: sectionId,
      is_active: true,
    })) as UserSessionContext['assignments'],
    ...overrides,
  };
}

function buildOwnerContext(): UserSessionContext {
  return {
    userId: UUID_OWNER,
    email: 'owner@haramaya.edu.et',
    profile: {
      id: UUID_OWNER,
      telegram_user_id: 111111,
      full_name: 'System Owner',
      role: 'system_owner',
      is_active: true,
    } as NonNullable<UserSessionContext['profile']>,
    isOwner: true,
    isRepresentative: true,
    assignments: [],
  };
}

describe('Phase 14 Track B — Migration Sequence & Public Function Privileges [Static SQL Contract — Not Live PostgreSQL]', () => {
  it('maintains ordered, immutable applied migrations followed monotonically by Track B 000001 -> 000002 -> 000003', () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    assert.deepEqual(files, [
      '20261110000001_initial_schema.sql',
      '20261110000002_row_level_security.sql',
      '20261110000003_storage_setup.sql',
      '20261110000004_delivery_items_rep_policy.sql',
      '20261110000005_security_hardening.sql',
      '20261111000001_track_b_rep_active_profile_guard.sql',
      '20261111000002_track_b_atomic_rpcs_and_db_parity.sql',
      '20261111000003_track_b_function_privilege_and_default_acl_hardening.sql',
      '20261112000001_critical_blockers_persistence_and_identity_hardening.sql',
      '20261112000002_minimum_deployment_blocker_fixes.sql',
    ]);

    const cbSql = fs.readFileSync(
      path.join(migrationsDir, '20261112000001_critical_blockers_persistence_and_identity_hardening.sql'),
      'utf8'
    );
    assert.match(cbSql, /ALTER TABLE public\.bot_sessions ENABLE ROW LEVEL SECURITY;/i);
    assert.match(cbSql, /REVOKE ALL ON TABLE public\.bot_sessions FROM PUBLIC, anon, authenticated;/i);
    assert.match(cbSql, /ALTER TABLE public\.rate_limit_buckets ENABLE ROW LEVEL SECURITY;/i);
    assert.match(cbSql, /REVOKE ALL ON TABLE public\.rate_limit_buckets FROM PUBLIC, anon, authenticated;/i);
    assert.match(cbSql, /REVOKE ALL ON FUNCTION public\.check_and_increment_rate_limit\(TEXT, INTEGER, BIGINT\) FROM PUBLIC, anon, authenticated;/i);
    assert.match(cbSql, /GRANT EXECUTE ON FUNCTION public\.check_and_increment_rate_limit\(TEXT, INTEGER, BIGINT\) TO service_role;/i);
    assert.match(cbSql, /REVOKE ALL ON FUNCTION public\.redeem_student_verification_token\(TEXT, TEXT, BIGINT, TEXT\) FROM PUBLIC, anon, authenticated;/i);
    assert.match(cbSql, /GRANT EXECUTE ON FUNCTION public\.redeem_student_verification_token\(TEXT, TEXT, BIGINT, TEXT\) TO service_role;/i);
    assert.match(cbSql, /CREATE OR REPLACE FUNCTION public\.approve_student_registration\([\s\S]*?NOT public\.auth_is_system_owner\(\)/i);
    assert.match(cbSql, /REVOKE ALL ON FUNCTION public\.approve_student_registration\(UUID, TEXT\) FROM PUBLIC, anon;/i);

    const blockerSql = fs.readFileSync(
      path.join(migrationsDir, '20261112000002_minimum_deployment_blocker_fixes.sql'),
      'utf8'
    );
    assert.match(blockerSql, /chk_project_file_rules_max_size[\s\S]*?max_file_size_bytes <= 20971520/i);
    assert.match(blockerSql, /DROP INDEX IF EXISTS public\.uq_pending_registration_request_hu_id;/i);
    assert.match(blockerSql, /uq_pending_new_registration_hu_id[\s\S]*?'new_registration'/i);
    assert.match(blockerSql, /REVOKE UPDATE ON TABLE public\.student_verification_tokens FROM authenticated;/i);
    assert.match(blockerSql, /REVOKE ALL ON FUNCTION public\.audit_student_verification_token_issue\(\) FROM PUBLIC, anon, authenticated, service_role;/i);
    assert.match(blockerSql, /STUDENT_VERIFICATION_FAILED/i);
    assert.match(blockerSql, /STUDENT_VERIFICATION_LOCKED/i);
    assert.match(blockerSql, /REVOKE ALL ON FUNCTION public\.redeem_student_verification_token\(TEXT, TEXT, BIGINT, TEXT\) FROM PUBLIC, anon, authenticated;/i);
    assert.match(blockerSql, /GRANT EXECUTE ON FUNCTION public\.redeem_student_verification_token\(TEXT, TEXT, BIGINT, TEXT\) TO service_role;/i);

    // Previously applied Migration 05 must remain untouched (corrective SQL goes in 20261111000003).
    const m05 = fs.readFileSync(MIGRATION_05, 'utf8');
    assert.match(m05, /REVOKE ALL ON FUNCTION public\.auth_is_system_owner\(\) FROM PUBLIC;/);
    assert.doesNotMatch(m05, /20261111000003|REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon/);
  });

  it('enforces least-privilege EXECUTE grants across all 18 public functions (10 owner-only, 1 service-only, 1 auth-only, 6 scoped)', () => {
    const m03 = fs.readFileSync(MIGRATION_TB_3, 'utf8');
    const m01 = fs.readFileSync(MIGRATION_TB_1, 'utf8');
    const m02 = fs.readFileSync(MIGRATION_TB_2, 'utf8');

    const ownerOnlyFunctions = [
      'public\\.auth_get_assigned_section_ids\\(\\)',
      'public\\.update_timestamp_column\\(\\)',
      'public\\.enforce_single_group_per_project\\(\\)',
      'public\\.check_and_update_group_verification\\(\\)',
      'public\\.protect_profile_privileged_columns\\(\\)',
      'public\\.enforce_group_integrity\\(\\)',
      'public\\.enforce_group_member_integrity\\(\\)',
      'public\\.enforce_group_member_size_bounds\\(\\)',
      'public\\.enforce_delivery_integrity\\(\\)',
      'public\\.enforce_delivery_item_integrity\\(\\)',
    ];

    const serviceOnlyFunctions = [
      'public\\.admin_set_profile_status\\(UUID, public\\.user_role, BOOLEAN\\)',
    ];

    const authenticatedOnlyFunctions = [
      'public\\.record_scoped_audit_log\\(TEXT, TEXT, UUID, JSONB\\)',
    ];

    const authenticatedAndServiceFunctions = [
      'public\\.auth_is_system_owner\\(\\)',
      'public\\.auth_is_rep_for_section\\(UUID\\)',
      'public\\.is_project_targeted_to_section\\(UUID, UUID\\)',
      'public\\.approve_student_registration\\(UUID, TEXT\\)',
      'public\\.reject_student_registration\\(UUID, TEXT\\)',
      'public\\.mark_delivery_sent_with_audit\\(UUID, TEXT\\)',
    ];

    for (const sigPattern of ownerOnlyFunctions) {
      assert.match(
        m03,
        new RegExp(`REVOKE ALL ON FUNCTION ${sigPattern} FROM PUBLIC, anon, authenticated, service_role;`, 'i'),
        `Missing full REVOKE for owner-only function ${sigPattern} in 20261111000003`
      );
      assert.doesNotMatch(
        m03,
        new RegExp(`GRANT EXECUTE ON FUNCTION ${sigPattern}`, 'i'),
        `Owner-only function ${sigPattern} must NOT receive any GRANT EXECUTE in 20261111000003`
      );
    }

    for (const sigPattern of serviceOnlyFunctions) {
      assert.match(
        m03,
        new RegExp(`REVOKE ALL ON FUNCTION ${sigPattern} FROM PUBLIC, anon, authenticated, service_role;`, 'i')
      );
      assert.match(
        m03,
        new RegExp(`GRANT EXECUTE ON FUNCTION ${sigPattern} TO service_role;`, 'i')
      );
      assert.doesNotMatch(
        m03,
        new RegExp(`GRANT EXECUTE ON FUNCTION ${sigPattern} TO .*authenticated`, 'i'),
        `Service-only function ${sigPattern} must NOT grant EXECUTE to authenticated`
      );
    }

    for (const sigPattern of authenticatedOnlyFunctions) {
      assert.match(
        m03,
        new RegExp(`REVOKE ALL ON FUNCTION ${sigPattern} FROM PUBLIC, anon, authenticated, service_role;`, 'i')
      );
      assert.match(
        m03,
        new RegExp(`GRANT EXECUTE ON FUNCTION ${sigPattern} TO authenticated;`, 'i')
      );
      assert.doesNotMatch(
        m03,
        new RegExp(`GRANT EXECUTE ON FUNCTION ${sigPattern} TO .*service_role`, 'i'),
        `SSR authenticated-only function ${sigPattern} should NOT grant EXECUTE to service_role`
      );
    }

    for (const sigPattern of authenticatedAndServiceFunctions) {
      assert.match(
        m03,
        new RegExp(`REVOKE ALL ON FUNCTION ${sigPattern} FROM PUBLIC, anon, authenticated, service_role;`, 'i')
      );
      assert.match(
        m03,
        new RegExp(`GRANT EXECUTE ON FUNCTION ${sigPattern} TO authenticated, service_role;`, 'i')
      );
    }

    // Never grant EXECUTE to anon or PUBLIC, and never omit `, anon` on REVOKE
    assert.doesNotMatch(m01, /REVOKE ALL ON FUNCTION [^;]+ FROM PUBLIC;/i);
    assert.doesNotMatch(m02, /REVOKE ALL ON FUNCTION [^;]+ FROM PUBLIC;/i);
    assert.doesNotMatch(m03, /REVOKE ALL ON FUNCTION [^;]+ FROM PUBLIC;/i);
    assert.doesNotMatch(m01, /GRANT\s+EXECUTE\s+.*\s+TO\s+.*(anon|PUBLIC)/i);
    assert.doesNotMatch(m02, /GRANT\s+EXECUTE\s+.*\s+TO\s+.*(anon|PUBLIC)/i);
    assert.doesNotMatch(m03, /GRANT\s+EXECUTE\s+.*\s+TO\s+.*(anon|PUBLIC)/i);
  });

  it('hardens default function privileges for postgres (PUBLIC, anon, authenticated) and verifies 4-bucket ACL state', () => {
    const m03 = fs.readFileSync(MIGRATION_TB_3, 'utf8');

    assert.match(
      m03,
      /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s+REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;/i
    );
    assert.match(
      m03,
      /pg_has_role\(current_user, 'supabase_admin', 'MEMBER'\)/i,
      'supabase_admin ALTER DEFAULT PRIVILEGES must be guarded against non-superuser push failures'
    );
    assert.match(m03, /ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public\s+REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;/i);
    assert.match(m03, /v_owner_only_sigs CONSTANT TEXT\[\]/i);
    assert.match(m03, /v_service_only_sigs CONSTANT TEXT\[\]/i);
    assert.match(m03, /v_authenticated_only_sigs CONSTANT TEXT\[\]/i);
    assert.match(m03, /v_auth_and_service_sigs CONSTANT TEXT\[\]/i);
    assert.match(m03, /has_function_privilege\('anon', v_oid, 'EXECUTE'\)/i);
    assert.match(m03, /has_function_privilege\('public', v_oid, 'EXECUTE'\)/i);
    assert.match(m03, /has_function_privilege\('authenticated', v_oid, 'EXECUTE'\)/i);
    assert.match(m03, /has_function_privilege\('service_role', v_oid, 'EXECUTE'\)/i);
  });

  it('verifies all 8 effective SECURITY DEFINER functions pin search_path = \'\', avoid unsafe dynamic SQL, and enforce internal authorization', () => {
    const m05sql = fs.readFileSync(MIGRATION_05, 'utf8');
    const tb1sql = fs.readFileSync(MIGRATION_TB_1, 'utf8');
    const tb2sql = fs.readFileSync(MIGRATION_TB_2, 'utf8');

    // Every effective SECURITY DEFINER definition (05 superseded 02, plus Track B 000001 and 000002)
    // must pair SECURITY DEFINER with SET search_path = '' and never execute dynamic SQL.
    for (const [label, sqlText] of [
      ['20261110000005', m05sql],
      ['20261111000001', tb1sql],
      ['20261111000002', tb2sql],
    ] as const) {
      const sqlStatementsOnly = sqlText.replace(/--.*$/gm, '');
      const definerCount = (sqlStatementsOnly.match(/SECURITY DEFINER/gi) ?? []).length;
      const searchPathCount = (sqlStatementsOnly.match(/SECURITY DEFINER\s+SET search_path = ''/gi) ?? []).length;
      assert.ok(definerCount > 0, `${label} expected at least 1 SECURITY DEFINER function`);
      assert.equal(
        searchPathCount,
        definerCount,
        `${label} must pair every SECURITY DEFINER function with SET search_path = ''`
      );
      assert.doesNotMatch(
        sqlStatementsOnly,
        /\bEXECUTE\s+('|"|\$|\w+\s*\|\|)/i,
        `${label} must not construct dynamic EXECUTE SQL inside SECURITY DEFINER migrations`
      );
    }

    // Internal authorization checks per effective SECURITY DEFINER body
    assert.match(m05sql, /CREATE OR REPLACE FUNCTION public\.auth_is_system_owner\(\)[\s\S]*?is_active = true[\s\S]*?role = 'system_owner'|CREATE OR REPLACE FUNCTION public\.auth_is_system_owner\(\)[\s\S]*?role = 'system_owner'[\s\S]*?is_active = true/i);
    assert.match(tb1sql, /CREATE OR REPLACE FUNCTION public\.auth_is_rep_for_section\(p_section_id UUID\)[\s\S]*?p\.is_active = true[\s\S]*?p\.role IN \('representative'::public\.user_role, 'system_owner'::public\.user_role\)/i);
    assert.match(tb1sql, /CREATE OR REPLACE FUNCTION public\.auth_get_assigned_section_ids\(\)[\s\S]*?p\.is_active = true[\s\S]*?p\.role IN \('representative'::public\.user_role, 'system_owner'::public\.user_role\)/i);
    assert.match(m05sql, /CREATE OR REPLACE FUNCTION public\.admin_set_profile_status\([\s\S]*?auth_is_system_owner\(\)[\s\S]*?'service_role'/i);
    assert.match(m05sql, /CREATE OR REPLACE FUNCTION public\.record_scoped_audit_log\([\s\S]*?v_actor_id := auth\.uid\(\)[\s\S]*?v_is_active IS DISTINCT FROM true[\s\S]*?auth_is_system_owner\(\)[\s\S]*?auth_is_rep_for_section/i);
    assert.match(tb2sql, /CREATE OR REPLACE FUNCTION public\.approve_student_registration\([\s\S]*?NOT public\.auth_is_system_owner\(\)/i);
    assert.match(tb2sql, /CREATE OR REPLACE FUNCTION public\.reject_student_registration\([\s\S]*?NOT public\.auth_is_system_owner\(\)/i);
    assert.match(tb2sql, /CREATE OR REPLACE FUNCTION public\.mark_delivery_sent_with_audit\([\s\S]*?v_is_active IS DISTINCT FROM true[\s\S]*?public\.auth_is_rep_for_section/i);
  });

  it('enforces duplicate registration indexes, non-anon internal RPC checks, and C1/C2/C3 integrity parity in SQL contracts', () => {
    const m05 = fs.readFileSync(MIGRATION_05, 'utf8');
    const m02 = fs.readFileSync(MIGRATION_TB_2, 'utf8');

    // Internal non-anon guards inside SECURITY DEFINER RPCs
    assert.match(m05, /v_actor_id := auth\.uid\(\);\s+IF v_actor_id IS NULL THEN/i);
    assert.match(m05, /public\.auth_is_system_owner\(\)\s+OR COALESCE\(auth\.role\(\), ''\) = 'service_role'/i);
    assert.match(m02, /approve_student_registration[\s\S]*?public\.auth_is_system_owner\(\)[\s\S]*?COALESCE\(auth\.role\(\), ''\) <> 'service_role'/i);
    assert.match(m02, /reject_student_registration[\s\S]*?public\.auth_is_system_owner\(\)[\s\S]*?COALESCE\(auth\.role\(\), ''\) <> 'service_role'/i);
    assert.match(m02, /mark_delivery_sent_with_audit[\s\S]*?v_is_active IS DISTINCT FROM true[\s\S]*?public\.auth_is_rep_for_section\(v_delivery\.section_id\)/i);

    // Duplicate registration protection
    assert.match(
      m02,
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_registration_request_hu_id\s+ON public\.registration_requests \(hu_student_id\)\s+WHERE status = 'pending'::public\.request_status;/i
    );
    assert.match(
      m02,
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_registration_request_telegram_id\s+ON public\.registration_requests \(telegram_user_id\)\s+WHERE status = 'pending'::public\.request_status;/i
    );
    assert.match(m02, /ERRCODE = '23505'/);

    // Non-revert and immutable group/member/delivery protections
    assert.match(m02, /Representatives cannot directly create verified or submitted groups/i);
    assert.match(m02, /Representatives cannot self-confirm group memberships/i);
    assert.match(m02, /\(OLD\.status = 'prepared'::public\.delivery_status_enum AND NEW\.status IN \('sent'::public\.delivery_status_enum, 'failed'::public\.delivery_status_enum\)\)/i);
    assert.match(m02, /Cannot delete delivery_items from a delivery already in/i);
  });
});

describe('Phase 14 Track B — Authorization, RPC Rollback & Conflict Guards [Mocked Unit Test — Not Live PostgreSQL]', () => {
  beforeEach(() => {
    globalWebRateLimiter.reset();
  });

  it('denies unauthenticated (anonymous) callers across all admin and representative services before touching Supabase', async () => {
    let dbTouches = 0;
    const untouchableDb = {
      rpc: async () => {
        dbTouches += 1;
        throw new Error('Anonymous caller must not invoke RPC');
      },
      from: () => {
        dbTouches += 1;
        throw new Error('Anonymous caller must not query tables');
      },
      storage: {
        from: () => {
          dbTouches += 1;
          throw new Error('Anonymous caller must not touch storage');
        },
      },
    } as unknown as SupabaseClient;

    const appFail = await executeApproveRegistration(untouchableDb, null, UUID_REQ_1);
    assert.equal(appFail.success, false);
    assert.match(appFail.error ?? '', /Forbidden: System Owner/);

    const rejFail = await executeRejectRegistration(untouchableDb, null, UUID_REQ_1, 'No ID');
    assert.equal(rejFail.success, false);
    assert.match(rejFail.error ?? '', /Forbidden: System Owner/);

    const prepFail = await executePrepareDeliveryBatch(untouchableDb, null, {
      sectionId: UUID_SEC_ASSIGNED,
      projectId: UUID_PROJ,
      teacherId: UUID_TEACHER,
      channel: 'telegram',
      submissionIds: [UUID_SUB_1],
    });
    assert.equal(prepFail.success, false);
    assert.equal(prepFail.error, 'Authentication required.');

    const dispFail = await executeDispatchDelivery(untouchableDb, null, UUID_DELIV_1);
    assert.equal(dispFail.success, false);
    assert.equal(dispFail.error, 'Authentication required.');

    const ackFail = await executeAcknowledgeDelivery(untouchableDb, null, UUID_DELIV_1);
    assert.equal(ackFail.success, false);
    assert.equal(ackFail.error, 'Authentication required.');

    const manFail = await executeGetDeliveryPackageManifest(untouchableDb, null, UUID_DELIV_1);
    assert.equal(manFail.error, 'Authentication required.');

    const grpFail = await executeCreateProjectGroup(untouchableDb, null, {
      sectionId: UUID_SEC_ASSIGNED,
      projectId: UUID_PROJ,
      groupCode: 'G-01',
      leaderStudentId: UUID_STU_1,
      memberStudentIds: [UUID_STU_1, UUID_STU_2],
    });
    assert.equal(grpFail.success, false);
    assert.match(grpFail.error ?? '', /Authentication required/);

    const fileFail = await executeGetSubmissionFileDownloadUrl(untouchableDb, null, UUID_FILE_1);
    assert.equal(fileFail.error, 'Authentication required.');

    assert.equal(dbTouches, 0);
  });

  it('denies inactive representatives and unassigned sections across group, delivery, and file services', async () => {
    let dbTouches = 0;
    const spyDb = {
      rpc: async () => {
        dbTouches += 1;
        throw new Error('Blocked caller must not reach RPC');
      },
      from: () => {
        dbTouches += 1;
        throw new Error('Blocked caller must not reach DB queries');
      },
    } as unknown as SupabaseClient;

    const inactiveRep = buildRepContext({}, { is_active: false }, [UUID_SEC_ASSIGNED]);

    assert.equal(
      (await executePrepareDeliveryBatch(spyDb, inactiveRep, {
        sectionId: UUID_SEC_ASSIGNED,
        projectId: UUID_PROJ,
        teacherId: UUID_TEACHER,
        channel: 'email',
        submissionIds: [UUID_SUB_1],
      })).error,
      'Forbidden: Active staff profile required.'
    );
    assert.equal(
      (await executeDispatchDelivery(spyDb, inactiveRep, UUID_DELIV_1)).error,
      'Forbidden: Active staff profile required.'
    );
    assert.equal(
      (await executeAcknowledgeDelivery(spyDb, inactiveRep, UUID_DELIV_1)).error,
      'Forbidden: Active staff profile required.'
    );
    assert.equal(
      (await executeCreateProjectGroup(spyDb, inactiveRep, {
        sectionId: UUID_SEC_ASSIGNED,
        projectId: UUID_PROJ,
        groupCode: 'G-01',
        leaderStudentId: UUID_STU_1,
        memberStudentIds: [UUID_STU_1, UUID_STU_2],
      })).error,
      'Forbidden: Active staff profile required.'
    );

    // Active rep attempting foreign section group creation or delivery preparation fails before querying
    const activeRep = buildRepContext({}, { is_active: true }, [UUID_SEC_ASSIGNED]);
    const crossSectionGroup = await executeCreateProjectGroup(spyDb, activeRep, {
      sectionId: UUID_SEC_FOREIGN,
      projectId: UUID_PROJ,
      groupCode: 'G-02',
      leaderStudentId: UUID_STU_1,
      memberStudentIds: [UUID_STU_1, UUID_STU_2],
    });
    assert.equal(crossSectionGroup.success, false);
    assert.match(crossSectionGroup.error ?? '', new RegExp(`Forbidden: Access denied for section ${UUID_SEC_FOREIGN}`));

    const crossSectionDelivery = await executePrepareDeliveryBatch(spyDb, activeRep, {
      sectionId: UUID_SEC_FOREIGN,
      projectId: UUID_PROJ,
      teacherId: UUID_TEACHER,
      channel: 'telegram',
      submissionIds: [UUID_SUB_1],
    });
    assert.equal(crossSectionDelivery.success, false);
    assert.match(crossSectionDelivery.error ?? '', new RegExp(`Forbidden: Access denied for section ${UUID_SEC_FOREIGN}`));

    assert.equal(dbTouches, 0);
  });

  it('enforces zero compensating writes or partial state when dispatch, approval, or rejection RPCs fail', async () => {
    const writesAttempted: string[] = [];

    const rpcRollbackDb = {
      rpc: async (fn: string) => {
        if (fn === 'mark_delivery_sent_with_audit') {
          return { data: null, error: { message: 'Audit log transaction aborted cleanly' } };
        }
        if (fn === 'approve_student_registration') {
          return { data: null, error: { message: 'Duplicate student conflict: HU Student ID or Telegram account is already registered.' } };
        }
        if (fn === 'reject_student_registration') {
          return { data: null, error: { message: 'Registration request has already been processed (approved).' } };
        }
        throw new Error(`Unexpected RPC: ${fn}`);
      },
      from: (table: string) => {
        if (table === 'deliveries') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: UUID_DELIV_1,
                    section_id: UUID_SEC_ASSIGNED,
                    status: 'prepared',
                    sent_at: null,
                    delivery_notes: null,
                  },
                  error: null,
                }),
              }),
            }),
            update: () => {
              writesAttempted.push('deliveries.update');
              throw new Error('Failed RPC must never execute fallback/compensating updates');
            },
            delete: () => {
              writesAttempted.push('deliveries.delete');
              throw new Error('Failed RPC must never delete delivery');
            },
          };
        }
        writesAttempted.push(`${table}.write`);
        throw new Error(`RPC error must never trigger fallback table access on ${table}`);
      },
    } as unknown as SupabaseClient;

    const dispErr = await executeDispatchDelivery(rpcRollbackDb, buildRepContext(), UUID_DELIV_1, 'Sent to teacher');
    assert.equal(dispErr.success, false);
    assert.equal(dispErr.deliveryId, undefined);
    assert.match(dispErr.error ?? '', /Audit log transaction aborted cleanly/);

    const dupApproveErr = await executeApproveRegistration(rpcRollbackDb, buildOwnerContext(), UUID_REQ_1);
    assert.equal(dupApproveErr.success, false);
    assert.equal(dupApproveErr.studentId, undefined);
    assert.match(dupApproveErr.error ?? '', /Duplicate student conflict/);

    const staleRejectErr = await executeRejectRegistration(rpcRollbackDb, buildOwnerContext(), UUID_REQ_1, 'Mismatch');
    assert.equal(staleRejectErr.success, false);
    assert.match(staleRejectErr.error ?? '', /already been processed/);

    assert.deepEqual(writesAttempted, []);
  });

  it('rejects cross-section group members, below-min bounds, and inactive projects during group pre-creation', async () => {
    const db = {
      from: (table: string) => {
        if (table === 'sections') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { id: UUID_SEC_ASSIGNED, academic_year_id: UUID_YEAR },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'projects') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: UUID_PROJ,
                    is_active: true,
                    submission_type: 'group',
                    file_rules: { min_group_size: 2, max_group_size: 4 },
                    targets: [{ academic_year_id: UUID_YEAR, section_id: UUID_SEC_ASSIGNED }],
                  },
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
                  eq: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'students') {
          return {
            select: () => ({
              in: async () => ({
                data: [
                  { id: UUID_STU_1, section_id: UUID_SEC_ASSIGNED, registration_status: 'locked', full_name: 'Student One' },
                  { id: UUID_STU_2, section_id: UUID_SEC_FOREIGN, registration_status: 'locked', full_name: 'Student Two' },
                ],
                error: null,
              }),
            }),
          };
        }
        throw new Error(`Unexpected table query: ${table}`);
      },
    } as unknown as SupabaseClient;

    const tooSmall = await executeCreateProjectGroup(db, buildRepContext(), {
      sectionId: UUID_SEC_ASSIGNED,
      projectId: UUID_PROJ,
      groupCode: 'G-SMALL',
      leaderStudentId: UUID_STU_1,
      memberStudentIds: [UUID_STU_1],
    });
    assert.equal(tooSmall.success, false);
    assert.match(tooSmall.error ?? '', /Group size violation: Must assign between 2 and 4 members\. Received 1\./);

    const crossSectionMember = await executeCreateProjectGroup(db, buildRepContext(), {
      sectionId: UUID_SEC_ASSIGNED,
      projectId: UUID_PROJ,
      groupCode: 'G-CROSS',
      leaderStudentId: UUID_STU_1,
      memberStudentIds: [UUID_STU_1, UUID_STU_2],
    });
    assert.equal(crossSectionMember.success, false);
    assert.match(crossSectionMember.error ?? '', /Cross-section violation: Student "Student Two" is not enrolled in this section\./);

    const inactiveProjectDb = {
      from: (table: string) => {
        if (table === 'sections') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { id: UUID_SEC_ASSIGNED, academic_year_id: UUID_YEAR },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'projects') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: UUID_PROJ,
                    is_active: false,
                    submission_type: 'group',
                    file_rules: { min_group_size: 2, max_group_size: 4 },
                    targets: [{ academic_year_id: UUID_YEAR, section_id: UUID_SEC_ASSIGNED }],
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table query on inactive project: ${table}`);
      },
    } as unknown as SupabaseClient;

    const inactiveProj = await executeCreateProjectGroup(inactiveProjectDb, buildRepContext(), {
      sectionId: UUID_SEC_ASSIGNED,
      projectId: UUID_PROJ,
      groupCode: 'G-INACT',
      leaderStudentId: UUID_STU_1,
      memberStudentIds: [UUID_STU_1, UUID_STU_2],
    });
    assert.equal(inactiveProj.success, false);
    assert.equal(inactiveProj.error, 'Cannot create groups for an inactive project.');
  });

  it('rejects foreign-section delivery dispatch, acknowledgment, and manifest retrieval even when DB returns a record', async () => {
    let auditCalled = false;
    const foreignDeliveryDb = {
      rpc: async () => {
        auditCalled = true;
        throw new Error('Foreign delivery must fail before RPC');
      },
      from: (table: string) => {
        if (table === 'deliveries') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: UUID_DELIV_1,
                    section_id: UUID_SEC_FOREIGN,
                    project_id: UUID_PROJ,
                    status: 'prepared',
                    batch_count: 1,
                    items: [],
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table access: ${table}`);
      },
    } as unknown as SupabaseClient;

    const dispForeign = await executeDispatchDelivery(foreignDeliveryDb, buildRepContext(), UUID_DELIV_1);
    assert.equal(dispForeign.success, false);
    assert.match(dispForeign.error ?? '', new RegExp(`Forbidden: Access denied for section ${UUID_SEC_FOREIGN}`));

    const ackForeign = await executeAcknowledgeDelivery(foreignDeliveryDb, buildRepContext(), UUID_DELIV_1);
    assert.equal(ackForeign.success, false);
    assert.match(ackForeign.error ?? '', new RegExp(`Forbidden: Access denied for section ${UUID_SEC_FOREIGN}`));

    const manForeign = await executeGetDeliveryPackageManifest(foreignDeliveryDb, buildRepContext(), UUID_DELIV_1);
    assert.match(manForeign.error ?? '', new RegExp(`Forbidden: Access denied for section ${UUID_SEC_FOREIGN}`));

    assert.equal(auditCalled, false);
  });
});
