// HU-ASMS: Regression test — approval flow must not throw when SUPABASE_SERVICE_ROLE_KEY is absent
// Tests that assertDistributedRateLimit falls back to in-memory limiting instead of throwing
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertDistributedRateLimit, globalWebRateLimiter } from '../src/lib/security/rate-limiter';

// Helper to safely set env vars with proper typing
function setEnv(key: string, value: string): void {
  (process.env as Record<string, string>)[key] = value;
}

describe('Approval Rate Limit Fallback (Issue 1 — digest 3888652674)', () => {
  it('does not throw when SUPABASE_SERVICE_ROLE_KEY is absent in production', async () => {
    const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const originalNodeEnv = process.env.NODE_ENV;
    setEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    setEnv('NODE_ENV', 'production');

    globalWebRateLimiter.reset();

    try {
      await assertDistributedRateLimit(
        'test:approval-fallback',
        5,
        60000,
        'student registration review'
      );
      assert.ok(true, 'assertDistributedRateLimit did not throw');
    } catch (err: any) {
      assert.fail(
        `assertDistributedRateLimit threw in production fallback: ${err.message}`
      );
    } finally {
      if (originalKey !== undefined) setEnv('SUPABASE_SERVICE_ROLE_KEY', originalKey);
      if (originalNodeEnv !== undefined) setEnv('NODE_ENV', originalNodeEnv);
      globalWebRateLimiter.reset();
    }
  });

  it('in-memory fallback still enforces rate limits after threshold', async () => {
    const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const originalNodeEnv = process.env.NODE_ENV;
    setEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    setEnv('NODE_ENV', 'production');

    globalWebRateLimiter.reset();

    try {
      await assertDistributedRateLimit('test:rl-exhaust', 3, 60000, 'test action');
      await assertDistributedRateLimit('test:rl-exhaust', 3, 60000, 'test action');
      await assertDistributedRateLimit('test:rl-exhaust', 3, 60000, 'test action');

      await assert.rejects(
        () => assertDistributedRateLimit('test:rl-exhaust', 3, 60000, 'test action'),
        /Too many requests/
      );
    } finally {
      if (originalKey !== undefined) setEnv('SUPABASE_SERVICE_ROLE_KEY', originalKey);
      if (originalNodeEnv !== undefined) setEnv('NODE_ENV', originalNodeEnv);
      globalWebRateLimiter.reset();
    }
  });
});
