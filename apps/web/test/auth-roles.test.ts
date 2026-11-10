// HU-ASMS: Phase 11 Authentication & Role Guard Unit Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveUserSessionContext,
  assertSystemOwner,
  assertRepresentativeSectionScope,
  type UserSessionContext,
} from '../src/lib/auth/roles.js';

describe('Phase 11 — Web Dashboard Authentication & Role Guard Tests', () => {

  const mockOwnerProfile = {
    id: 'user-owner-1',
    telegram_user_id: 11111111,
    full_name: 'Dr. System Owner',
    role: 'owner',
    is_active: true,
  };

  const mockRepProfile = {
    id: 'user-rep-1',
    telegram_user_id: 22222222,
    full_name: 'Hamza Representative',
    role: 'representative',
    is_active: true,
  };

  const mockInactiveRepProfile = {
    id: 'user-inactive-1',
    telegram_user_id: 33333333,
    full_name: 'Deactivated Rep',
    role: 'representative',
    is_active: false,
  };

  const mockStudentProfile = {
    id: 'user-student-1',
    telegram_user_id: 44444444,
    full_name: 'Regular Student',
    role: 'student',
    is_active: true,
  };

  const mockRepAssignments = [
    {
      id: 'assign-1',
      profile_id: 'user-rep-1',
      section_id: 'sec-3b',
      is_active: true,
      section: {
        id: 'sec-3b',
        name: 'Section B',
        academic_year_id: 'year-3',
      },
    },
  ];

  function createMockSupabase(user: any, profile: any, assignments: any[] = []) {
    return {
      auth: {
        getUser: async () => ({
          data: { user },
          error: user ? null : new Error('No session'),
        }),
      },
      from: (table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: (_col: string, val: string) => ({
                maybeSingle: async () => {
                  if (profile && profile.id === val) {
                    return { data: profile, error: null };
                  }
                  return { data: null, error: null };
                },
              }),
            }),
          };
        }

        if (table === 'representative_assignments') {
          return {
            select: () => ({
              eq: (_col: string, profId: string) => ({
                eq: (_col2: string, isActive: boolean) => {
                  const filtered = assignments.filter(
                    (a) => a.profile_id === profId && a.is_active === isActive
                  );
                  return Promise.resolve({ data: filtered, error: null });
                },
              }),
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    } as any;
  }

  // ---------------------------------------------------------------------------
  // 1. Session Context Resolution
  // ---------------------------------------------------------------------------
  it('should resolve System Owner context with full admin privileges', async () => {
    const mockClient = createMockSupabase(
      { id: 'user-owner-1', email: 'owner@haramaya.edu.et' },
      mockOwnerProfile
    );

    const context = await resolveUserSessionContext(mockClient);

    assert.ok(context);
    assert.equal(context.isOwner, true);
    assert.equal(context.isRepresentative, true);
    assert.equal(context.profile?.role, 'owner');
    assert.equal(context.profile?.full_name, 'Dr. System Owner');
  });

  it('should resolve Section Representative context with assigned section scopes', async () => {
    const mockClient = createMockSupabase(
      { id: 'user-rep-1', email: 'rep@haramaya.edu.et' },
      mockRepProfile,
      mockRepAssignments
    );

    const context = await resolveUserSessionContext(mockClient);

    assert.ok(context);
    assert.equal(context.isOwner, false);
    assert.equal(context.isRepresentative, true);
    assert.equal(context.assignments.length, 1);
    assert.equal(context.assignments[0].section_id, 'sec-3b');
  });

  it('should reject inactive profiles from claiming role privileges', async () => {
    const mockClient = createMockSupabase(
      { id: 'user-inactive-1', email: 'inactive@haramaya.edu.et' },
      mockInactiveRepProfile
    );

    const context = await resolveUserSessionContext(mockClient);

    assert.ok(context);
    assert.equal(context.isOwner, false);
    assert.equal(context.isRepresentative, false);
    assert.equal(context.profile, null);
  });

  it('should return null when no authenticated session exists', async () => {
    const mockClient = createMockSupabase(null, null);
    const context = await resolveUserSessionContext(mockClient);
    assert.equal(context, null);
  });

  // ---------------------------------------------------------------------------
  // 2. Security Guard: assertSystemOwner
  // ---------------------------------------------------------------------------
  it('should allow System Owner to pass assertSystemOwner guard', () => {
    const ownerContext: UserSessionContext = {
      userId: 'user-owner-1',
      profile: mockOwnerProfile as any,
      isOwner: true,
      isRepresentative: true,
      assignments: [],
    };

    assert.doesNotThrow(() => assertSystemOwner(ownerContext));
  });

  it('should throw Forbidden error when a representative attempts to access owner guard', () => {
    const repContext: UserSessionContext = {
      userId: 'user-rep-1',
      profile: mockRepProfile as any,
      isOwner: false,
      isRepresentative: true,
      assignments: mockRepAssignments as any,
    };

    assert.throws(
      () => assertSystemOwner(repContext),
      /Forbidden: System Owner privileges required/
    );
  });

  it('should throw Forbidden error when unauthenticated user attempts to access owner guard', () => {
    assert.throws(
      () => assertSystemOwner(null),
      /Forbidden: System Owner privileges required/
    );
  });

  // ---------------------------------------------------------------------------
  // 3. Security Guard: assertRepresentativeSectionScope
  // ---------------------------------------------------------------------------
  it('should grant System Owner global access to any section scope', () => {
    const ownerContext: UserSessionContext = {
      userId: 'user-owner-1',
      profile: mockOwnerProfile as any,
      isOwner: true,
      isRepresentative: true,
      assignments: [],
    };

    // Owner has override on any arbitrary section
    assert.doesNotThrow(() => assertRepresentativeSectionScope(ownerContext, 'sec-3b'));
    assert.doesNotThrow(() => assertRepresentativeSectionScope(ownerContext, 'sec-3a'));
  });

  it('should allow a representative to access their assigned section scope', () => {
    const repContext: UserSessionContext = {
      userId: 'user-rep-1',
      profile: mockRepProfile as any,
      isOwner: false,
      isRepresentative: true,
      assignments: mockRepAssignments as any,
    };

    assert.doesNotThrow(() => assertRepresentativeSectionScope(repContext, 'sec-3b'));
  });

  it('should reject a representative from accessing an unassigned section scope', () => {
    const repContext: UserSessionContext = {
      userId: 'user-rep-1',
      profile: mockRepProfile as any,
      isOwner: false,
      isRepresentative: true,
      assignments: mockRepAssignments as any,
    };

    assert.throws(
      () => assertRepresentativeSectionScope(repContext, 'sec-3a'),
      /Forbidden: Access denied for section sec-3a/
    );
  });
});
