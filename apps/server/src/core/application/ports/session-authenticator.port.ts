/**
 * Turns the credentials on a request into the user behind them.
 *
 * A port rather than a direct Better Auth call so the guard can be tested
 * without a database, and so that "how a request proves who it is" is one
 * replaceable implementation instead of an assumption spread through the
 * middleware.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

export interface SessionAuthenticator {
  /** Null when the request carries no valid session. Never throws for that. */
  authenticate(headers: Headers): Promise<AuthenticatedUser | null>;
}
