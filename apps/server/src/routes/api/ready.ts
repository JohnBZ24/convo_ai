import { createFileRoute } from "@tanstack/react-router";
import { getReadiness } from "~/presentation/controllers/health.controller";
import { publicStack } from "~/presentation/middleware/stacks";

export const Route = createFileRoute("/api/ready")({
  server: {
    middleware: publicStack,
    handlers: { GET: getReadiness },
  },
});
