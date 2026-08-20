import { requestContextMiddleware } from "./request-context.middleware";

/**
 * Named middleware stacks.
 *
 * Route files compose from these rather than listing middleware individually,
 * so the security posture of the whole API can be audited by reading the
 * `middleware:` line of each route file. A route that forgot its guard is
 * visible at a glance instead of buried in a list.
 *
 * NestJS note: these are `@UseGuards(...)` combinations, named once and reused.
 */

/** No authentication. Health, readiness, docs. */
export const publicStack = [requestContextMiddleware];

// Iteration 2 adds:
//   export const authenticatedStack = [requestContextMiddleware, requireUserMiddleware];
//   export const toolCallStack      = [...authenticatedStack, rateLimitMiddleware("tools")];
//   export const realtimeMintStack  = [...authenticatedStack, rateLimitMiddleware("realtime")];
