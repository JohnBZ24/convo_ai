import { createFileRoute } from "@tanstack/react-router";
import { appendTurn } from "~/presentation/controllers/conversations.controller";
import { authenticatedStack } from "~/presentation/middleware/stacks";

/**
 * `$id/turns.ts` rather than `$id.turns.ts`: the dotted form would make
 * `$id` this route's PARENT, and a parent's middleware runs too - so every
 * turn would be authenticated twice, once per stack.
 */
export const Route = createFileRoute("/api/conversations/$id/turns")({
  server: {
    middleware: authenticatedStack,
    handlers: { POST: appendTurn },
  },
});
