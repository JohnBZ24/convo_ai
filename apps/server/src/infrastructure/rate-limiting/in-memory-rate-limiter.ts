import type {
  RateLimitDecision,
  RateLimiter,
} from "~/core/application/ports/rate-limiter.port";

interface Window {
  count: number;
  /** Epoch millis at which this window expires and the budget resets. */
  resetAt: number;
}

/**
 * A fixed-window counter held in this process's memory.
 *
 * KNOWN LIMITATION, carried deliberately: the counter is per INSTANCE. Run two
 * servers behind a load balancer and the effective limit becomes
 * `limit x instances`. That is acceptable for one dev instance and a demo, and
 * it is why the port exists - moving to Redis is a new class in this folder and
 * one line in the container, not a change to any use case.
 *
 * Fixed window rather than sliding: at the boundary a caller can spend two
 * windows' budget back to back. The limits here protect a spend cap and a
 * prompt-injectable endpoint from a runaway loop, and a 2x burst at one instant
 * does neither any harm - whereas a sliding window costs a timestamp list per
 * key.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, Window>();

  /** Sweep expired keys once every this many consume() calls. */
  private static readonly SWEEP_EVERY = 500;
  private sinceSweep = 0;

  async consume(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitDecision> {
    const now = Date.now();
    this.maybeSweep(now);

    const existing = this.windows.get(key);
    const window =
      existing && existing.resetAt > now
        ? existing
        : { count: 0, resetAt: now + windowMs };

    // Read the budget BEFORE spending it, so a rejected request does not also
    // extend the window it was rejected by.
    if (window.count >= limit) {
      this.windows.set(key, window);
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAt: new Date(window.resetAt),
      };
    }

    window.count += 1;
    this.windows.set(key, window);

    return {
      allowed: true,
      limit,
      remaining: limit - window.count,
      resetAt: new Date(window.resetAt),
    };
  }

  /**
   * Without this the map is an unbounded leak: every user who ever hit a
   * limited endpoint keeps a key forever. Swept on a call counter rather than a
   * timer so an idle process holds no interval open.
   */
  private maybeSweep(now: number) {
    this.sinceSweep += 1;
    if (this.sinceSweep < InMemoryRateLimiter.SWEEP_EVERY) return;

    this.sinceSweep = 0;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
