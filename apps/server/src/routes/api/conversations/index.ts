import { createFileRoute } from "@tanstack/react-router";
import {
  createConversation,
  listConversations,
} from "~/presentation/controllers/conversations.controller";
import { authenticatedStack } from "~/presentation/middleware/stacks";

/**
 * Route files are the URL map and nothing else: which middleware stack guards
 * this path, and which controller answers each method.
 */
export const Route = createFileRoute("/api/conversations/")({
  server: {
    middleware: authenticatedStack,
    handlers: { POST: createConversation, GET: listConversations },
  },
});
