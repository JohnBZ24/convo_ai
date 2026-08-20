import { rateLimitMiddleware } from "./rate-limit.middleware";
import { requestContextMiddleware } from "./request-context.middleware";
import { requireUserMiddleware } from "./require-user.middleware";

/**
 * Named middleware stacks.
 *
 * Route files compose from these rather than listing middleware individually,
 * so the security posture of the whole API can be audited by reading the
 * `middleware:` line of each route file. A route that forgot its guard is
 * visible at a glance instead of buried in a list.
 *
 * ORDER MATTERS. Every stack starts with the request context, because the
 * guards after it render errors carrying its request id; and rate limiting
 * always follows authentication, because the budget is keyed by user.
 *
 * NestJS note: these are `@UseGuards(...)` combinations, named once and reused.
 */

/** No authentication. Health, readiness, docs. */
export const publicStack = [requestContextMiddleware];

/** A valid bearer token required. `context.user` is set for the handler. */
export const authenticatedStack = [requestContextMiddleware, requireUserMiddleware];

/** Authenticated, and capped at 20 credential mints per hour. Iteration 3. */
export const realtimeMintStack = [
  ...authenticatedStack,
  rateLimitMiddleware("realtime"),
];

/** Authenticated, and capped at 120 tool calls per minute. Iteration 3. */
export const toolCallStack = [...authenticatedStack, rateLimitMiddleware("tools")];
