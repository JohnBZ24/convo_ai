import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApplicationError } from "~/core/application/errors/application-error";
import { ApiError } from "~/presentation/http/api-error";
import { defineHandler } from "~/presentation/http/define-handler";

const body = z.object({ name: z.string().min(1) });

function request(init: RequestInit = {}) {
  return new Request("http://127.0.0.1:3000/api/test?limit=5", {
    method: "POST",
    ...init,
  });
}

const context = { requestId: "req-1", user: { id: "u1", email: "a@b.c", name: "A" } };

describe("defineHandler", () => {
  it("stamps x-request-id on the way out, so a user can quote it", async () => {
    const handler = defineHandler({
      operationId: "ok",
      method: "post",
      path: "/api/test",
      summary: "ok",
      tags: ["test"],
      responses: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ status: 200, body: { ok: true } }),
    });

    const response = await handler({ request: request(), context });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-1");
  });

  /**
   * `requiresAuth` drives the padlock in Swagger AND this refusal. A route
   * wired without its guard therefore fails closed rather than running the
   * handler with no user - the silent, severe failure mode.
   */
  it("refuses a requiresAuth operation when no user reached the context", async () => {
    const handler = defineHandler({
      operationId: "guarded",
      method: "post",
      path: "/api/test",
      summary: "guarded",
      tags: ["test"],
      requiresAuth: true,
      responses: { 200: z.object({ ok: z.boolean() }) },
      handler: () => {
        throw new Error("the handler must never run");
      },
    });

    const response = await handler({ request: request(), context: { requestId: "r" } });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHORIZED", requestId: "r" },
    });
  });

  it("turns a schema mismatch into 422 with the offending field", async () => {
    const handler = defineHandler({
      operationId: "validated",
      method: "post",
      path: "/api/test",
      summary: "validated",
      tags: ["test"],
      body,
      responses: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ status: 200, body: { ok: true } }),
    });

    const response = await handler({
      request: request({ body: JSON.stringify({ name: "" }) }),
      context,
    });

    expect(response.status).toBe(422);
    const payload = (await response.json()) as {
      error: { code: string; details: { path: string[] }[] };
    };
    expect(payload.error.code).toBe("VALIDATION_FAILED");
    expect(payload.error.details[0]?.path).toEqual(["name"]);
  });

  it("distinguishes an absent body from an invalid one", async () => {
    const handler = defineHandler({
      operationId: "needsBody",
      method: "post",
      path: "/api/test",
      summary: "needsBody",
      tags: ["test"],
      body,
      responses: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ status: 200, body: { ok: true } }),
    });

    const empty = await handler({ request: request(), context });
    const garbage = await handler({
      request: request({ body: "{not json" }),
      context,
    });

    expect(empty.status).toBe(400);
    expect(garbage.status).toBe(400);
    await expect(garbage.json()).resolves.toMatchObject({
      error: { message: "Body is not valid JSON" },
    });
  });

  /**
   * The core throws framework-free errors; this is the ONE place they acquire
   * a status code. If this mapping is wrong, "not yours" starts leaking as a
   * 500 - or worse, as a 403 that confirms the resource exists.
   */
  it.each([
    ["not-found", 404, "NOT_FOUND"],
    ["invalid-input", 400, "BAD_REQUEST"],
    ["conflict", 409, "CONFLICT"],
  ] as const)("maps a %s application error to %i", async (kind, status, code) => {
    const handler = defineHandler({
      operationId: "throws",
      method: "post",
      path: "/api/test",
      summary: "throws",
      tags: ["test"],
      responses: { 200: z.object({ ok: z.boolean() }) },
      handler: () => {
        throw new ApplicationError(kind, "nope");
      },
    });

    const response = await handler({ request: request(), context });

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
  });

  it("renders an ApiError with its own status", async () => {
    const handler = defineHandler({
      operationId: "apiError",
      method: "post",
      path: "/api/test",
      summary: "apiError",
      tags: ["test"],
      responses: { 200: z.object({ ok: z.boolean() }) },
      handler: () => {
        throw ApiError.rateLimited("slow down", { retryAfterSeconds: 30 });
      },
    });

    const response = await handler({ request: request(), context });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RATE_LIMITED", details: { retryAfterSeconds: 30 } },
    });
  });

  it("tells the caller nothing about an unexpected error", async () => {
    const handler = defineHandler({
      operationId: "boom",
      method: "post",
      path: "/api/test",
      summary: "boom",
      tags: ["test"],
      responses: { 200: z.object({ ok: z.boolean() }) },
      handler: () => {
        throw new Error("connection string postgres://user:hunter2@host/db failed");
      },
    });

    const response = await handler({ request: request(), context });
    const payload = await response.text();

    expect(response.status).toBe(500);
    expect(payload).not.toContain("hunter2");
    expect(payload).toContain("An unexpected error occurred");
  });

  it("parses query parameters with the schema that documents them", async () => {
    const handler = defineHandler({
      operationId: "query",
      method: "post",
      path: "/api/test",
      summary: "query",
      tags: ["test"],
      query: z.object({ limit: z.coerce.number().int() }),
      responses: { 200: z.object({ limit: z.number() }) },
      handler: ({ query }) => ({ status: 200, body: { limit: query.limit } }),
    });

    const response = await handler({ request: request(), context });

    await expect(response.json()).resolves.toEqual({ limit: 5 });
  });

  it("carries its own OpenAPI description, which is what the document reads", () => {
    const handler = defineHandler({
      operationId: "documented",
      method: "post",
      path: "/api/test",
      summary: "documented",
      tags: ["test"],
      requiresAuth: true,
      responses: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ status: 200, body: { ok: true } }),
    });

    expect(handler.spec.operationId).toBe("documented");
    expect(handler.spec.requiresAuth).toBe(true);
  });
});
