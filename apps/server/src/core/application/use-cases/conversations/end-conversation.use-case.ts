import { ApplicationError } from "~/core/application/errors/application-error";
import type { ConversationRepository } from "~/core/application/ports/conversation-repository.port";
import type { Conversation } from "~/core/domain/entities/conversation.entity";

/**
 * Close a conversation - the second tap of the orb.
 *
 * Idempotent by design: ending an already-ended conversation succeeds and
 * returns the ORIGINAL `endedAt`. The device fires this as the call tears down,
 * which is the least reliable moment on a mobile connection, so a retry must
 * not be punished with an error for work that already landed.
 */
export class EndConversationUseCase {
  constructor(private readonly conversations: ConversationRepository) {}

  async execute(userId: string, id: string, at: Date): Promise<Conversation> {
    const conversation = await this.conversations.end(userId, id, at);

    if (!conversation) throw ApplicationError.notFound("Conversation not found");

    return conversation;
  }
}
