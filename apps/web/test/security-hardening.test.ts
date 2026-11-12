// HU-ASMS: Phase 13 Web Security Hardening & Input Sanitization Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFilename } from '@hu-asms/validation';
import {
  MemoryRateLimiter,
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

    it('MemoryRateLimiter.pruneExpired evicts expired buckets and updates size', () => {
      const limiter = new MemoryRateLimiter(100, 60_000);
      assert.equal(limiter.check('key-a', 2, 1000, 1000).allowed, true);
      assert.equal(limiter.check('key-b', 2, 5000, 1000).allowed, true);
      assert.equal(limiter.size(), 2);

      const evictedAt2500 = limiter.pruneExpired(2500);
      assert.equal(evictedAt2500, 1);
      assert.equal(limiter.size(), 1);

      const evictedAt7000 = limiter.pruneExpired(7000);
      assert.equal(evictedAt7000, 1);
      assert.equal(limiter.size(), 0);
    });

    it('MemoryRateLimiter automatically sweeps expired entries after pruneIntervalMs and bounds capacity via LRU', () => {
      const limiter = new MemoryRateLimiter(3, 500);

      // Fill capacity=3 with differing expiries
      assert.equal(limiter.check('k1', 2, 200, 1000).allowed, true);
      assert.equal(limiter.check('k2', 2, 5000, 1100).allowed, true);
      assert.equal(limiter.check('k3', 2, 5000, 1200).allowed, true);
      assert.equal(limiter.size(), 3);

      // At t=1600 (>= 1000 + 500), k1 is expired; check('k4') triggers periodic sweep + keeps within capacity 3
      assert.equal(limiter.check('k4', 2, 5000, 1600).allowed, true);
      assert.equal(limiter.size(), 3);

      // Touch k2 so k3 becomes least recently used among active entries [k4, k2] vs oldest k3
      assert.equal(limiter.check('k2', 2, 5000, 1650).allowed, true);
      // Inserting k5 when all 3 (k3, k4, k2) are unexpired must evict LRU (k3) and keep size capped at 3
      assert.equal(limiter.check('k5', 2, 5000, 1700).allowed, true);
      assert.equal(limiter.size(), 3);

      // k3's earlier hit should have been evicted, so its quota starts fresh (remaining=1 for max=2)
      const k3Res = limiter.check('k3', 2, 5000, 1750);
      assert.equal(k3Res.allowed, true);
      assert.equal(k3Res.remaining, 1);
      assert.equal(limiter.size(), 3);
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
