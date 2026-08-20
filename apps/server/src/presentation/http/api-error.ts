import type { ErrorCode } from "@convo/shared";

/**
 * An error that already knows how it should look on the wire.
 *
 * Use cases and services throw these; `defineHandler` catches them and renders
 * the shared envelope. Anything else that escapes becomes a 500 with its detail
 * withheld, because an unexpected error's message may contain internals.
 *
 * NestJS note: this is `HttpException`, and defineHandler is the exception
 * filter that renders it.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, "BAD_REQUEST", message, details);
  }

  static unauthorized(message = "Authentication required") {
    return new ApiError(401, "UNAUTHORIZED", message);
  }

  static forbidden(message = "Not permitted") {
    return new ApiError(403, "FORBIDDEN", message);
  }

  /**
   * Also the correct answer for "exists, but is not yours".
   *
   * A 403 would confirm the resource exists, which leaks information across
   * users. Repositories scope every query by userId so the row simply is not
   * in the result set - the 404 is truthful, not a cover story.
   */
  static notFound(message = "Not found") {
    return new ApiError(404, "NOT_FOUND", message);
  }

  static conflict(message: string, details?: unknown) {
    return new ApiError(409, "CONFLICT", message, details);
  }

  static validationFailed(message: string, details?: unknown) {
    return new ApiError(422, "VALIDATION_FAILED", message, details);
  }

  static rateLimited(message = "Too many requests", details?: unknown) {
    return new ApiError(429, "RATE_LIMITED", message, details);
  }

  static upstream(message: string, details?: unknown) {
    return new ApiError(502, "UPSTREAM_ERROR", message, details);
  }

  static unavailable(message: string, details?: unknown) {
    return new ApiError(503, "SERVICE_UNAVAILABLE", message, details);
  }
}
