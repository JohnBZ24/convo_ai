export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** When the current window ends and the budget is restored. */
  resetAt: Date;
}

/**
 * A counter with a window, keyed by whatever the caller decides identifies the
 * subject.
 *
 * Deliberately NOT "rate limit this request": the port knows nothing about
 * HTTP, so the same limiter serves a route guard now and anything else later.
 * Keys are always derived from the AUTHENTICATED user, never from an IP or a
 * header - the tools endpoint is reachable by a model that a user may have
 * prompt-injected, and anything the caller supplies, the caller can vary.
 */
export interface RateLimiter {
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitDecision>;
}
