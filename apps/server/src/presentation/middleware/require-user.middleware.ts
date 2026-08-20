import { createMiddleware } from "@tanstack/react-start";
import { container } from "~/infrastructure/di/container";
import { ApiError } from "~/presentation/http/api-error";
import { renderApiError } from "~/presentation/http/define-handler";
import { requestContextMiddleware } from "./request-context.middleware";

/**
 * Establishes WHO is calling, or refuses the request.
 *
 * Returning a Response short-circuits the chain: the handler never runs, so an
 * unauthenticated request cannot reach a use case even by accident. The
 * envelope is rendered by the same function `defineHandler` uses, so a 401 from
 * the guard is indistinguishable on the wire from a 401 from a handler.
 *
 * Identity comes from the SESSION and nowhere else. Not from a header, not from
 * a body field, and never from a tool argument - a model can be talked into
 * passing any user id, but it cannot forge a session token.
 *
 * NestJS note: `@UseGuards(AuthGuard)` plus the request-scoped user, in one.
 */
export const requireUserMiddleware = createMiddleware()
  /**
   * Declaring the dependency rather than assuming it: this is what TYPES
   * `context.requestId` below, and it also guarantees the ordering - TanStack
   * hoists a middleware's dependencies ahead of it and runs each one once, even
   * when a stack lists the same middleware again.
   */
  .middleware([requestContextMiddleware])
  .server(async ({ next, request, context }) => {
    const { requestId } = context;

    const user = await container.sessionAuthenticator.authenticate(request.headers);

    if (!user) {
      return renderApiError(
        ApiError.unauthorized(
          "Sign in and send the token as `Authorization: Bearer <token>`",
        ),
        requestId,
      );
    }

    return next({ context: { user } });
  });
