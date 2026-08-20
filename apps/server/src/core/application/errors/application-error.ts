/**
 * Failures the application layer can express WITHOUT knowing about HTTP.
 *
 * A use case that threw `ApiError` would be importing from the presentation
 * layer, which points the dependency arrow outwards and quietly makes the core
 * un-reusable outside a web server. So the core throws these instead, and
 * `defineHandler` - which is already the single place ApiError and ZodError are
 * turned into responses - maps them to statuses.
 *
 * Keep this list SHORT. Every kind added here is a status code decision moved
 * out of the presentation layer, and only the ones a use case genuinely knows
 * belong in it.
 */
export type ApplicationErrorKind = "not-found" | "invalid-input" | "conflict";

export class ApplicationError extends Error {
  constructor(
    public readonly kind: ApplicationErrorKind,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApplicationError";
  }

  /**
   * Also the correct answer for "it exists, but it is not yours".
   *
   * Repositories scope every query by userId, so another user's conversation is
   * simply not in the result set. Reporting 403 would confirm that the id
   * exists, which is a fact the caller has no right to.
   */
  static notFound(message: string, details?: unknown) {
    return new ApplicationError("not-found", message, details);
  }

  /** Well-formed enough to parse, but wrong. A malformed cursor, for example. */
  static invalidInput(message: string, details?: unknown) {
    return new ApplicationError("invalid-input", message, details);
  }

  static conflict(message: string, details?: unknown) {
    return new ApplicationError("conflict", message, details);
  }
}

export function isApplicationError(error: unknown): error is ApplicationError {
  return error instanceof ApplicationError;
}
