import type {
  AuthenticatedUser,
  SessionAuthenticator,
} from "~/core/application/ports/session-authenticator.port";
import { auth } from "~/infrastructure/auth/auth";
import { logger } from "~/infrastructure/logging/logger";

/**
 * Adapter: satisfies the SessionAuthenticator port using Better Auth.
 *
 * `getSession` is given the raw request headers because the bearer plugin runs
 * as a hook INSIDE that call - it reads the Authorization header, verifies the
 * signature and rewrites it into the session cookie Better Auth expects. Doing
 * that translation here by hand would duplicate the plugin, badly.
 */
export class BetterAuthSessionAuthenticator implements SessionAuthenticator {
  async authenticate(headers: Headers): Promise<AuthenticatedUser | null> {
    try {
      const result = await auth.api.getSession({ headers });
      if (!result) return null;

      return {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
      };
    } catch (error) {
      /**
       * A malformed or expired token is "not signed in", not a server fault -
       * the caller gets 401 either way. It IS logged, because a sudden run of
       * these means the secret or the database changed under us.
       */
      logger.warn("session lookup failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
