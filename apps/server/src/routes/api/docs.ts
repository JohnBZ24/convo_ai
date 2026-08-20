import { createFileRoute } from "@tanstack/react-router";
import { env } from "~/config/env";
import { securityHeaders } from "~/infrastructure/security/headers";
import { SWAGGER_CSP, swaggerUiHtml } from "~/presentation/openapi/swagger-ui";

export const Route = createFileRoute("/api/docs")({
  server: {
    handlers: {
      GET: () => {
        if (!env.DOCS_ENABLED) return new Response("Not found", { status: 404 });

        return new Response(swaggerUiHtml("/api/openapi"), {
          headers: {
            ...securityHeaders(),
            "content-type": "text/html; charset=utf-8",
            // overrides the baseline default-src 'none' for this page only
            "content-security-policy": SWAGGER_CSP,
          },
        });
      },
    },
  },
});
