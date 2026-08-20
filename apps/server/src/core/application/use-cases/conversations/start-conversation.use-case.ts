import type { ConversationRepository } from "~/core/application/ports/conversation-repository.port";
import type { Conversation } from "~/core/domain/entities/conversation.entity";

/**
 * Open a conversation.
 *
 * It starts untitled: the title is derived from the first thing the USER says,
 * which has not happened yet. The device calls this before minting a realtime
 * credential so every turn has somewhere to go from the first word.
 */
export class StartConversationUseCase {
  constructor(private readonly conversations: ConversationRepository) {}

  execute(userId: string): Promise<Conversation> {
    return this.conversations.create(userId);
  }
}
