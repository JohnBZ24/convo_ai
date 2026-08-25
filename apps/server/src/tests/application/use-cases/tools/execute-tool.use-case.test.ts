import { beforeEach, describe, expect, it } from "vitest";
import type {
  ToolExecutionContext,
  ToolHandler,
  ToolHandlerRegistry,
} from "~/core/application/ports/tool-handler.port";
import { ExecuteToolUseCase } from "~/core/application/use-cases/tools/execute-tool.use-case";
import { SearchConversationsUseCase } from "~/core/application/use-cases/tools/search-conversations.use-case";
import { InMemoryConversationRepository } from "~/tests/support/in-memory-conversation.repository";
import { InMemoryToolInvocationRepository } from "~/tests/support/realtime-and-tool-doubles";

/**
 * This endpoint is reachable by a language model running on a device the user
 * controls, and the user may have been prompt-injected. Every test below is a
 * statement about what that model CANNOT do.
 */

const OWNER = "user-owner";
const STRANGER = "user-stranger";

class RecordingHandler implements ToolHandler<{ query: string }, unknown> {
  readonly calls: { args: unknown; context: ToolExecutionContext }[] = [];
  throwOnCall: Error | null = null;

  async execute(args: { query: string }, context: ToolExecutionContext) {
    this.calls.push({ args, context });
    if (this.throwOnCall) throw this.throwOnCall;
    return { matched: args.query };
  }
}

let invocations: InMemoryToolInvocationRepository;
let handler: RecordingHandler;
let execute: ExecuteToolUseCase;

/** A monotonic fake clock, so durations are asserted rather than tolerated. */
let clock: number;

function build(handlers: ToolHandlerRegistry) {
  clock = 1000;
  return new ExecuteToolUseCase(handlers, invocations, () => {
    clock += 5;
    return clock;
  });
}

beforeEach(() => {
  invocations = new InMemoryToolInvocationRepository();
  handler = new RecordingHandler();
  execute = build({
    search_conversations: handler as unknown as ToolHandler<never, unknown>,
  });
});

describe("the three refusals, which are deliberately different", () => {
  /** The model hallucinated a tool. Nothing of ours was reached. */
  it("answers not-found for a tool that does not exist", async () => {
    await expect(
      execute.execute(OWNER, {
        toolName: "wipe_database",
        callId: "c1",
        arguments: {},
      }),
    ).rejects.toMatchObject({ kind: "not-found" });

    expect(invocations.rows).toHaveLength(0);
  });

  /**
   * Real tool, wrong executor. The server has no better clock than the phone,
   * and proxying it would make the device/privileged split a naming convention
   * rather than a boundary.
   */
  it("answers forbidden for a device tool, and never runs it", async () => {
    await expect(
      execute.execute(OWNER, {
        toolName: "get_current_time",
        callId: "c2",
        arguments: {},
      }),
    ).rejects.toMatchObject({ kind: "forbidden" });

    expect(invocations.rows).toHaveLength(0);
  });

  /**
   * OUR bug, not the caller's - so NOT an ApplicationError. It becomes a 500
   * with the detail withheld, which is why this assertion is about the type:
   * reporting it as a 4xx would blame the device for a tool we forgot to wire.
   */
  it("throws a plain Error when a declared privileged tool has no handler", async () => {
    execute = build({});

    await expect(
      execute.execute(OWNER, {
        toolName: "search_conversations",
        callId: "c3",
        arguments: { query: "fuji" },
      }),
    ).rejects.toThrow(/no registered handler/);
  });
});

describe("arguments", () => {
  it("validates against the tool's own declared schema", async () => {
    await expect(
      execute.execute(OWNER, {
        toolName: "search_conversations",
        callId: "c4",
        arguments: { query: "" },
      }),
    ).rejects.toMatchObject({ kind: "invalid-input" });

    expect(handler.calls).toHaveLength(0);
  });

  it("applies the schema defaults, so a handler never sees an absent field", async () => {
    await execute.execute(OWNER, {
      toolName: "search_conversations",
      callId: "c5",
      arguments: { query: "fuji" },
    });

    expect(handler.calls[0]?.args).toEqual({ query: "fuji", limit: 5 });
  });

  /**
   * THE test. A model can be talked into passing any user id; the schema does
   * not declare one, so the parse discards it and the handler is handed the
   * identity that came from the bearer token.
   */
  it("ignores a userId smuggled into the arguments", async () => {
    await execute.execute(OWNER, {
      toolName: "search_conversations",
      callId: "c6",
      arguments: { query: "fuji", userId: STRANGER, user_id: STRANGER },
    });

    expect(handler.calls[0]?.context.userId).toBe(OWNER);
    expect(handler.calls[0]?.args).toEqual({ query: "fuji", limit: 5 });
  });
});

describe("the audit trail", () => {
  it("records a successful call with its duration", async () => {
    const result = await execute.execute(OWNER, {
      toolName: "search_conversations",
      callId: "c7",
      arguments: { query: "fuji" },
      conversationId: "11111111-1111-4111-8111-111111111111",
    });

    expect(result).toMatchObject({
      toolName: "search_conversations",
      callId: "c7",
      replayed: false,
      durationMs: 5,
    });
    expect(invocations.rows[0]).toMatchObject({
      userId: OWNER,
      toolName: "search_conversations",
      status: "ok",
      conversationId: "11111111-1111-4111-8111-111111111111",
    });
  });

  /**
   * Recording only successes would leave the one column worth reading - what
   * did this model try that did not work - permanently empty.
   */
  it("records a failure too, and rethrows it untouched", async () => {
    handler.throwOnCall = new Error("database on fire");

    await expect(
      execute.execute(OWNER, {
        toolName: "search_conversations",
        callId: "c8",
        arguments: { query: "fuji" },
      }),
    ).rejects.toThrow("database on fire");

    expect(invocations.rows[0]).toMatchObject({ status: "error" });
  });

  it("reports a repeated callId as replayed rather than as an error", async () => {
    const call = {
      toolName: "search_conversations",
      callId: "same-call",
      arguments: { query: "fuji" },
    };

    const first = await execute.execute(OWNER, call);
    const second = await execute.execute(OWNER, call);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
  });

  /**
   * `idempotency_key` is globally unique but OpenAI's `call_id` is only unique
   * within one session. Unscoped, one user's call could collide with another's
   * and be silently reported as a replay - so the key carries the user.
   */
  it("scopes the idempotency key by user, so two users cannot collide", async () => {
    const call = {
      toolName: "search_conversations",
      callId: "identical",
      arguments: { query: "fuji" },
    };

    const mine = await execute.execute(OWNER, call);
    const theirs = await execute.execute(STRANGER, call);

    expect(mine.replayed).toBe(false);
    expect(theirs.replayed).toBe(false);
    expect(invocations.rows.map((row) => row.idempotencyKey)).toEqual([
      `${OWNER}:identical`,
      `${STRANGER}:identical`,
    ]);
  });
});

/**
 * Wired to the real handler rather than a double, because the thing being
 * tested is the SEAM: dispatch by name, parse with the declared schema, hand
 * the result back in the shape the device forwards to the model.
 */
describe("end to end through the real search handler", () => {
  it("returns only the caller's conversations", async () => {
    const conversations = new InMemoryConversationRepository();

    const mine = await conversations.create(OWNER);
    await conversations.appendTurn(OWNER, mine.id, {
      seq: 1,
      role: "user",
      text: "How tall is Mount Fuji?",
      startedAt: null,
      endedAt: null,
      titleIfUnset: "How tall is Mount Fuji?",
    });

    const theirs = await conversations.create(STRANGER);
    await conversations.appendTurn(STRANGER, theirs.id, {
      seq: 1,
      role: "user",
      text: "Fuji is my secret",
      startedAt: null,
      endedAt: null,
      titleIfUnset: "Fuji is my secret",
    });

    execute = build({
      search_conversations: new SearchConversationsUseCase(
        conversations,
      ) as unknown as ToolHandler<never, unknown>,
    });

    const result = await execute.execute(OWNER, {
      toolName: "search_conversations",
      callId: "c9",
      arguments: { query: "fuji" },
    });

    const payload = result.result as { matches: { id: string }[] };

    expect(payload.matches.map((match) => match.id)).toEqual([mine.id]);
  });
});
