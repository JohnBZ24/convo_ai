import { findTool } from "@convo/ai";
import { z } from "zod";
import { ApplicationError } from "~/core/application/errors/application-error";
import type {
  ToolExecutionContext,
  ToolHandlerRegistry,
} from "~/core/application/ports/tool-handler.port";
import type { ToolInvocationRepository } from "~/core/application/ports/tool-invocation-repository.port";

export interface ExecuteToolCommand {
  toolName: string;
  /** OpenAI's `call_id`. Scoped by user to build the idempotency key. */
  callId: string;
  /** Straight from the model. Untrusted until the tool's schema has parsed it. */
  arguments: Record<string, unknown>;
  conversationId?: string | undefined;
}

export interface ExecuteToolResult {
  toolName: string;
  callId: string;
  result: unknown;
  replayed: boolean;
  durationMs: number;
}

/**
 * Run one privileged tool on behalf of the signed-in user.
 *
 * THE THREAT MODEL, because every line below is shaped by it: the model runs on
 * the user's phone, the user can say anything to it, and a web page or a
 * document read aloud can inject instructions into it. So this use case treats
 * the tool name and the arguments as hostile input, and takes the identity from
 * `userId` - a parameter the caller cannot influence.
 *
 * The three refusals are deliberately DIFFERENT, because they mean different
 * things to whoever is debugging:
 *
 *   unknown name      -> not-found  (404) the model invented a tool
 *   device tool       -> forbidden  (403) real tool, wrong executor
 *   no handler bound  -> Error      (500) OUR bug: declared but not implemented
 *
 * The last one is deliberately not an ApplicationError. It is not a caller
 * mistake and must not be reported as one; it surfaces as a 500 with the detail
 * withheld and the full error in the logs, and a test asserts it so a tool that
 * is declared but never implemented cannot ship quietly.
 */
export class ExecuteToolUseCase {
  constructor(
    private readonly handlers: ToolHandlerRegistry,
    private readonly invocations: ToolInvocationRepository,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async execute(
    userId: string,
    command: ExecuteToolCommand,
  ): Promise<ExecuteToolResult> {
    const { toolName, callId } = command;

    const definition = findTool(toolName);
    if (!definition) {
      throw ApplicationError.notFound(`No tool named "${toolName}"`);
    }

    /**
     * A device tool is never proxied, even though running it here would
     * "work". The split is the whole point: if the server executed whatever
     * the model asked it to, the privileged/device distinction would be a
     * naming convention rather than a boundary.
     */
    if (definition.execution === "device") {
      throw ApplicationError.forbidden(
        `"${toolName}" runs on the device and is not executed by the server`,
      );
    }

    const handler = this.handlers[toolName];
    if (!handler) {
      // Ours to fix, not the caller's. 500, with nothing leaked outward.
      throw new Error(
        `tool "${toolName}" is declared privileged but has no registered handler`,
      );
    }

    /**
     * Parsed with the tool's OWN schema - the same object that generated the
     * JSON Schema the model was given. A hallucinated or malformed argument
     * therefore fails here, before any handler sees it, with field-level detail
     * the device can report back to the model so it can correct itself.
     */
    const parsed = definition.input.safeParse(command.arguments);
    if (!parsed.success) {
      throw ApplicationError.invalidInput(
        `Arguments for "${toolName}" are not valid`,
        z.treeifyError(parsed.error),
      );
    }

    const context: ToolExecutionContext = {
      // From the session. Any `userId` in `command.arguments` was discarded by
      // the parse above, because no tool declares one.
      userId,
      conversationId: command.conversationId ?? null,
    };

    const startedAt = this.now();
    let status: "ok" | "error" = "ok";

    try {
      const result = await handler.execute(parsed.data as never, context);
      const durationMs = this.now() - startedAt;

      const recorded = await this.record(userId, command, status, durationMs);

      return { toolName, callId, result, replayed: !recorded, durationMs };
    } catch (error) {
      status = "error";
      /**
       * A failure is audited too, then rethrown untouched. Recording only the
       * successes would make the one column worth reading - "what did this
       * model try that did not work" - the one column that is always empty.
       */
      await this.record(userId, command, status, this.now() - startedAt);
      throw error;
    }
  }

  /**
   * Returns whether the row was NEW. A false means this `callId` was already
   * recorded, i.e. the device retried a call whose response it never received.
   *
   * The key is scoped by user because `idempotency_key` is globally unique and
   * `call_id` is only unique within one OpenAI session - unscoped, one user's
   * call could collide with another's and silently look like a replay.
   */
  private record(
    userId: string,
    command: ExecuteToolCommand,
    status: "ok" | "error",
    durationMs: number,
  ): Promise<boolean> {
    return this.invocations.record({
      userId,
      conversationId: command.conversationId ?? null,
      toolName: command.toolName,
      idempotencyKey: `${userId}:${command.callId}`,
      status,
      durationMs,
    });
  }
}
