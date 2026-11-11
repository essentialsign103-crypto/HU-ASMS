// HU-ASMS: Phase 14 Step 2B Migration 05 Security Verification Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertSystemOwner,
  assertRepresentativeSectionScope,
  type UserSessionContext,
} from '../src/lib/auth/roles.js';

const MIGRATION_05_PATH = path.resolve(
  import.meta.dirname,
  '../../../supabase/migrations/20261110000005_security_hardening.sql'
);

describe('Phase 14 Step 2B — Migration 05 Security Hardening Logic Tests', () => {
  // Simulates profile update validation matching protect_profile_privileged_columns trigger
  function validateProfileUpdate(
    callerContext: UserSessionContext,
    oldRecord: { id: string; role: string; is_active: boolean },
    newRecord: { id: string; role: string; is_active: boolean }
  ) {
    if (callerContext.userId !== oldRecord.id && !callerContext.isOwner) {
      throw new Error('Forbidden: Cannot update another user profile.');
    }

    const roleChanged = oldRecord.role !== newRecord.role;
    const activeChanged = oldRecord.is_active !== newRecord.is_active;

    if ((roleChanged || activeChanged) && !callerContext.isOwner) {
      throw new Error(
        'Privilege Escalation Blocked: Only a System Owner can modify role or account activation status.'
      );
    }

    return true;
  }

  const mockRepContext: UserSessionContext = {
    userId: 'rep-user-uuid',
    profile: {
      id: 'rep-user-uuid',
      telegram_user_id: 11111111,
      full_name: 'Hamza Representative',
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
        id: 'asg-1',
        profile_id: 'rep-user-uuid',
        section_id: 'sec-3b',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  };

  const mockOwnerContext: UserSessionContext = {
    userId: 'owner-user-uuid',
    profile: {
      id: 'owner-user-uuid',
      telegram_user_id: 99999999,
      full_name: 'System Owner',
      email: 'owner@hu.edu.et',
      role: 'system_owner',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    isOwner: true,
    isRepresentative: true,
    assignments: [],
  };

  it('should allow representative to update their own non-privileged profile fields', () => {
    const oldRec = { id: 'rep-user-uuid', role: 'representative', is_active: true };
    const newRec = { id: 'rep-user-uuid', role: 'representative', is_active: true }; // non-privileged changes

    const allowed = validateProfileUpdate(mockRepContext, oldRec, newRec);
    assert.equal(allowed, true);
  });

  it('should strictly block representative from self-escalating role to system_owner', () => {
    const oldRec = { id: 'rep-user-uuid', role: 'representative', is_active: true };
    const maliciousRec = { id: 'rep-user-uuid', role: 'system_owner', is_active: true }; // Escalation attempt!

    assert.throws(
      () => validateProfileUpdate(mockRepContext, oldRec, maliciousRec),
      /Privilege Escalation Blocked: Only a System Owner can modify role/
    );
  });

  it('should strictly block representative from altering account is_active status', () => {
    const oldRec = { id: 'rep-user-uuid', role: 'representative', is_active: false };
    const tamperingRec = { id: 'rep-user-uuid', role: 'representative', is_active: true }; // Reactivation attempt!

    assert.throws(
      () => validateProfileUpdate(mockRepContext, oldRec, tamperingRec),
      /Privilege Escalation Blocked: Only a System Owner can modify role or account activation status/
    );
  });

  it('should allow verified System Owner to legitimately modify representative role and active status', () => {
    const oldRec = { id: 'rep-user-uuid', role: 'representative', is_active: true };
    const adminUpdatedRec = { id: 'rep-user-uuid', role: 'system_owner', is_active: true };

    const allowed = validateProfileUpdate(mockOwnerContext, oldRec, adminUpdatedRec);
    assert.equal(allowed, true);
  });

  it('should verify that representative section scope isolation rejects unassigned section access', () => {
    assert.throws(
      () => assertRepresentativeSectionScope(mockRepContext, 'sec-unassigned'),
      /Forbidden: Access denied for section sec-unassigned/
    );
    assert.doesNotThrow(() =>
      assertRepresentativeSectionScope(mockRepContext, 'sec-3b')
    );
  });

  it('should verify that System Owner bypasses section boundaries globally', () => {
    assert.doesNotThrow(() =>
      assertRepresentativeSectionScope(mockOwnerContext, 'sec-any-random-section')
    );
    assert.doesNotThrow(() => assertSystemOwner(mockOwnerContext));
  });
});

describe('Phase 14 — Migration 05 SQL Hardening Contract Verification', () => {
  const sql = fs.readFileSync(MIGRATION_05_PATH, 'utf-8');

  it('protect_profile_privileged_columns must be SECURITY INVOKER with immutable search_path', () => {
    const fnMatch = sql.match(
      /CREATE OR REPLACE FUNCTION public\.protect_profile_privileged_columns\(\)[\s\S]*?\$\$;/
    );
    assert.ok(fnMatch, 'protect_profile_privileged_columns function definition missing');
    const body = fnMatch[0];
    assert.match(body, /SECURITY INVOKER/);
    assert.doesNotMatch(body, /SECURITY DEFINER/);
    assert.match(body, /SET search_path = ''/);
    assert.match(body, /public\.auth_is_system_owner\(\)/);
    assert.match(body, /COALESCE\(auth\.role\(\), ''\) <> 'service_role'/);
  });

  it('admin_set_profile_status must NOT trust current_user inside SECURITY DEFINER and must check IF NOT FOUND', () => {
    const fnMatch = sql.match(
      /CREATE OR REPLACE FUNCTION public\.admin_set_profile_status\([\s\S]*?\$\$;/
    );
    assert.ok(fnMatch, 'admin_set_profile_status function definition missing');
    const body = fnMatch[0];
    assert.match(body, /SECURITY DEFINER/);
    assert.match(body, /SET search_path = ''/);
    assert.doesNotMatch(body, /current_user\s+NOT\s+IN/i);
    assert.match(body, /public\.auth_is_system_owner\(\)/);
    assert.match(body, /COALESCE\(auth\.role\(\), ''\) = 'service_role'/);
    assert.match(body, /session_user IN \('postgres', 'supabase_admin'\)/);
    assert.match(body, /IF NOT FOUND THEN/);
  });

  it('record_scoped_audit_log must enforce authenticated active staff identity, action allowlist, and section scope', () => {
    const fnMatch = sql.match(
      /CREATE OR REPLACE FUNCTION public\.record_scoped_audit_log\([\s\S]*?\$\$;/
    );
    assert.ok(fnMatch, 'record_scoped_audit_log function definition missing');
    const body = fnMatch[0];
    assert.match(body, /SECURITY DEFINER/);
    assert.match(body, /SET search_path = ''/);
    assert.match(body, /v_actor_id := auth\.uid\(\)/);
    assert.match(body, /FROM public\.profiles p/);
    assert.match(body, /GROUP_PRECREATED/);
    assert.match(body, /TEACHER_DELIVERY_PREPARED/);
    assert.match(body, /TEACHER_DELIVERY_DISPATCHED/);
    assert.match(body, /TEACHER_DELIVERY_ACKNOWLEDGED/);
    assert.match(body, /public\.auth_is_system_owner\(\) OR public\.auth_is_rep_for_section\(v_section_id\)/);
  });

  it('revokes anon table/sequence privileges, default privileges, TRUNCATE, and direct audit_logs writes from authenticated', () => {
    assert.match(sql, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;/);
    assert.match(sql, /REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;/);
    assert.match(
      sql,
      /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;/
    );
    assert.match(
      sql,
      /REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM authenticated;/
    );
    assert.match(
      sql,
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.audit_logs FROM authenticated;/
    );
    assert.match(
      sql,
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.identity_change_history FROM authenticated;/
    );
    assert.match(
      sql,
      /GRANT UPDATE \(full_name, phone, telegram_username\) ON public\.profiles TO authenticated;/
    );
    assert.match(
      sql,
      /REVOKE ALL ON FUNCTION public\.record_scoped_audit_log\(TEXT, TEXT, UUID, JSONB\) FROM PUBLIC;/
    );
  });
});
