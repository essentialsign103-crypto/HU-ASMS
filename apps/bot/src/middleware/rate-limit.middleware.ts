// HU-ASMS: Telegram Bot Rate Limiting Middleware (Phase 13)
// In-memory sliding-window rate limiter protecting against spam, request flooding, and upload abuse

import type { Context, NextFunction } from 'grammy';

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  message?: string;
  keyGenerator?: (ctx: Context) => string | number | undefined;
}

export class SlidingWindowRateLimiter {
  private hits: Map<string, number[]> = new Map();

  constructor(
    private windowMs: number = 10000,
    private maxRequests: number = 10
  ) {}

  /**
   * Evaluates if a key is within the allowed request rate.
   */
  public isAllowed(key: string): { allowed: boolean; count: number; retryAfterSec: number } {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    const timestamps = this.hits.get(key) || [];
    // Remove expired timestamps outside the sliding window
    const validTimestamps = timestamps.filter((t) => t > windowStart);

    if (validTimestamps.length >= this.maxRequests) {
      const oldestValid = validTimestamps[0];
      const retryAfterSec = Math.ceil((oldestValid + this.windowMs - now) / 1000);
      return { allowed: false, count: validTimestamps.length, retryAfterSec };
    }

    validTimestamps.push(now);
    this.hits.set(key, validTimestamps);
    return { allowed: true, count: validTimestamps.length, retryAfterSec: 0 };
  }

  /**
   * Cleans up stale entries to prevent memory growth.
   */
  public prune(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [key, timestamps] of this.hits.entries()) {
      const valid = timestamps.filter((t) => t > windowStart);
      if (valid.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, valid);
      }
    }
  }

  /**
   * Resets hit history for a specific key (useful for tests).
   */
  public reset(key?: string): void {
    if (key) {
      this.hits.delete(key);
    } else {
      this.hits.clear();
    }
  }
}

/**
 * Creates grammY middleware for sliding-window rate limiting.
 */
export function createRateLimiterMiddleware(options: Partial<RateLimitOptions> = {}) {
  const windowMs = options.windowMs || 10000; // 10 seconds
  const maxRequests = options.maxRequests || 10; // 10 requests / 10s
  const message =
    options.message ||
    '⚠️ Rate limit exceeded. Please wait a moment before sending more commands.';
  const keyGen = options.keyGenerator || ((ctx: Context) => ctx.from?.id);

  const limiter = new SlidingWindowRateLimiter(windowMs, maxRequests);

  // Periodically clean up stale entries every 5 minutes
  if (typeof setInterval !== 'undefined') {
    const timer = setInterval(() => limiter.prune(), 300000);
    if (timer.unref) {
      timer.unref();
    }
  }

  return async (ctx: Context, next: NextFunction) => {
    const key = keyGen(ctx);
    if (!key) {
      return next();
    }

    const check = limiter.isAllowed(String(key));
    if (!check.allowed) {
      await ctx.reply(`${message}\n(Try again in ${check.retryAfterSec}s)`);
      return;
    }

    return next();
  };
}
