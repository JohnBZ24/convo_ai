import { type Database, schema } from "@convo/db";
import type {
  RecordToolInvocationInput,
  ToolInvocationRepository,
} from "~/core/application/ports/tool-invocation-repository.port";

const { toolInvocations } = schema;

/**
 * The audit trail for privileged tool calls.
 *
 * `idempotencyKey` is UNIQUE, and `onConflictDoNothing` is what turns a
 * collision into "this was already recorded" rather than an exception. An empty
 * `returning()` therefore means the device retried a call whose response it
 * never received - the same shape of answer `appendTurn` gives for a replayed
 * turn, for the same reason: a mobile network retries, and a retry is not an
 * error.
 */
export class DrizzleToolInvocationRepository implements ToolInvocationRepository {
  constructor(private readonly database: Database) {}

  async record(input: RecordToolInvocationInput): Promise<boolean> {
    const [row] = await this.database
      .insert(toolInvocations)
      .values({
        userId: input.userId,
        conversationId: input.conversationId,
        toolName: input.toolName,
        idempotencyKey: input.idempotencyKey,
        status: input.status,
        durationMs: input.durationMs,
      })
      .onConflictDoNothing({ target: toolInvocations.idempotencyKey })
      .returning({ id: toolInvocations.id });

    return row !== undefined;
  }
}
