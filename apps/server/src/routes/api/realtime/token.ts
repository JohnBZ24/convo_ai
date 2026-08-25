import { createFileRoute } from "@tanstack/react-router";
import { mintRealtimeToken } from "~/presentation/controllers/realtime.controller";
import { realtimeMintStack } from "~/presentation/middleware/stacks";

/**
 * `realtimeMintStack`, not `authenticatedStack`: every call to this endpoint
 * costs real money, so the 20/hour budget is part of the URL map and visible
 * here rather than hidden inside the handler.
 */
export const Route = createFileRoute("/api/realtime/token")({
  server: {
    middleware: realtimeMintStack,
    handlers: { POST: mintRealtimeToken },
  },
});
