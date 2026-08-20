import { env } from "~/config/env";
import type { DocumentedHandler } from "~/presentation/http/define-handler";
import { AUTH_TAG, buildAuthOperations } from "./auth-operations";
import { toSchema } from "./zod-to-openapi";

/**
 * Builds the OpenAPI 3.1 document by DISCOVERING controllers, not by reading a
 * hand-maintained registry.
 *
 * `import.meta.glob` is a Vite primitive, and TanStack Start runs on Vite. Every
 * `*.controller.ts` is imported, every export carrying a `.spec` becomes an
 * operation. Adding an endpoint therefore documents it automatically - there is
 * no registration step to forget, and so no drift to test for.
 *
 * (Verified working in TanStack Start's SERVER build before this was written.)
 */
const controllerModules = import.meta.glob<Record<string, unknown>>(
  "../controllers/**/*.controller.ts",
  { eager: true },
);

function isDocumentedHandler(value: unknown): value is DocumentedHandler {
  return (
    typeof value === "function" && "spec" in value && typeof value.spec === "object"
  );
}

/**
 * Query parameters, with `required` taken from the schema rather than assumed.
 *
 * A field with `.default()` is OPTIONAL in a request even though it is always
 * present in the parsed result, which is why this reads the `required` list off
 * the input-side conversion instead of listing every property.
 */
function queryParameters(query: DocumentedHandler["spec"]["query"]) {
  if (!query) return [];

  const converted = toSchema(query, "input");
  const required = (converted.required as string[] | undefined) ?? [];

  return Object.entries(converted.properties ?? {}).map(([name, schema]) => ({
    name,
    in: "query" as const,
    required: required.includes(name),
    schema,
  }));
}

export function buildOpenApiDocument() {
  /**
   * Seeded with the auth operations, which are hand-written because Better
   * Auth serves them through a bare splat and there is no spec to discover.
   * Everything after this point is generated. See auth-operations.ts.
   */
  const paths: Record<string, Record<string, unknown>> = buildAuthOperations();

  for (const module of Object.values(controllerModules)) {
    for (const exported of Object.values(module)) {
      if (!isDocumentedHandler(exported)) continue;

      const { spec } = exported;

      const parameters = [
        ...(spec.params
          ? Object.entries(toSchema(spec.params, "input").properties ?? {}).map(
              ([name, schema]) => ({
                name,
                in: "path" as const,
                required: true,
                schema,
              }),
            )
          : []),
        ...queryParameters(spec.query),
      ];

      const responses = Object.fromEntries(
        Object.entries(spec.responses).map(([status, schema]) => [
          status,
          schema
            ? {
                description: statusDescription(Number(status)),
                content: { "application/json": { schema: toSchema(schema, "output") } },
              }
            : { description: statusDescription(Number(status)) },
        ]),
      );

      const operation: Record<string, unknown> = {
        operationId: spec.operationId,
        summary: spec.summary,
        tags: spec.tags,
        responses,
      };

      if (spec.description) operation.description = spec.description;
      if (parameters.length > 0) operation.parameters = parameters;

      if (spec.body) {
        operation.requestBody = {
          required: true,
          content: { "application/json": { schema: toSchema(spec.body, "input") } },
        };
      }

      // Only protected operations carry `security`, so Swagger UI shows the
      // padlock exactly where a token is actually required.
      if (spec.requiresAuth) operation.security = [{ bearerAuth: [] }];

      // Bound to a local rather than indexed twice: noUncheckedIndexedAccess
      // types a second lookup as possibly-undefined even right after assignment.
      const pathItem = paths[spec.path] ?? {};
      pathItem[spec.method] = operation;
      paths[spec.path] = pathItem;
    }
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Convo AI API",
      version: env.APP_VERSION,
      description:
        "Backend for the Convo AI voice app. Note that conversation audio does NOT flow through this API - the device holds a WebRTC connection directly to OpenAI and posts each completed turn back here.",
    },
    servers: [{ url: env.BETTER_AUTH_URL, description: "This instance" }],
    tags: [
      { name: "health", description: "Liveness and readiness probes" },
      AUTH_TAG,
      { name: "conversations", description: "Conversation and turn persistence" },
      { name: "realtime", description: "Ephemeral OpenAI credential minting" },
      { name: "tools", description: "Privileged tools the model may invoke" },
    ],
    components: {
      securitySchemes: {
        /**
         * Declaring this is what makes Swagger UI's Authorize button work,
         * which is the manual test loop: sign in, copy the token from the
         * `set-auth-token` response header, Authorize, click any endpoint.
         */
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "Better Auth bearer token. Read it from the `set-auth-token` response header of /api/auth/sign-in/email. The body also carries a `token` and the two differ - both authenticate.",
        },
      },
    },
    paths,
  };
}

function statusDescription(status: number): string {
  const known: Record<number, string> = {
    200: "Success",
    201: "Created",
    204: "No content",
    400: "Malformed request",
    401: "Authentication required",
    403: "Not permitted",
    404: "Not found",
    409: "Conflict",
    422: "Validation failed",
    429: "Rate limited",
    500: "Internal error",
    502: "Upstream error",
    503: "Service unavailable",
  };
  return known[status] ?? "Response";
}
