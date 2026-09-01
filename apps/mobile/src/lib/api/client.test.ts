import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, apiRequest } from "./client";

function respondWith(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  const response = new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * `catch (e) => e` types the result as `unknown`, and every assertion below then
 * fails to compile. Narrowing once here keeps each test to its actual subject.
 */
async function failureOf(promise: Promise<unknown>): Promise<ApiRequestError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiRequestError) return error;
    throw error;
  }
  throw new Error("expected the request to fail, but it resolved");
}

describe("apiRequest error shapes", () => {
  /**
   * The trap this exists for: `/api/auth/*` does NOT use the shared envelope.
   * Parsing a wrong password with the envelope schema yields "an unexpected
   * error occurred", which is useless to a user staring at a sign-in form.
   */
  it("reads Better Auth's flat { code, message }", async () => {
    respondWith(
      { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
      { status: 401 },
    );

    const error = await failureOf(apiRequest("/api/auth/sign-in/email"));

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.message).toBe("Invalid email or password");
    expect(error.code).toBe("INVALID_EMAIL_OR_PASSWORD");
    expect(error.status).toBe(401);
  });

  it("reads this API's envelope, and keeps the request id", async () => {
    respondWith(
      {
        error: {
          code: "NOT_FOUND",
          message: "Conversation not found",
          requestId: "req-7",
        },
      },
      { status: 404 },
    );

    const error = await failureOf(apiRequest("/api/conversations/x"));

    expect(error.message).toBe("Conversation not found");
    expect(error.code).toBe("NOT_FOUND");
    expect(error.requestId).toBe("req-7");
  });

  it("survives a body that is not JSON at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>502 Bad Gateway</html>", { status: 502 })),
    );

    const error = await failureOf(apiRequest("/api/health"));

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.status).toBe(502);
    expect(error.code).toBe("UNREADABLE");
  });

  /**
   * The bearer token arrives in a RESPONSE HEADER, not the body - and the two
   * differ. Missing this is why sign-in "succeeds" and every later request 401s.
   */
  it("hands the set-auth-token header to the caller", async () => {
    respondWith(
      { token: "body-token", user: { id: "u1" } },
      { headers: { "set-auth-token": "header-token" } },
    );

    let seen: string | null = null;
    await apiRequest("/api/auth/sign-in/email", {
      onAuthToken: (token) => (seen = token),
    });

    expect(seen).toBe("header-token");
  });
});
