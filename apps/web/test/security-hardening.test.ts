// HU-ASMS: Phase 13 Web Security Hardening & Input Sanitization Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFilename } from '@hu-asms/validation';
import {
  globalWebRateLimiter,
  assertRateLimit,
} from '../src/lib/security/rate-limiter.js';
import {
  assertSystemOwner,
  assertRepresentativeSectionScope,
  type UserSessionContext,
} from '../src/lib/auth/roles.js';

describe('Phase 13 — Security Hardening, Input Sanitization & Web Protection Tests', () => {
  describe('1. Filename Sanitization & Directory Traversal Protection', () => {
    it('should strip directory traversal sequences (../ and ..\\)', () => {
      const malicious = '../../../../etc/passwd.pdf';
      const clean = sanitizeFilename(malicious);

      assert.equal(clean.includes('..'), false);
      assert.equal(clean.includes('/'), false);
      assert.equal(clean.includes('\\'), false);
      assert.equal(clean, 'etc_passwd.pdf');
    });

    it('should strip Windows absolute drive paths and colons', () => {
      const malicious = 'C:\\Windows\\System32\\cmd.exe.zip';
      const clean = sanitizeFilename(malicious);

      assert.equal(clean.includes(':'), false);
      assert.equal(clean.includes('\\'), false);
      assert.equal(clean, 'C_Windows_System32_cmd.exe.zip');
    });

    it('should strip null bytes and non-printable control characters', () => {
      const malicious = 'normal_report\x00_hidden.pdf';
      const clean = sanitizeFilename(malicious);

      assert.equal(clean.includes('\x00'), false);
      assert.equal(clean, 'normal_report_hidden.pdf');
    });

    it('should truncate excessively long filenames while preserving the extension', () => {
      const veryLong = 'a'.repeat(200) + '.docx';
      const clean = sanitizeFilename(veryLong);

      assert.ok(clean.length <= 85);
      assert.ok(clean.endsWith('.docx'));
    });

    it('should provide safe fallback for empty or symbol-only names', () => {
      assert.equal(sanitizeFilename(''), 'unnamed_file');
      assert.equal(sanitizeFilename('   '), 'submission_file');
      assert.equal(sanitizeFilename('...'), 'submission_file');
    });
  });

  describe('2. Web Action Rate Limiter', () => {
    it('should allow requests within threshold and calculate remaining budget', () => {
      globalWebRateLimiter.reset('user-web-1');

      const res1 = globalWebRateLimiter.check('user-web-1', 3, 5000);
      assert.equal(res1.allowed, true);
      assert.equal(res1.remaining, 2);

      const res2 = globalWebRateLimiter.check('user-web-1', 3, 5000);
      assert.equal(res2.allowed, true);
      assert.equal(res2.remaining, 1);
    });

    it('should reject requests exceeding threshold with reset countdown', () => {
      globalWebRateLimiter.reset('user-web-burst');

      // 2 requests allowed
      globalWebRateLimiter.check('user-web-burst', 2, 5000);
      globalWebRateLimiter.check('user-web-burst', 2, 5000);

      // 3rd should fail
      const res3 = globalWebRateLimiter.check('user-web-burst', 2, 5000);
      assert.equal(res3.allowed, false);
      assert.equal(res3.remaining, 0);
      assert.ok(res3.resetSec > 0 && res3.resetSec <= 5);
    });

    it('assertRateLimit should throw Error with 429 details when limit is exceeded', () => {
      globalWebRateLimiter.reset('rep-sign-url');

      assertRateLimit('rep-sign-url', 1, 5000, 'signed URL generation');

      assert.throws(
        () => assertRateLimit('rep-sign-url', 1, 5000, 'signed URL generation'),
        /Too many requests: Rate limit for signed URL generation exceeded/
      );
    });
  });

  describe('3. Privilege Escalation & Cross-Section Isolation Review', () => {
    const mockRep: UserSessionContext = {
      userId: 'rep-99',
      profile: {
        id: 'rep-99',
        telegram_user_id: 123456,
        full_name: 'Test Rep',
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
          profile_id: 'rep-99',
          section_id: 'sec-authorized',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    };

    it('should block representative from calling assertSystemOwner', () => {
      assert.throws(
        () => assertSystemOwner(mockRep),
        /Forbidden: System Owner privileges required/
      );
    });

    it('should block representative from accessing unassigned section', () => {
      assert.throws(
        () => assertRepresentativeSectionScope(mockRep, 'sec-unauthorized'),
        /Forbidden: Access denied for section sec-unauthorized/
      );
    });

    it('should allow representative to access assigned section', () => {
      assert.doesNotThrow(() =>
        assertRepresentativeSectionScope(mockRep, 'sec-authorized')
      );
    });
  });
});
