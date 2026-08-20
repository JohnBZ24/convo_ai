import { createFileRoute } from "@tanstack/react-router";
import { getHealth } from "~/presentation/controllers/health.controller";
import { publicStack } from "~/presentation/middleware/stacks";

/**
 * Route files are the URL map and nothing else: which middleware stack guards
 * this path, and which controller answers each method. All behaviour lives in
 * the controller, all decisions in the use case.
 */
export const Route = createFileRoute("/api/health")({
  server: {
    middleware: publicStack,
    handlers: { GET: getHealth },
  },
});
