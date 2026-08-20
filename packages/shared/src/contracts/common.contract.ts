import { z } from "zod";

/**
 * Machine-readable error codes.
 *
 * These are part of the public API contract: the mobile app switches on them,
 * so renaming one is a breaking change. Human-facing copy lives in `message`
 * and may change freely.
 *
 * NOTE: Better Auth does NOT use this envelope. `/api/auth/*` returns its own
 * flat `{ code, message }` with SCREAMING_SNAKE codes. Parsing an auth response
 * with `errorEnvelope` yields "an unexpected error occurred" on every wrong
 * password. See docs/HANDOFF.md.
 */
export const ERROR_CODES = [
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "VALIDATION_FAILED",
  "RATE_LIMITED",
  "UPSTREAM_ERROR",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * The single error shape every non-auth endpoint returns.
 *
 * `requestId` is echoed from the `x-request-id` response header so a user can
 * quote it in a bug report and it can be grepped straight out of the logs.
 */
export const errorEnvelope = z
  .object({
    error: z.object({
      code: z.enum(ERROR_CODES),
      message: z.string(),
      details: z.unknown().optional(),
      requestId: z.string(),
    }),
  })
  .meta({ id: "ErrorEnvelope", description: "Standard error response" });

export type ErrorEnvelope = z.infer<typeof errorEnvelope>;

/**
 * Keyset pagination.
 *
 * Deliberately not offset-based: an offset shifts when rows are inserted while
 * the user is scrolling, so items get skipped or repeated. The cursor encodes
 * `(started_at, id)`, which matches the table's index exactly.
 */
export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuery>;

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

/** ISO-8601 timestamp, serialised as a string on the wire. */
export const isoTimestamp = z.iso.datetime({ offset: true });
