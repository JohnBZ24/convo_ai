import { createFileRoute } from "@tanstack/react-router";
import { executeTool } from "~/presentation/controllers/tools.controller";
import { toolCallStack } from "~/presentation/middleware/stacks";

/**
 * The endpoint a possibly-prompt-injected model can reach.
 *
 * `toolCallStack` authenticates first and then caps the caller at 120 calls a
 * minute - generous enough that a real conversation never notices, low enough
 * that a model stuck in a loop cannot hammer the database. The limit is keyed
 * by the authenticated user, which is why authentication has to come first.
 */
export const Route = createFileRoute("/api/tools/$name")({
  server: {
    middleware: toolCallStack,
    handlers: { POST: executeTool },
  },
});
