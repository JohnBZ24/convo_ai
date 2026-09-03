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
export type ApplicationErrorKind =
  | "not-found"
  | "invalid-input"
  | "conflict"
  | "forbidden"
  | "rate-limited"
  | "upstream-failure";

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

  /**
   * Understood, and refused on policy grounds - NOT an ownership failure.
   *
   * The one caller is "this tool runs on the device, so the server will not
   * proxy it". That is safe to state plainly because the tool registry is
   * already public knowledge: the model was handed the whole list when the
   * session was minted, so naming one leaks nothing. Ownership failures stay
   * `notFound`, for the reason given above.
   */
  static forbidden(message: string, details?: unknown) {
    return new ApplicationError("forbidden", message, details);
  }

  /**
   * The caller has spent a budget, and it is not the ROUTE's budget.
   *
   * `rateLimitMiddleware` already caps the tools endpoint as a whole, but a cap
   * per endpoint cannot express "this one tool costs money at a third party".
   * Only the use case knows that, which is exactly the test for whether a kind
   * belongs in this list.
   */
  static rateLimited(message: string, details?: unknown) {
    return new ApplicationError("rate-limited", message, details);
  }

  /**
   * A service we depend on failed - a distinct fact from "we have a bug".
   *
   * Without this kind, an OpenAI outage surfaces as a 500 saying "an unexpected
   * error occurred", which sends whoever is debugging it into this codebase
   * instead of at the status page. The core still names no status code; it
   * names the CAUSE, and the edge maps it to 502.
   */
  static upstreamFailure(message: string, details?: unknown) {
    return new ApplicationError("upstream-failure", message, details);
  }
}

export function isApplicationError(error: unknown): error is ApplicationError {
  return error instanceof ApplicationError;
}
