interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const globalForRateLimit = globalThis as typeof globalThis & {
  __roomRelayRateLimits?: Map<string, RateLimitBucket>;
};

const buckets =
  globalForRateLimit.__roomRelayRateLimits ??
  (globalForRateLimit.__roomRelayRateLimits = new Map<string, RateLimitBucket>());

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * A small in-process limiter. It provides basic abuse resistance for the demo;
 * a multi-instance deployment should replace it with a shared store (for
 * example Redis or a database-backed limiter).
 */
export function consumeRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return {
      allowed: true,
      remaining: options.limit - 1,
      retryAfterSeconds: Math.ceil(options.windowMs / 1000),
    };
  }

  existing.count += 1;

  if (existing.count > options.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((existing.resetAt - now) / 1000),
      ),
    };
  }

  return {
    allowed: true,
    remaining: options.limit - existing.count,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

export function clearRateLimitsForTests(): void {
  buckets.clear();
}
