// HU-ASMS: Telegram Bot Distributed & In-Memory Rate Limiting Middleware (Phase 13 + Phase C)
// Supports Postgres-backed distributed sliding-window rate limiting across serverless instances.

import type { Context, NextFunction } from 'grammy';
import { getSupabaseAdminClient, type SupabaseClient } from '@hu-asms/database';
import { sanitizeLogData } from '../utils/error-handler.js';

export interface RateLimitCheckResult {
  allowed: boolean;
  count?: number;
  remaining?: number;
  retryAfterSec: number;
}

export interface AsyncRateLimitStore {
  checkAndIncrement(
    key: string,
    maxRequests: number,
    windowMs: number
  ): Promise<RateLimitCheckResult>;
}

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  message?: string;
  keyPrefix?: string;
  keyGenerator?: (ctx: Context) => string | number | undefined;
  store?: AsyncRateLimitStore;
  inMemoryOnly?: boolean;
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
      const retryAfterSec = Math.max(1, Math.ceil((oldestValid + this.windowMs - now) / 1000));
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
 * Postgres-backed distributed rate-limit store invoking atomic `check_and_increment_rate_limit` RPC.
 */
export class SupabaseRateLimitStore implements AsyncRateLimitStore {
  constructor(private client: SupabaseClient) {}

  async checkAndIncrement(
    key: string,
    maxRequests: number,
    windowMs: number
  ): Promise<RateLimitCheckResult> {
    const { data, error } = await this.client.rpc('check_and_increment_rate_limit', {
      p_key: key,
      p_max_requests: maxRequests,
      p_window_ms: windowMs,
    });

    if (error) {
      throw new Error(`Distributed rate limit check failed: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== 'boolean') {
      throw new Error('Distributed rate limit RPC returned an invalid response.');
    }

    const retryAfterMs = Number(row.retry_after_ms ?? 0);
    return {
      allowed: row.allowed,
      remaining: typeof row.remaining === 'number' ? row.remaining : undefined,
      retryAfterSec: row.allowed ? 0 : Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }
}

function hasSupabaseServiceCredentials(): boolean {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(url && serviceKey);
}

/**
 * Creates grammY middleware for sliding-window rate limiting.
 * Uses distributed Postgres store in production / whenever Supabase service credentials exist,
 * falling back to in-memory sliding windows ONLY in non-production isolated environments.
 */
export function createRateLimiterMiddleware(options: Partial<RateLimitOptions> = {}) {
  const windowMs = options.windowMs || 10000; // 10 seconds
  const maxRequests = options.maxRequests || 10; // 10 requests / 10s
  const keyPrefix = options.keyPrefix ?? 'tg:';
  const message =
    options.message ||
    '⚠️ Rate limit exceeded. Please wait a moment before sending more commands.';
  const keyGen = options.keyGenerator || ((ctx: Context) => ctx.from?.id);

  let store: AsyncRateLimitStore | null = options.store ?? null;
  let localLimiter: SlidingWindowRateLimiter | null = null;

  if (!store) {
    if (!options.inMemoryOnly && hasSupabaseServiceCredentials()) {
      store = new SupabaseRateLimitStore(getSupabaseAdminClient());
    } else if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Distributed rate-limit store is required in production. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or pass options.store.'
      );
    } else {
      localLimiter = new SlidingWindowRateLimiter(windowMs, maxRequests);
      if (typeof setInterval !== 'undefined') {
        const timer = setInterval(() => localLimiter?.prune(), 300000);
        if (timer.unref) {
          timer.unref();
        }
      }
    }
  }

  return async (ctx: Context, next: NextFunction) => {
    const rawKey = keyGen(ctx);
    if (!rawKey) {
      return next();
    }

    const scopedKey = `${keyPrefix}${String(rawKey)}`;

    if (store) {
      try {
        const check = await store.checkAndIncrement(scopedKey, maxRequests, windowMs);
        if (!check.allowed) {
          await ctx.reply(`${message}\n(Try again in ${check.retryAfterSec}s)`);
          return;
        }
        return next();
      } catch (err) {
        console.error('Distributed bot rate limiter error (failing closed):', sanitizeLogData(err));
        await ctx.reply('⚠️ Service is temporarily busy. Please try again in a moment.');
        return;
      }
    }

    const check = localLimiter!.isAllowed(String(rawKey));
    if (!check.allowed) {
      await ctx.reply(`${message}\n(Try again in ${check.retryAfterSec}s)`);
      return;
    }

    return next();
  };
}
