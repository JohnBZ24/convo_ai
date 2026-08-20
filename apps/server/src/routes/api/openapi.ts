import { createFileRoute } from "@tanstack/react-router";
import { env } from "~/config/env";
import { securityHeaders } from "~/infrastructure/security/headers";
import { buildOpenApiDocument } from "~/presentation/openapi/document";

/**
 * Serves the generated document.
 *
 * Not a defineHandler: this endpoint DESCRIBES the API rather than being part
 * of it, and documenting it would be circular. Built per request so it always
 * reflects the loaded controllers.
 */
export const Route = createFileRoute("/api/openapi")({
  server: {
    handlers: {
      GET: () => {
        if (!env.DOCS_ENABLED) return new Response("Not found", { status: 404 });

        return new Response(JSON.stringify(buildOpenApiDocument(), null, 2), {
          headers: { "content-type": "application/json", ...securityHeaders() },
        });
      },
    },
  },
});
