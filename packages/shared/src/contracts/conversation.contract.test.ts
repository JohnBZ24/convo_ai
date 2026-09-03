import { describe, expect, it } from "vitest";
import { paginationQuery } from "./common.contract";
import {
  appendTurnBody,
  CONVERSATION_SEARCH_MAX_LENGTH,
  CONVERSATION_TITLE_MAX_LENGTH,
  conversationListQuery,
  conversationSummary,
  endConversationBody,
  renameConversationBody,
  TURN_TEXT_MAX_LENGTH,
  updateConversationBody,
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

describe("conversationListQuery", () => {
  it("treats an absent q as 'list everything'", () => {
    expect(conversationListQuery.parse({})).toEqual({ limit: 20 });
  });

  it("keeps the pagination it extends", () => {
    expect(conversationListQuery.parse({ limit: "50", q: "dentist" })).toEqual({
      limit: 50,
      q: "dentist",
    });
  });

  it("trims, because a phone keyboard adds a trailing space constantly", () => {
    expect(conversationListQuery.parse({ q: "  dentist  " }).q).toBe("dentist");
  });

  /**
   * An empty q must NOT quietly mean "everything". `%%` matches every row, and
   * a search that silently becomes a full history dump is the exact failure
   * this API guards against on the model's side of the same predicate.
   */
  it("rejects an empty q rather than treating it as no filter", () => {
    expect(conversationListQuery.safeParse({ q: "" }).success).toBe(false);
    expect(conversationListQuery.safeParse({ q: "   " }).success).toBe(false);
  });

  it("bounds the term, so a scan cannot be handed a novel", () => {
    const tooLong = "x".repeat(CONVERSATION_SEARCH_MAX_LENGTH + 1);
    expect(conversationListQuery.safeParse({ q: tooLong }).success).toBe(false);
  });
});

describe("renameConversationBody", () => {
  it("takes the title the user typed", () => {
    expect(renameConversationBody.parse({ title: "Dentist" })).toEqual({
      title: "Dentist",
    });
  });

  /** Surrounding space is the user's typing, not part of what they meant. */
  it("trims before it validates", () => {
    expect(renameConversationBody.parse({ title: "  Dentist  " }).title).toBe(
      "Dentist",
    );
  });

  /**
   * A whitespace-only title would draw as a blank sidebar row that cannot be
   * told apart from a broken one, so it is rejected rather than stored.
   */
  it("rejects a title that is empty once trimmed", () => {
    expect(renameConversationBody.safeParse({ title: "   " }).success).toBe(false);
    expect(renameConversationBody.safeParse({ title: "" }).success).toBe(false);
  });

  it("caps it at the same length as a derived title", () => {
    const tooLong = "x".repeat(CONVERSATION_TITLE_MAX_LENGTH + 1);
    expect(renameConversationBody.safeParse({ title: tooLong }).success).toBe(false);
  });

  /** There is no "make this untitled again" - null is a server-side state. */
  it("does not accept null", () => {
    expect(renameConversationBody.safeParse({ title: null }).success).toBe(false);
  });
});

describe("updateConversationBody", () => {
  it("accepts either intent", () => {
    expect(updateConversationBody.safeParse({ title: "Dentist" }).success).toBe(true);
    expect(updateConversationBody.safeParse({ status: "ended" }).success).toBe(true);
  });

  /**
   * The reason this is a union rather than two optional fields: an empty body
   * is rejected by the SCHEMA, which JSON Schema can express, rather than by a
   * refinement that would vanish from the published document.
   */
  it("rejects a PATCH that asks for nothing", () => {
    expect(updateConversationBody.safeParse({}).success).toBe(false);
  });

  it("reads a body carrying both as a rename, which is the declared order", () => {
    const parsed = updateConversationBody.parse({ title: "Dentist", status: "ended" });

    expect(parsed).toEqual({ title: "Dentist" });
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
