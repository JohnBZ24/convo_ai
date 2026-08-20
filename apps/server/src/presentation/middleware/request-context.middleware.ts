import { createMiddleware } from "@tanstack/react-start";
import { logger } from "~/infrastructure/logging/logger";

/**
 * Gives every request an id and a logger bound to it.
 *
 * An inbound `x-request-id` is honoured so a trace survives across hops; if
 * absent one is minted. The id goes back on the response, which is what lets a
 * user quote it in a bug report and have it grep straight out of the logs.
 *
 * NestJS note: `next({ context })` is this framework's answer to a guard or
 * interceptor writing onto `request`. The difference is that the context is
 * TYPED downstream - handlers read `context.requestId` without a cast.
 */
export const requestContextMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

    return next({
      context: {
        requestId,
        logger: logger.child({ requestId }),
      },
    });
  },
);
