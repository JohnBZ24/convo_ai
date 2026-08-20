import { CONVERSATION_TITLE_MAX_LENGTH } from "@convo/shared";
import { describe, expect, it } from "vitest";
import { Conversation } from "~/core/domain/entities/conversation.entity";

function make(
  overrides: Partial<Parameters<typeof Conversation.fromPersistence>[0]> = {},
) {
  return Conversation.fromPersistence({
    id: "11111111-1111-4111-8111-111111111111",
    userId: "user-1",
    title: null,
    status: "active",
    turnCount: 0,
    lastTurnAt: null,
    startedAt: new Date("2026-08-20T10:00:00.000Z"),
    endedAt: null,
    ...overrides,
  });
}

describe("Conversation.deriveTitle", () => {
  it("uses a short utterance verbatim", () => {
    expect(Conversation.deriveTitle("How do I get to Shibuya?")).toBe(
      "How do I get to Shibuya?",
    );
  });

  it("collapses the whitespace speech-to-text leaves behind", () => {
    expect(Conversation.deriveTitle("  what   is\n\nthe  time ")).toBe(
      "what is the time",
    );
  });

  it("truncates at a word boundary, never mid-word", () => {
    const title = Conversation.deriveTitle(
      "Tell me everything you know about the history of the Japanese tea ceremony and its regional variations",
    );

    expect(title).not.toBeNull();
    expect(title?.endsWith("...")).toBe(true);
    // "…" replaces the cut, so the result may exceed the limit by those 3 chars
    expect(title?.length).toBeLessThanOrEqual(CONVERSATION_TITLE_MAX_LENGTH + 3);
    // the last word before the ellipsis must be a whole word from the input
    expect(title?.slice(0, -3).split(" ").at(-1)).not.toBe("");
    expect(title).toBe(
      "Tell me everything you know about the history of the Japanese tea ceremony and...",
    );
  });

  it("hard-cuts when the very first word is longer than the limit", () => {
    const title = Conversation.deriveTitle("a".repeat(200));
    expect(title).toBe(`${"a".repeat(CONVERSATION_TITLE_MAX_LENGTH)}...`);
  });

  it("returns null for an empty or whitespace-only utterance, leaving it untitled", () => {
    expect(Conversation.deriveTitle("")).toBeNull();
    expect(Conversation.deriveTitle("   \n ")).toBeNull();
  });
});

describe("Conversation.end", () => {
  it("returns a NEW instance rather than mutating", () => {
    const active = make();
    const ended = active.end(new Date("2026-08-20T11:00:00.000Z"));

    expect(ended).not.toBe(active);
    expect(active.status).toBe("active");
    expect(active.endedAt).toBeNull();
    expect(ended.status).toBe("ended");
  });

  it("is idempotent: a retry keeps the ORIGINAL endedAt", () => {
    const firstEnd = new Date("2026-08-20T11:00:00.000Z");
    const ended = make().end(firstEnd);

    const again = ended.end(new Date("2026-08-20T12:00:00.000Z"));

    expect(again.endedAt).toEqual(firstEnd);
    // and it does not even allocate: nothing changed
    expect(again).toBe(ended);
  });

  it("keeps identity, so the two are the same conversation", () => {
    const active = make();
    expect(active.equals(active.end(new Date()))).toBe(true);
  });
});
