import type { TurnRole } from "@convo/shared";
import { ApplicationError } from "~/core/application/errors/application-error";
import type {
  AppendTurnResult,
  ConversationRepository,
} from "~/core/application/ports/conversation-repository.port";
import { Conversation } from "~/core/domain/entities/conversation.entity";

export interface AppendTurnCommand {
  seq: number;
  role: TurnRole;
  text: string;
  startedAt: Date | null;
  endedAt: Date | null;
}

/**
 * Record one completed utterance.
 *
 * This is the only write on the hot path, and it is the one that has to survive
 * a bad network. The device posts each turn as it finishes and retries on
 * failure, so the same turn - same `seq` - can arrive twice. The unique index
 * on `(conversation_id, seq)` turns the second arrival into a no-op, and the
 * caller is told `replayed: true` rather than being handed an error for a
 * request that was, from its point of view, successful.
 *
 * A turn may still be appended to an ENDED conversation. That looks wrong until
 * you follow the timing: the device ends the call and a turn POST that was
 * already in flight retries afterwards. Refusing it would silently lose the
 * last thing the user said, which is worse than a conversation whose final turn
 * arrived a second after it closed.
 */
export class AppendTurnUseCase {
  constructor(private readonly conversations: ConversationRepository) {}

  async execute(
    userId: string,
    conversationId: string,
    command: AppendTurnCommand,
  ): Promise<AppendTurnResult> {
    const result = await this.conversations.appendTurn(userId, conversationId, {
      ...command,
      /**
       * The naming rule lives here, in policy: only the user's words title a
       * conversation, and only when it has no title yet. Whether it is still
       * untitled by the time this row lands is a question only the transaction
       * can answer, so the repository decides whether to apply it.
       */
      titleIfUnset:
        command.role === "user" ? Conversation.deriveTitle(command.text) : null,
    });

    if (!result) throw ApplicationError.notFound("Conversation not found");

    return result;
  }
}
