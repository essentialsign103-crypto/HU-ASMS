// HU-ASMS: Phase 13 Telegram Bot Rate Limiter Unit Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SlidingWindowRateLimiter,
  createRateLimiterMiddleware,
} from '../src/middleware/rate-limit.middleware.js';

describe('Phase 13 — Bot Rate Limiter & Abuse Prevention Tests', () => {
  it('should allow requests within the permitted threshold', () => {
    const limiter = new SlidingWindowRateLimiter(1000, 3); // 3 requests per 1000ms

    const res1 = limiter.isAllowed('user-100');
    assert.equal(res1.allowed, true);
    assert.equal(res1.count, 1);

    const res2 = limiter.isAllowed('user-100');
    assert.equal(res2.allowed, true);
    assert.equal(res2.count, 2);

    const res3 = limiter.isAllowed('user-100');
    assert.equal(res3.allowed, true);
    assert.equal(res3.count, 3);
  });

  it('should reject requests exceeding the threshold and calculate retry-after duration', () => {
    const limiter = new SlidingWindowRateLimiter(2000, 2); // 2 requests per 2000ms

    limiter.isAllowed('user-200');
    limiter.isAllowed('user-200');

    // 3rd request should be blocked
    const res3 = limiter.isAllowed('user-200');
    assert.equal(res3.allowed, false);
    assert.ok(res3.retryAfterSec > 0 && res3.retryAfterSec <= 2);
  });

  it('should track separate limits for different users independently', () => {
    const limiter = new SlidingWindowRateLimiter(5000, 2);

    // User A hits limit
    limiter.isAllowed('user-A');
    limiter.isAllowed('user-A');
    const blockedA = limiter.isAllowed('user-A');
    assert.equal(blockedA.allowed, false);

    // User B should still be allowed
    const allowedB = limiter.isAllowed('user-B');
    assert.equal(allowedB.allowed, true);
  });

  it('should reset limits when reset() is called', () => {
    const limiter = new SlidingWindowRateLimiter(5000, 1);

    limiter.isAllowed('user-300');
    assert.equal(limiter.isAllowed('user-300').allowed, false);

    limiter.reset('user-300');
    assert.equal(limiter.isAllowed('user-300').allowed, true);
  });

  it('should prune stale entries without error', () => {
    const limiter = new SlidingWindowRateLimiter(1, 10);
    limiter.isAllowed('user-old');

    // Wait slightly so timestamp is older than windowMs
    const start = Date.now();
    while (Date.now() - start < 5) {
      // Busy wait 5ms
    }

    limiter.prune();
    // After pruning, subsequent request starts clean
    const res = limiter.isAllowed('user-old');
    assert.equal(res.allowed, true);
    assert.equal(res.count, 1);
  });

  it('grammY middleware should invoke next() when within limit and reply when throttled', async () => {
    const middleware = createRateLimiterMiddleware({
      windowMs: 5000,
      maxRequests: 2,
      keyGenerator: (ctx: any) => ctx.from?.id,
    });

    let nextCalled = 0;
    const repliedMessages: string[] = [];

    const mockCtx: any = {
      from: { id: 88888888 },
      reply: async (msg: string) => {
        repliedMessages.push(msg);
      },
    };

    const next = async () => {
      nextCalled++;
    };

    // Request 1: allowed
    await middleware(mockCtx, next);
    assert.equal(nextCalled, 1);
    assert.equal(repliedMessages.length, 0);

    // Request 2: allowed
    await middleware(mockCtx, next);
    assert.equal(nextCalled, 2);
    assert.equal(repliedMessages.length, 0);

    // Request 3: throttled
    await middleware(mockCtx, next);
    assert.equal(nextCalled, 2); // next NOT called
    assert.equal(repliedMessages.length, 1);
    assert.match(repliedMessages[0], /Rate limit exceeded/);
  });
});
