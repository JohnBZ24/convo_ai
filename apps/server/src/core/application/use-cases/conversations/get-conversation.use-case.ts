import { ApplicationError } from "~/core/application/errors/application-error";
import type { ConversationRepository } from "~/core/application/ports/conversation-repository.port";
import type { Conversation } from "~/core/domain/entities/conversation.entity";
import type { Turn } from "~/core/domain/entities/turn.entity";

export interface ConversationWithTurns {
  conversation: Conversation;
  turns: Turn[];
}

/**
 * One conversation and everything said in it.
 *
 * The turns are only fetched AFTER ownership is established, so a probe for
 * someone else's conversation costs one indexed lookup and reveals nothing.
 */
export class GetConversationUseCase {
  constructor(private readonly conversations: ConversationRepository) {}

  async execute(userId: string, id: string): Promise<ConversationWithTurns> {
    const conversation = await this.conversations.findById(userId, id);

    // Not "you may not have this" - as far as this user is concerned, it does
    // not exist. Saying otherwise would confirm the id to a stranger.
    if (!conversation) throw ApplicationError.notFound("Conversation not found");

    return { conversation, turns: await this.conversations.findTurns(id) };
  }
}
