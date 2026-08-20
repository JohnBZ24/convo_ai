import { describe, expect, it } from "vitest";
import { paginationQuery } from "./common.contract";
import {
  appendTurnBody,
  conversationSummary,
  endConversationBody,
  TURN_TEXT_MAX_LENGTH,
} from "./conversation.contract";

/**
 * These schemas are not just types: they are what the server validates with and
 * what the OpenAPI document is generated from. A change here changes the API's
 * behaviour and its documentation at once, so the rules worth relying on are
 * pinned down.
 */

describe("paginationQuery", () => {
  it("defaults limit, so a caller can omit it entirely", () => {
    expect(paginationQuery.parse({})).toEqual({ limit: 20 });
  });

  it("coerces the string a query string actually delivers", () => {
    expect(paginationQuery.parse({ limit: "50" }).limit).toBe(50);
  });

  it("caps limit, so one request cannot ask for the whole table", () => {
    expect(paginationQuery.safeParse({ limit: "1000" }).success).toBe(false);
    expect(paginationQuery.safeParse({ limit: "0" }).success).toBe(false);
  });
});

describe("appendTurnBody", () => {
  const valid = { seq: 1, role: "user", text: "hello" };

  it("accepts a minimal turn", () => {
    expect(appendTurnBody.parse(valid)).toMatchObject(valid);
  });

  /**
   * seq is the whole idempotency story: the device assigns it and the unique
   * index on (conversation_id, seq) turns a retry into a replay. A zero or
   * negative seq is a client bug and must not reach the database.
   */
  it.each([0, -1, 1.5])("rejects seq %s", (seq) => {
    expect(appendTurnBody.safeParse({ ...valid, seq }).success).toBe(false);
  });

  it("rejects an empty utterance and an unbounded one", () => {
    expect(appendTurnBody.safeParse({ ...valid, text: "" }).success).toBe(false);
    expect(
      appendTurnBody.safeParse({ ...valid, text: "x".repeat(TURN_TEXT_MAX_LENGTH + 1) })
        .success,
    ).toBe(false);
  });

  it("only knows two roles", () => {
    expect(appendTurnBody.safeParse({ ...valid, role: "system" }).success).toBe(false);
  });

  it("wants ISO timestamps, not epoch millis", () => {
    expect(
      appendTurnBody.safeParse({ ...valid, startedAt: "2026-08-20T10:00:00.000Z" })
        .success,
    ).toBe(true);
    expect(
      appendTurnBody.safeParse({ ...valid, startedAt: 1787227953440 }).success,
    ).toBe(false);
  });
});

describe("endConversationBody", () => {
  it("accepts only the one transition", () => {
    expect(endConversationBody.safeParse({ status: "ended" }).success).toBe(true);
  });

  /** A finished conversation does not reopen. */
  it("refuses to reactivate a conversation", () => {
    expect(endConversationBody.safeParse({ status: "active" }).success).toBe(false);
  });
});

describe("conversationSummary", () => {
  it("serialises timestamps as strings, which is what the device parses", () => {
    const result = conversationSummary.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      title: null,
      status: "active",
      turnCount: 0,
      lastTurnAt: null,
      startedAt: "2026-08-20T10:00:00.000Z",
      endedAt: null,
    });

    expect(result.success).toBe(true);
  });

  /**
   * The mapper in the server converts Dates before responding precisely so this
   * fails - if a Date slipped through, the response contract check would be
   * inspecting a shape the client never sees.
   */
  it("rejects a raw Date", () => {
    const result = conversationSummary.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      title: null,
      status: "active",
      turnCount: 0,
      lastTurnAt: null,
      startedAt: new Date(),
      endedAt: null,
    });

    expect(result.success).toBe(false);
  });

  it("does not leak userId onto the wire", () => {
    expect(Object.keys(conversationSummary.shape)).not.toContain("userId");
  });
});
