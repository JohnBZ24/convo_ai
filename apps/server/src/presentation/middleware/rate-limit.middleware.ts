import { createMiddleware } from "@tanstack/react-start";
import { container } from "~/infrastructure/di/container";
import { ApiError } from "~/presentation/http/api-error";
import { renderApiError } from "~/presentation/http/define-handler";
import { requireUserMiddleware } from "./require-user.middleware";

/**
 * Named budgets, so a limit is chosen by naming what is being protected rather
 * than by two numbers at a call site.
 *
 * `realtime` guards MONEY: every mint is a session the user can talk into, at
 * roughly $0.05-0.15 a minute against the developer's own OpenAI budget.
 * `tools` guards a PROMPT-INJECTABLE surface: the model on the device decides
 * when to call it, so the ceiling is what stops a looping model from hammering
 * the database - generous enough that a real conversation never notices.
 */
export const RATE_LIMITS = {
  realtime: { limit: 20, windowMs: 60 * 60 * 1000 },
  tools: { limit: 120, windowMs: 60 * 1000 },
} as const;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

/**
 * Per-user rate limiting.
 *
 * MUST be composed after `requireUserMiddleware`: the key is the authenticated
 * user id, never an IP (shared by everyone behind a carrier NAT) and never
 * anything the caller supplies (which the caller can therefore vary to get a
 * fresh budget). Without a user in context this fails closed with 401 rather
 * than falling back to an unkeyed limit.
 */
export function rateLimitMiddleware(bucket: RateLimitBucket) {
  const { limit, windowMs } = RATE_LIMITS[bucket];

  return (
    createMiddleware()
      /**
       * Depending on the guard is not decoration: it is what makes "keyed by the
       * authenticated user" a fact the compiler checks, rather than a convention
       * a future stack could quietly break by listing these in the wrong order.
       */
      .middleware([requireUserMiddleware])
      .server(async ({ next, context }) => {
        // Typed, not cast: `user` is here because the middleware above put it
        // there, and the compiler knows that from the .middleware([]) line.
        const { requestId, user } = context;

        const decision = await container.rateLimiter.consume(
          `${bucket}:${user.id}`,
          limit,
          windowMs,
        );

        if (!decision.allowed) {
          const retryAfterSeconds = Math.max(
            1,
            Math.ceil((decision.resetAt.getTime() - Date.now()) / 1000),
          );

          const response = renderApiError(
            ApiError.rateLimited(
              `Limit of ${limit} ${bucket} requests reached. Try again in ${retryAfterSeconds}s.`,
              { limit, retryAfterSeconds },
            ),
            requestId,
          );

          // `retry-after` is what a well-behaved client backs off on; the message
          // is for the human reading the response in Swagger.
          response.headers.set("retry-after", String(retryAfterSeconds));
          return response;
        }

        return next();
      })
  );
}
