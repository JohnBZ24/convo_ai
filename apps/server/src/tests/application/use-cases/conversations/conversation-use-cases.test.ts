import { beforeEach, describe, expect, it } from "vitest";
import { ApplicationError } from "~/core/application/errors/application-error";
import { encodeCursor } from "~/core/application/pagination/keyset-cursor";
import { AppendTurnUseCase } from "~/core/application/use-cases/conversations/append-turn.use-case";
import { EndConversationUseCase } from "~/core/application/use-cases/conversations/end-conversation.use-case";
import { GetConversationUseCase } from "~/core/application/use-cases/conversations/get-conversation.use-case";
import { ListConversationsUseCase } from "~/core/application/use-cases/conversations/list-conversations.use-case";
import { StartConversationUseCase } from "~/core/application/use-cases/conversations/start-conversation.use-case";
import { InMemoryConversationRepository } from "~/tests/support/in-memory-conversation.repository";

const OWNER = "user-owner";
const STRANGER = "user-stranger";

let repository: InMemoryConversationRepository;
let start: StartConversationUseCase;
let list: ListConversationsUseCase;
let get: GetConversationUseCase;
let end: EndConversationUseCase;
let append: AppendTurnUseCase;

beforeEach(() => {
  repository = new InMemoryConversationRepository();
  start = new StartConversationUseCase(repository);
  list = new ListConversationsUseCase(repository);
  get = new GetConversationUseCase(repository);
  end = new EndConversationUseCase(repository);
  append = new AppendTurnUseCase(repository);
});

describe("starting a conversation", () => {
  it("opens it untitled and active - the title comes from the first user turn", async () => {
    const conversation = await start.execute(OWNER);

    expect(conversation.title).toBeNull();
    expect(conversation.status).toBe("active");
    expect(conversation.turnCount).toBe(0);
  });
});

/**
 * The rule that matters most in this file: another user's conversation is NOT
 * FOUND, never forbidden. A 403 would confirm the id exists.
 */
describe("ownership", () => {
  it("hides another user's conversation from every read", async () => {
    const conversation = await start.execute(OWNER);

    await expect(get.execute(STRANGER, conversation.id)).rejects.toMatchObject({
      kind: "not-found",
    });
  });

  it("hides it from every write too", async () => {
    const conversation = await start.execute(OWNER);

    await expect(end.execute(STRANGER, conversation.id, new Date())).rejects.toThrow(
      ApplicationError,
    );
    await expect(
      append.execute(STRANGER, conversation.id, {
        seq: 1,
        role: "user",
        text: "let me in",
        startedAt: null,
        endedAt: null,
      }),
    ).rejects.toMatchObject({ kind: "not-found" });
  });

  it("reports a conversation that never existed the same way", async () => {
    await expect(
      get.execute(OWNER, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toMatchObject({ kind: "not-found" });
  });
});

describe("appending turns", () => {
  it("stores the first turn and counts it", async () => {
    const conversation = await start.execute(OWNER);

    const result = await append.execute(OWNER, conversation.id, {
      seq: 1,
      role: "user",
      text: "How long is the Shinkansen from Tokyo to Kyoto?",
      startedAt: null,
      endedAt: null,
    });

    expect(result.replayed).toBe(false);
    expect(result.conversation.turnCount).toBe(1);
    expect(result.conversation.lastTurnAt).not.toBeNull();
  });

  it("treats the SAME seq as a replay: no duplicate, no second count", async () => {
    const conversation = await start.execute(OWNER);
    const turn = {
      seq: 1,
      role: "user" as const,
      text: "hello",
      startedAt: null,
      endedAt: null,
    };

    const first = await append.execute(OWNER, conversation.id, turn);
    const retry = await append.execute(OWNER, conversation.id, turn);

    expect(first.replayed).toBe(false);
    expect(retry.replayed).toBe(true);
    expect(retry.turn.id).toBe(first.turn.id);
    expect(retry.conversation.turnCount).toBe(1);
    expect(await repository.findTurns(conversation.id)).toHaveLength(1);
  });

  it("titles the conversation from the first USER turn", async () => {
    const conversation = await start.execute(OWNER);

    const result = await append.execute(OWNER, conversation.id, {
      seq: 1,
      role: "user",
      text: "What time does the last train leave?",
      startedAt: null,
      endedAt: null,
    });

    expect(result.conversation.title).toBe("What time does the last train leave?");
  });

  it("never titles it from the assistant, whose opening line is a greeting", async () => {
    const conversation = await start.execute(OWNER);

    const result = await append.execute(OWNER, conversation.id, {
      seq: 1,
      role: "assistant",
      text: "Hi there! How can I help you today?",
      startedAt: null,
      endedAt: null,
    });

    expect(result.conversation.title).toBeNull();
  });

  it("does not rename a conversation that already has a title", async () => {
    const conversation = await start.execute(OWNER);

    await append.execute(OWNER, conversation.id, {
      seq: 1,
      role: "user",
      text: "First thing said",
      startedAt: null,
      endedAt: null,
    });
    const second = await append.execute(OWNER, conversation.id, {
      seq: 2,
      role: "user",
      text: "Something else entirely",
      startedAt: null,
      endedAt: null,
    });

    expect(second.conversation.title).toBe("First thing said");
  });

  /**
   * Deliberate: the device ends the call and a turn POST already in flight
   * retries afterwards. Refusing it would silently lose the last thing the user
   * said.
   */
  it("still accepts a turn that lands after the conversation ended", async () => {
    const conversation = await start.execute(OWNER);
    await end.execute(OWNER, conversation.id, new Date());

    const late = await append.execute(OWNER, conversation.id, {
      seq: 1,
      role: "user",
      text: "one last thing",
      startedAt: null,
      endedAt: null,
    });

    expect(late.replayed).toBe(false);
    expect(late.conversation.status).toBe("ended");
  });
});

describe("ending a conversation", () => {
  it("stamps endedAt", async () => {
    const conversation = await start.execute(OWNER);
    const at = new Date("2026-08-20T12:00:00.000Z");

    const ended = await end.execute(OWNER, conversation.id, at);

    expect(ended.status).toBe("ended");
    expect(ended.endedAt).toEqual(at);
  });

  it("is idempotent, because the device retries as the call tears down", async () => {
    const conversation = await start.execute(OWNER);
    const first = new Date("2026-08-20T12:00:00.000Z");

    await end.execute(OWNER, conversation.id, first);
    const again = await end.execute(
      OWNER,
      conversation.id,
      new Date("2026-08-20T13:00:00.000Z"),
    );

    expect(again.endedAt).toEqual(first);
  });
});

describe("listing conversations", () => {
  it("returns newest first", async () => {
    const first = await start.execute(OWNER);
    const second = await start.execute(OWNER);

    const page = await list.execute(OWNER, { limit: 10 });

    expect(page.items.map((c) => c.id)).toEqual([second.id, first.id]);
  });

  it("shows only your own", async () => {
    await start.execute(OWNER);
    await start.execute(STRANGER);

    const page = await list.execute(OWNER, { limit: 10 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.userId).toBe(OWNER);
  });

  it("issues a cursor only when there is genuinely a next page", async () => {
    await start.execute(OWNER);
    await start.execute(OWNER);

    expect((await list.execute(OWNER, { limit: 2 })).nextCursor).toBeNull();
    expect((await list.execute(OWNER, { limit: 1 })).nextCursor).not.toBeNull();
  });

  /**
   * The reason for keyset over OFFSET: the user is scrolling a list that is
   * still being written to.
   */
  it("does not repeat or skip a row when one is inserted mid-scroll", async () => {
    const oldest = await start.execute(OWNER);
    const middle = await start.execute(OWNER);
    const newest = await start.execute(OWNER);

    const page1 = await list.execute(OWNER, { limit: 2 });
    expect(page1.items.map((c) => c.id)).toEqual([newest.id, middle.id]);

    // a new conversation arrives at the TOP while the user is reading page 1
    await start.execute(OWNER);

    const page2 = await list.execute(OWNER, {
      limit: 2,
      cursor: page1.nextCursor ?? undefined,
    });

    // with an offset this page would have started at `middle` again
    expect(page2.items.map((c) => c.id)).toEqual([oldest.id]);
    expect(page2.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor as bad input rather than failing in SQL", async () => {
    await expect(
      list.execute(OWNER, { limit: 10, cursor: "nonsense" }),
    ).rejects.toMatchObject({ kind: "invalid-input" });
  });

  it("accepts a cursor pointing past the end and returns nothing", async () => {
    await start.execute(OWNER);

    const page = await list.execute(OWNER, {
      limit: 10,
      cursor: encodeCursor({
        startedAt: new Date("2000-01-01T00:00:00.000Z"),
        id: "00000000-0000-4000-8000-000000000000",
      }),
    });

    expect(page.items).toHaveLength(0);
    expect(page.nextCursor).toBeNull();
  });
});
