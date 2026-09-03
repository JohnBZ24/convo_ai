import { ApplicationError } from "~/core/application/errors/application-error";
import type { ConversationRepository } from "~/core/application/ports/conversation-repository.port";
import type { Conversation } from "~/core/domain/entities/conversation.entity";

/**
 * Give a conversation the title the user chose.
 *
 * The only write in the system that overrides a derived title. `deriveTitle`
 * takes the first thing the user said, which is a reasonable guess and often a
 * bad name - so this exists to let them fix it, and it deliberately does not
 * care whether the conversation is still active.
 *
 * Nothing here validates the string: the length bound and the "not just
 * whitespace" rule are in `renameConversationBody`, so they are enforced at the
 * edge AND published in the OpenAPI document rather than being a private rule
 * of this class.
 */
export class RenameConversationUseCase {
  constructor(private readonly conversations: ConversationRepository) {}

  async execute(userId: string, id: string, title: string): Promise<Conversation> {
    const conversation = await this.conversations.rename(userId, id, title);

    if (!conversation) throw ApplicationError.notFound("Conversation not found");

    return conversation;
  }
}
