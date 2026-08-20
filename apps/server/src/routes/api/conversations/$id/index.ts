import { createFileRoute } from "@tanstack/react-router";
import {
  endConversation,
  getConversation,
} from "~/presentation/controllers/conversations.controller";
import { authenticatedStack } from "~/presentation/middleware/stacks";

export const Route = createFileRoute("/api/conversations/$id/")({
  server: {
    middleware: authenticatedStack,
    handlers: { GET: getConversation, PATCH: endConversation },
  },
});
