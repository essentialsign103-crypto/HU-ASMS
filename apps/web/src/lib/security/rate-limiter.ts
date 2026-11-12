// HU-ASMS: Web Application Rate Limiter (Phase 13 / Track B Hardening)
// Process-local sliding-window rate limiter for sensitive Server Actions and API endpoints.
// Operational Limitation: Stores request timestamps only in local Node.js process memory;
// counters are NOT shared across Vercel serverless instances, do NOT protect multi-instance
// deployments globally, and reset on cold starts.
// See docs/SECURITY_AND_HARDENING.md Section 5 for the required distributed rate-limiting architecture.

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  resetSec: number;
}

interface RateLimitBucket {
  timestamps: number[];
  expiresAt: number;
}

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_PRUNE_INTERVAL_MS = 60_000;

export class MemoryRateLimiter {
  private requests: Map<string, RateLimitBucket> = new Map();
  private lastPruneAt: number = 0;

  constructor(
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES,
    private readonly pruneIntervalMs: number = DEFAULT_PRUNE_INTERVAL_MS
  ) {}

  /**
   * Removes expired or empty buckets from memory.
   */
  public pruneExpired(now: number = Date.now()): number {
    let removed = 0;
    for (const [key, bucket] of this.requests.entries()) {
      if (bucket.expiresAt <= now || bucket.timestamps.length === 0) {
        this.requests.delete(key);
        removed += 1;
      }
    }
    this.lastPruneAt = now;
    return removed;
  }

  public size(): number {
    return this.requests.size;
  }

  public check(
    key: string,
    maxRequests: number,
    windowMs: number,
    now: number = Date.now()
  ): RateLimitCheckResult {
    const safeMaxRequests = Math.max(1, maxRequests);
    const safeWindowMs = Math.max(1, windowMs);
    const windowStart = now - safeWindowMs;

    if (now - this.lastPruneAt >= this.pruneIntervalMs || this.requests.size >= this.maxEntries) {
      this.pruneExpired(now);
    }

    const existing = this.requests.get(key);
    const validTimestamps = existing
      ? existing.timestamps.filter((t) => t > windowStart)
      : [];

    if (validTimestamps.length === 0 && existing) {
      this.requests.delete(key);
    }

    if (validTimestamps.length >= safeMaxRequests) {
      const oldest = validTimestamps[0];
      const resetSec = Math.max(1, Math.ceil((oldest + safeWindowMs - now) / 1000));
      // Refresh bucket expiration and LRU insertion order
      this.requests.delete(key);
      this.requests.set(key, {
        timestamps: validTimestamps,
        expiresAt: Math.max(existing?.expiresAt ?? 0, validTimestamps[validTimestamps.length - 1] + safeWindowMs),
      });
      return {
        allowed: false,
        remaining: 0,
        resetSec,
      };
    }

    // Evict oldest tracked bucket if capacity still full after pruning expired entries
    if (!this.requests.has(key) && this.requests.size >= this.maxEntries) {
      const oldestKey = this.requests.keys().next().value;
      if (oldestKey !== undefined) {
        this.requests.delete(oldestKey);
      }
    }

    validTimestamps.push(now);
    const expiresAt = Math.max(existing?.expiresAt ?? 0, now + safeWindowMs);
    // Maintain LRU insertion order so active keys are not evicted before idle keys
    this.requests.delete(key);
    this.requests.set(key, { timestamps: validTimestamps, expiresAt });

    return {
      allowed: true,
      remaining: safeMaxRequests - validTimestamps.length,
      resetSec: Math.ceil(safeWindowMs / 1000),
    };
  }

  public reset(key?: string): void {
    if (key) {
      this.requests.delete(key);
    } else {
      this.requests.clear();
      this.lastPruneAt = 0;
    }
  }
}

export const globalWebRateLimiter = new MemoryRateLimiter();

export interface DistributedRateLimitClient {
  rpc: (
    fn: string,
    params: Record<string, unknown>
  ) => PromiseLike<{ data: any; error: { message?: string } | null }>;
}

/**
 * Asserts that the client has not exceeded their rate limit (in-memory sliding window).
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

/**
 * Distributed rate-limit check backed by Postgres `check_and_increment_rate_limit` RPC.
 * Persists counters across Vercel serverless instances; fails closed in production if
 * backend credentials are unavailable or RPC fails.
 */
export async function assertDistributedRateLimit(
  key: string,
  maxRequests: number = 30,
  windowMs: number = 60000,
  actionName: string = 'action',
  adminClient?: DistributedRateLimitClient
): Promise<void> {
  const safeMaxRequests = Math.max(1, Math.floor(Number.isFinite(maxRequests) ? maxRequests : 1));
  const safeWindowMs = Math.max(1000, Math.floor(Number.isFinite(windowMs) ? windowMs : 1000));

  let client: DistributedRateLimitClient | undefined = adminClient;
  if (!client) {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && serviceRoleKey) {
      const { getSupabaseAdminClient } = await import('@hu-asms/database');
      client = getSupabaseAdminClient() as unknown as DistributedRateLimitClient;
    }
  }

  if (!client) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `Rate limiting service unavailable for ${actionName}. Configure distributed Supabase credentials.`
      );
    }
    assertRateLimit(key, safeMaxRequests, safeWindowMs, actionName);
    return;
  }

  const { data, error } = await client.rpc('check_and_increment_rate_limit', {
    p_key: key,
    p_max_requests: safeMaxRequests,
    p_window_ms: safeWindowMs,
  });

  if (error) {
    throw new Error(
      `Rate limit verification service unavailable for ${actionName}: ${error.message || 'RPC failure'}`
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.allowed !== 'boolean') {
    throw new Error(`Invalid rate limit verification response for ${actionName}.`);
  }

  if (!row.allowed) {
    const retryAfterMs = Number(row.retry_after_ms ?? 1000);
    const resetSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
    throw new Error(
      `Too many requests: Rate limit for ${actionName} exceeded. Please wait ${resetSec} seconds.`
    );
  }
}
