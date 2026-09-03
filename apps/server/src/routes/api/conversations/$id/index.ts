import { createFileRoute } from "@tanstack/react-router";
import {
  deleteConversation,
  getConversation,
  updateConversation,
} from "~/presentation/controllers/conversations.controller";
import { authenticatedStack } from "~/presentation/middleware/stacks";

export const Route = createFileRoute("/api/conversations/$id/")({
  server: {
    middleware: authenticatedStack,
    handlers: {
      GET: getConversation,
      PATCH: updateConversation,
      DELETE: deleteConversation,
    },
  },
});
