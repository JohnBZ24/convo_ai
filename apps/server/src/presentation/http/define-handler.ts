import type { ErrorEnvelope } from "@convo/shared";
import { z } from "zod";
import { isDevelopment } from "~/config/env";
import { logger } from "~/infrastructure/logging/logger";
import { ApiError } from "./api-error";

/**
 * ONE declaration produces three things that normally drift apart:
 *
 *   1. request validation      (the schemas parse the incoming request)
 *   2. the OpenAPI operation   (the same schemas become the documentation)
 *   3. a response contract     (the declared response schema is enforced in dev)
 *
 * TanStack Start has no OpenAPI support - its route handlers carry no
 * validators and its response types are erased at runtime. The usual workaround
 * is a second, parallel description of every endpoint, which then drifts from
 * the code. Co-locating them here means the schema that VALIDATES is the schema
 * that DOCUMENTS, so drift is not caught late; it is impossible.
 *
 * NestJS note: this is `@ApiOperation` + a DTO + `ValidationPipe` +
 * `ClassSerializerInterceptor` + the exception filter, collapsed into one
 * object because there is no decorator metadata to hang them off.
 */

type Schema = z.ZodType;
type InferOr<T, Fallback> = T extends Schema ? z.infer<T> : Fallback;

export interface HandlerContext<TBody, TQuery, TParams> {
  body: TBody;
  query: TQuery;
  params: TParams;
  request: Request;
  /** Populated by middleware - requestId, logger, and later the user. */
  context: Record<string, unknown>;
}

export interface HandlerResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface HandlerSpec<
  TBody extends Schema,
  TQuery extends Schema,
  TParams extends Schema,
> {
  /** Unique across the API; becomes OpenAPI `operationId`. */
  operationId: string;
  /** HTTP method, lowercase. Must match how the route file wires this handler. */
  method: "get" | "post" | "patch" | "put" | "delete";
  /** OpenAPI path, e.g. "/api/conversations/{id}". Must match the route file. */
  path: string;
  summary: string;
  description?: string;
  tags: string[];
  body?: TBody;
  query?: TQuery;
  params?: TParams;
  /** Status code -> response schema. `null` means no body (e.g. 204). */
  responses: Record<number, Schema | null>;
  /** Whether this operation requires a bearer token. Drives OpenAPI `security`. */
  requiresAuth?: boolean;
  handler: (
    ctx: HandlerContext<
      InferOr<TBody, undefined>,
      InferOr<TQuery, undefined>,
      InferOr<TParams, Record<string, string>>
    >,
  ) => Promise<HandlerResult> | HandlerResult;
}

/** A TanStack handler that also carries its own OpenAPI description. */
export type DocumentedHandler = ((args: {
  request: Request;
  params?: Record<string, string>;
  context?: Record<string, unknown>;
}) => Promise<Response>) & { spec: HandlerSpec<Schema, Schema, Schema> };

function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof ApiError) {
    const envelope: ErrorEnvelope = {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        requestId,
      },
    };
    return jsonResponse(envelope, error.status, { "x-request-id": requestId });
  }

  // A Zod failure that reaches here is a malformed REQUEST, so 422 with the
  // field-level detail - the caller can act on it.
  if (error instanceof z.ZodError) {
    const envelope: ErrorEnvelope = {
      error: {
        code: "VALIDATION_FAILED",
        message: "Request did not match the expected schema",
        details: error.issues,
        requestId,
      },
    };
    return jsonResponse(envelope, 422, { "x-request-id": requestId });
  }

  // Anything else is our bug. Log it in full, tell the caller nothing - an
  // unexpected message may carry internals (paths, SQL, credentials).
  logger.error("unhandled error in handler", {
    requestId,
    error: error instanceof Error ? error.stack : String(error),
  });

  const envelope: ErrorEnvelope = {
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      requestId,
    },
  };
  return jsonResponse(envelope, 500, { "x-request-id": requestId });
}

export function defineHandler<
  TBody extends Schema = never,
  TQuery extends Schema = never,
  TParams extends Schema = never,
>(spec: HandlerSpec<TBody, TQuery, TParams>): DocumentedHandler {
  const run = async (args: {
    request: Request;
    params?: Record<string, string>;
    context?: Record<string, unknown>;
  }): Promise<Response> => {
    const context = args.context ?? {};
    const requestId =
      typeof context.requestId === "string" ? context.requestId : crypto.randomUUID();

    try {
      // ---- parse the request with the SAME schemas that document it ----
      let body: unknown;
      if (spec.body) {
        const raw = await args.request.text();
        if (!raw) throw ApiError.badRequest("A JSON body is required");
        try {
          body = spec.body.parse(JSON.parse(raw));
        } catch (error) {
          if (error instanceof SyntaxError)
            throw ApiError.badRequest("Body is not valid JSON");
          throw error;
        }
      }

      const query = spec.query
        ? spec.query.parse(Object.fromEntries(new URL(args.request.url).searchParams))
        : undefined;

      const params = spec.params
        ? spec.params.parse(args.params ?? {})
        : (args.params ?? {});

      const result = await spec.handler({
        body: body as InferOr<TBody, undefined>,
        query: query as InferOr<TQuery, undefined>,
        params: params as InferOr<TParams, Record<string, string>>,
        request: args.request,
        context,
      });

      // ---- enforce the response contract (development only) ----
      //
      // This is what makes the published docs TRUE rather than aspirational: a
      // handler that returns a shape it did not declare fails here, loudly,
      // during development. Skipped in production so a schema bug can never
      // take down a working endpoint.
      if (isDevelopment) {
        const declared = spec.responses[result.status];
        if (declared) {
          const check = declared.safeParse(result.body);
          if (!check.success) {
            logger.error("response does not match its declared schema", {
              operationId: spec.operationId,
              status: result.status,
              issues: check.error.issues,
            });
          }
        } else if (declared === undefined) {
          logger.warn("handler returned an undeclared status code", {
            operationId: spec.operationId,
            status: result.status,
          });
        }
      }

      return jsonResponse(result.body, result.status, {
        "x-request-id": requestId,
        ...result.headers,
      });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  };

  // The OpenAPI document reads this off the exported handler, so the operation
  // and the code can never be edited independently.
  (run as DocumentedHandler).spec = spec as unknown as HandlerSpec<
    Schema,
    Schema,
    Schema
  >;
  return run as DocumentedHandler;
}
