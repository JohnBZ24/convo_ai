import { type Database, schema } from "@convo/db";
import type {
  RealtimeSessionRepository,
  RecordRealtimeSessionInput,
} from "~/core/application/ports/realtime-session-repository.port";

const { realtimeSessions } = schema;

/**
 * One row per credential issued.
 *
 * Note what is NOT written: the `ek_...` value itself. The port has no field
 * for it and this insert has no column for it, so storing it would take a
 * schema change and a deliberate decision - which is the point. A credential
 * that exists in a database for longer than its sixty-second life is a
 * liability with no upside.
 */
export class DrizzleRealtimeSessionRepository implements RealtimeSessionRepository {
  constructor(private readonly database: Database) {}

  async record(input: RecordRealtimeSessionInput): Promise<void> {
    await this.database.insert(realtimeSessions).values({
      userId: input.userId,
      conversationId: input.conversationId,
      model: input.model,
      voice: input.voice,
      expiresAt: input.expiresAt,
    });
  }
}
