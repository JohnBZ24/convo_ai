import type { AuthenticatedUser } from "~/core/application/ports/session-authenticator.port";
import { ApiError } from "./api-error";

export type { AuthenticatedUser };

/**
 * Read the signed-in user out of the middleware context, with the type.
 *
 * `requireUserMiddleware` has already rejected an anonymous request by the time
 * a handler runs, so in practice this never throws. It throws anyway, rather
 * than returning `undefined`, so that the compiler cannot be talked into
 * letting a controller proceed without a user - and so that a route wired to
 * the wrong middleware stack fails loudly instead of querying with
 * `userId: undefined`.
 *
 * NestJS note: this is `@CurrentUser()`, without the decorator metadata.
 */
export function currentUser(context: Record<string, unknown>): AuthenticatedUser {
  const user = context.user as AuthenticatedUser | undefined;

  if (!user?.id) {
    throw ApiError.unauthorized("Authentication required");
  }

  return user;
}
