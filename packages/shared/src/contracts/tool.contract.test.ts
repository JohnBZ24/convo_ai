import { describe, expect, it } from "vitest";
import { mintRealtimeTokenBody, realtimeCredential } from "./realtime.contract";
import { executeToolBody, executeToolParams } from "./tool.contract";

/**
 * These schemas are the server's front door for a caller that is a language
 * model on a device the user controls. What they REFUSE matters more than what
 * they accept, so that is what is pinned here.
 */

describe("executeToolBody", () => {
  it("accepts a minimal call and defaults the arguments to an empty object", () => {
    expect(executeToolBody.parse({ callId: "call_abc" })).toEqual({
      callId: "call_abc",
      arguments: {},
    });
  });

  /**
   * THE assertion. There is no `userId` field, so a model that passes one has
   * it stripped by the parse rather than honoured. Adding one would be a
   * vulnerability, not a convenience.
   */
  it("has no field through which a caller can name a user", () => {
    const keys = Object.keys(executeToolBody.shape);

    expect(keys).not.toContain("userId");
    expect(keys).not.toContain("user_id");
    expect(keys.sort()).toEqual(["arguments", "callId", "conversationId"]);
  });

  it("requires a callId, since it is the idempotency key", () => {
    expect(executeToolBody.safeParse({}).success).toBe(false);
    expect(executeToolBody.safeParse({ callId: "" }).success).toBe(false);
  });

  /** Unbounded, this string becomes an unbounded database key. */
  it("bounds the callId", () => {
    expect(executeToolBody.safeParse({ callId: "x".repeat(129) }).success).toBe(false);
  });

  it("insists a conversationId be a real uuid when present", () => {
    expect(
      executeToolBody.safeParse({ callId: "c", conversationId: "not-a-uuid" }).success,
    ).toBe(false);
  });

  it("passes arguments through untouched - the tool's own schema validates them", () => {
    const parsed = executeToolBody.parse({
      callId: "c",
      arguments: { query: "fuji", nested: { deep: [1, 2] } },
    });

    expect(parsed.arguments).toEqual({ query: "fuji", nested: { deep: [1, 2] } });
  });
});

describe("executeToolParams", () => {
  it("bounds the tool name, which arrives in the URL", () => {
    expect(executeToolParams.safeParse({ name: "search_conversations" }).success).toBe(
      true,
    );
    expect(executeToolParams.safeParse({ name: "" }).success).toBe(false);
    expect(executeToolParams.safeParse({ name: "x".repeat(65) }).success).toBe(false);
  });
});

describe("mintRealtimeTokenBody", () => {
  it("accepts an empty body - the device may mint before opening a conversation", () => {
    expect(mintRealtimeTokenBody.parse({})).toEqual({});
  });

  it("rejects a conversationId that is not a uuid", () => {
    expect(mintRealtimeTokenBody.safeParse({ conversationId: "1" }).success).toBe(
      false,
    );
  });

  it("offers no way to ask for a different model or a longer expiry", () => {
    // Both are server configuration. A client that could choose its own model
    // could choose the most expensive one, and one that could choose its own
    // TTL could ask for the two-hour maximum.
    const keys = Object.keys(mintRealtimeTokenBody.shape);

    expect(keys).toEqual(["conversationId"]);
  });
});

describe("realtimeCredential", () => {
  const valid = {
    clientSecret: "ek_abc",
    expiresAt: "2026-08-25T12:01:00.000Z",
    expiresInSeconds: 60,
    model: "gpt-realtime-2",
    voice: "marin",
    sessionId: "sess_abc",
    callsUrl: "https://api.openai.com/v1/realtime/calls",
  };

  it("accepts the shape the mapper produces", () => {
    expect(realtimeCredential.safeParse(valid).success).toBe(true);
  });

  /**
   * The mapper converts Dates to ISO strings before the response contract is
   * checked, precisely so this fails - a Date here would mean the schema was
   * inspecting a shape the device never receives.
   */
  it("rejects a raw Date", () => {
    expect(
      realtimeCredential.safeParse({ ...valid, expiresAt: new Date() }).success,
    ).toBe(false);
  });

  /** An already-expired credential is a bug worth failing loudly on. */
  it("rejects a non-positive expiresInSeconds", () => {
    expect(
      realtimeCredential.safeParse({ ...valid, expiresInSeconds: 0 }).success,
    ).toBe(false);
  });
});
