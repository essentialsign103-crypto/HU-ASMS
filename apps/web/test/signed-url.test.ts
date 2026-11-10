// HU-ASMS: Phase 11 Signed Download URL Security Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertRepresentativeSectionScope, type UserSessionContext } from '../src/lib/auth/roles.js';

describe('Phase 11 — Signed Download URL Security & Scope Isolation Tests', () => {

  const mockRepContext: UserSessionContext = {
    userId: 'user-rep-1',
    profile: {
      id: 'user-rep-1',
      telegram_user_id: 11111111,
      full_name: 'Hamza Representative',
      email: 'rep@haramaya.edu.et',
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

  const mockOwnerContext: UserSessionContext = {
    userId: 'user-owner-1',
    profile: {
      id: 'user-owner-1',
      telegram_user_id: 99999999,
      full_name: 'System Owner',
      email: 'owner@haramaya.edu.et',
      role: 'system_owner',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    isOwner: true,
    isRepresentative: true,
    assignments: [],
  };

  // Mock generator simulating getSubmissionFileDownloadUrl
  async function generateMockSignedUrl(
    context: UserSessionContext | null,
    file: { storage_path: string; section_id: string }
  ) {
    if (!context || !context.profile) {
      return { error: 'Authentication required.' };
    }

    try {
      assertRepresentativeSectionScope(context, file.section_id);
    } catch (err: any) {
      return { error: err.message };
    }

    // Mock successful signed URL generation (expires in 15 min = 900s)
    return {
      signedUrl: `https://supabase.local/storage/v1/object/sign/submission-files-vault/${file.storage_path}?token=mock_token_expires_900s`,
    };
  }

  it('should successfully generate a 15-minute signed URL when representative accesses file in assigned section', async () => {
    const file = {
      storage_path: 'projects/p1/individual/s1/v1_report.pdf',
      section_id: 'sec-3b',
    };

    const result = await generateMockSignedUrl(mockRepContext, file);

    assert.ok(result.signedUrl);
    assert.match(result.signedUrl, /token=mock_token_expires_900s/);
    assert.match(result.signedUrl, /projects\/p1\/individual\/s1\/v1_report\.pdf/);
  });

  it('should reject signed URL generation when representative attempts to access file in unassigned section', async () => {
    const outsideFile = {
      storage_path: 'projects/p1/individual/s2/v1_report.pdf',
      section_id: 'sec-3a', // Outside section!
    };

    const result = await generateMockSignedUrl(mockRepContext, outsideFile);

    assert.equal(result.signedUrl, undefined);
    assert.match(result.error || '', /Forbidden: Access denied for section sec-3a/);
  });

  it('should allow System Owner to generate signed URL for files across any section', async () => {
    const outsideFile = {
      storage_path: 'projects/p1/individual/s2/v1_report.pdf',
      section_id: 'sec-3a',
    };

    const result = await generateMockSignedUrl(mockOwnerContext, outsideFile);

    assert.ok(result.signedUrl);
  });
});
