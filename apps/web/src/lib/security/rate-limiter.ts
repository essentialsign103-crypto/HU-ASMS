// HU-ASMS: Web Application Rate Limiter (Phase 13)
// In-memory sliding-window rate limiter for sensitive Server Actions and API endpoints

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  resetSec: number;
}

class MemoryRateLimiter {
  private requests: Map<string, number[]> = new Map();

  public check(key: string, maxRequests: number, windowMs: number): RateLimitCheckResult {
    const now = Date.now();
    const windowStart = now - windowMs;

    const timestamps = this.requests.get(key) || [];
    const validTimestamps = timestamps.filter((t) => t > windowStart);

    if (validTimestamps.length >= maxRequests) {
      const oldest = validTimestamps[0];
      const resetSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      return {
        allowed: false,
        remaining: 0,
        resetSec,
      };
    }

    validTimestamps.push(now);
    this.requests.set(key, validTimestamps);

    return {
      allowed: true,
      remaining: maxRequests - validTimestamps.length,
      resetSec: Math.ceil(windowMs / 1000),
    };
  }

  public reset(key?: string): void {
    if (key) {
      this.requests.delete(key);
    } else {
      this.requests.clear();
    }
  }
}

export const globalWebRateLimiter = new MemoryRateLimiter();

/**
 * Asserts that the client has not exceeded their rate limit.
 * Throws an Error with 429 details if rate limit is exceeded.
 */
export function assertRateLimit(
  key: string,
  maxRequests: number = 30,
  windowMs: number = 60000,
  actionName: string = 'action'
): void {
  const result = globalWebRateLimiter.check(key, maxRequests, windowMs);
  if (!result.allowed) {
    throw new Error(
      `Too many requests: Rate limit for ${actionName} exceeded. Please wait ${result.resetSec} seconds.`
    );
  }
}
