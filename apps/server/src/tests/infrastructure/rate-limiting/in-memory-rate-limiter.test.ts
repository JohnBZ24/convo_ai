import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRateLimiter } from "~/infrastructure/rate-limiting/in-memory-rate-limiter";

const WINDOW_MS = 60_000;

let limiter: InMemoryRateLimiter;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-20T10:00:00.000Z"));
  limiter = new InMemoryRateLimiter();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("InMemoryRateLimiter", () => {
  it("allows exactly `limit` requests, then refuses", async () => {
    const decisions = [];
    for (let i = 0; i < 4; i += 1) {
      decisions.push(await limiter.consume("user-1", 3, WINDOW_MS));
    }

    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false]);
    expect(decisions.map((d) => d.remaining)).toEqual([2, 1, 0, 0]);
  });

  it("keys are independent, so one user cannot exhaust another's budget", async () => {
    await limiter.consume("user-1", 1, WINDOW_MS);

    expect((await limiter.consume("user-1", 1, WINDOW_MS)).allowed).toBe(false);
    expect((await limiter.consume("user-2", 1, WINDOW_MS)).allowed).toBe(true);
  });

  it("restores the budget once the window has passed", async () => {
    await limiter.consume("user-1", 1, WINDOW_MS);
    expect((await limiter.consume("user-1", 1, WINDOW_MS)).allowed).toBe(false);

    vi.advanceTimersByTime(WINDOW_MS + 1);

    expect((await limiter.consume("user-1", 1, WINDOW_MS)).allowed).toBe(true);
  });

  /**
   * A refused request must not push the reset further out. Otherwise a client
   * retrying in a tight loop would hold its own window open indefinitely and
   * never recover - the exact behaviour a rate limit exists to survive.
   */
  it("a refused request does not extend the window it was refused by", async () => {
    const first = await limiter.consume("user-1", 1, WINDOW_MS);

    vi.advanceTimersByTime(30_000);
    const refused = await limiter.consume("user-1", 1, WINDOW_MS);

    expect(refused.allowed).toBe(false);
    expect(refused.resetAt).toEqual(first.resetAt);
  });

  it("reports when the budget comes back, so the guard can send retry-after", async () => {
    const decision = await limiter.consume("user-1", 1, WINDOW_MS);

    expect(decision.resetAt.getTime()).toBe(Date.now() + WINDOW_MS);
    expect(decision.limit).toBe(1);
  });

  it("does not grow without bound: expired keys are swept", async () => {
    // The sweep runs on a call counter, so it takes a burst to trigger one.
    for (let i = 0; i < 600; i += 1) {
      await limiter.consume(`user-${i}`, 5, WINDOW_MS);
    }

    vi.advanceTimersByTime(WINDOW_MS + 1);
    for (let i = 0; i < 600; i += 1) {
      await limiter.consume("survivor", 5000, WINDOW_MS);
    }

    // Reaching into the private map is the only way to observe a leak at all,
    // and a leak here is a slow production failure rather than a wrong answer.
    const windows = (limiter as unknown as { windows: Map<string, unknown> }).windows;
    expect(windows.size).toBeLessThan(100);
  });
});
