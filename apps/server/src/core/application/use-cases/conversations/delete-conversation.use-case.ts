import { ApplicationError } from "~/core/application/errors/application-error";
import type { ConversationRepository } from "~/core/application/ports/conversation-repository.port";

/**
 * Erase a conversation and everything said in it.
 *
 * NOT idempotent, and that is the deliberate difference from `end`. Ending is
 * something the device fires as a call tears down, so a retry has to succeed;
 * deleting is something a person taps once, and answering 404 to the second
 * attempt is the honest reply - the row really is gone. A device retrying a
 * delete has nothing to lose from it either: the conversation it wanted gone is
 * gone.
 *
 * The turns go with it by cascade. The audit rows do not - see the port.
 */
export class DeleteConversationUseCase {
  constructor(private readonly conversations: ConversationRepository) {}

  async execute(userId: string, id: string): Promise<void> {
    const deleted = await this.conversations.delete(userId, id);

    // Same 404 as every other miss, for the same reason: another user's
    // conversation must be indistinguishable from one that does not exist.
    if (!deleted) throw ApplicationError.notFound("Conversation not found");
  }
}
