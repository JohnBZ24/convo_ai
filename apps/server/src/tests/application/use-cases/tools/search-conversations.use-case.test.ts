import { searchConversationsTool } from "@convo/ai";
import { beforeEach, describe, expect, it } from "vitest";
import type { ToolExecutionContext } from "~/core/application/ports/tool-handler.port";
import {
  SEARCH_CONVERSATIONS_TOOL_NAME,
  SearchConversationsUseCase,
} from "~/core/application/use-cases/tools/search-conversations.use-case";
import { InMemoryConversationRepository } from "~/tests/support/in-memory-conversation.repository";

const OWNER = "user-owner";
const STRANGER = "user-stranger";

const asUser = (userId: string): ToolExecutionContext => ({
  userId,
  conversationId: null,
});

let conversations: InMemoryConversationRepository;
let search: SearchConversationsUseCase;

/** Create a conversation for `userId` whose first user turn is `text`. */
async function conversationSaying(userId: string, text: string) {
  const conversation = await conversations.create(userId);

  await conversations.appendTurn(userId, conversation.id, {
    seq: 1,
    role: "user",
    text,
    startedAt: null,
    endedAt: null,
    titleIfUnset: text,
  });

  return conversation;
}

beforeEach(() => {
  conversations = new InMemoryConversationRepository();
  search = new SearchConversationsUseCase(conversations);
});

describe("registration", () => {
  /**
   * The name is read from the declaration rather than retyped, so a rename in
   * `@convo/ai` cannot leave the container binding a handler to a dead name.
   */
  it("registers under the declared tool name", () => {
    expect(SEARCH_CONVERSATIONS_TOOL_NAME).toBe(searchConversationsTool.name);
  });
});

describe("searching", () => {
  it("matches on what was said, not only on the title", async () => {
    const conversation = await conversationSaying(OWNER, "How tall is Mount Fuji?");

    const result = await search.execute({ query: "tall", limit: 5 }, asUser(OWNER));

    expect(result.matches.map((match) => match.id)).toEqual([conversation.id]);
  });

  it("is case insensitive, because speech has no capitals", async () => {
    await conversationSaying(OWNER, "How tall is Mount Fuji?");

    const result = await search.execute({ query: "FUJI", limit: 5 }, asUser(OWNER));

    expect(result.matches).toHaveLength(1);
  });

  it("echoes the query back, so the model can phrase its answer", async () => {
    const result = await search.execute({ query: "fuji", limit: 5 }, asUser(OWNER));

    expect(result).toEqual({ query: "fuji", matches: [] });
  });

  it("honours the limit, so one tool call cannot pull a whole history", async () => {
    for (let i = 0; i < 5; i += 1) {
      await conversationSaying(OWNER, `Fuji question number ${i}`);
    }

    const result = await search.execute({ query: "fuji", limit: 2 }, asUser(OWNER));

    expect(result.matches).toHaveLength(2);
  });
});

/**
 * The whole reason this tool is `privileged` rather than `device`: it reads the
 * user's own data, and the identity it reads it as comes from the session.
 */
describe("ownership", () => {
  it("never returns another user's conversation, however well the text matches", async () => {
    await conversationSaying(STRANGER, "Fuji is my private business");

    const result = await search.execute({ query: "fuji", limit: 5 }, asUser(OWNER));

    expect(result.matches).toEqual([]);
  });

  it("takes the user from the context, which the model cannot reach", async () => {
    const mine = await conversationSaying(OWNER, "Fuji from me");
    await conversationSaying(STRANGER, "Fuji from them");

    const result = await search.execute({ query: "fuji", limit: 5 }, asUser(OWNER));

    expect(result.matches.map((match) => match.id)).toEqual([mine.id]);
  });
});

describe("what comes back", () => {
  /**
   * Titles and dates, never transcripts. Returning what was SAID would put the
   * user's whole history one prompt injection away, and would flood the model's
   * context to answer "which conversation was that?".
   */
  it("returns titles and metadata, not what was said", async () => {
    await conversationSaying(OWNER, "The launch code is hunter2");

    const result = await search.execute({ query: "launch", limit: 5 }, asUser(OWNER));
    const [match] = result.matches;

    expect(match).toBeDefined();
    expect(Object.keys(match ?? {}).sort()).toEqual([
      "id",
      "startedAt",
      "title",
      "turnCount",
    ]);
    // The title is derived from the first user turn, so it legitimately
    // contains that text - but no `text` or `turns` field is ever included.
    expect(match).not.toHaveProperty("turns");
    expect(match).not.toHaveProperty("text");
  });

  it("serialises startedAt as an ISO string, which is what the model reads", async () => {
    await conversationSaying(OWNER, "Fuji");

    const result = await search.execute({ query: "fuji", limit: 5 }, asUser(OWNER));

    expect(result.matches[0]?.startedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });

  it("never leaks userId onto the result", async () => {
    await conversationSaying(OWNER, "Fuji");

    const result = await search.execute({ query: "fuji", limit: 5 }, asUser(OWNER));

    expect(JSON.stringify(result)).not.toContain(OWNER);
  });
});
