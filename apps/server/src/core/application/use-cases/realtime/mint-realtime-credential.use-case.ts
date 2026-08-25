import { ApplicationError } from "~/core/application/errors/application-error";
import type { ConversationRepository } from "~/core/application/ports/conversation-repository.port";
import type {
  MintedCredential,
  RealtimeCredentialMinter,
} from "~/core/application/ports/realtime-credential-minter.port";
import type { RealtimeSessionRepository } from "~/core/application/ports/realtime-session-repository.port";

export interface MintRealtimeCredentialCommand {
  /** Optional: the device may mint before it has opened a conversation. */
  conversationId?: string | undefined;
}

export interface RealtimeSessionSettings {
  model: string;
  voice: string;
}

/**
 * Trade the server's API key for a credential the device can safely hold.
 *
 * This is the endpoint that costs money, so the order of operations matters:
 *
 *   1. If a conversation was named, PROVE IT IS THIS USER'S first. Minting is
 *      billable, so an unauthorised request must be refused before it spends
 *      anything - and a stranger's conversation id must not be confirmed as
 *      real, hence 404 rather than 403.
 *   2. Mint.
 *   3. Record the audit row.
 *
 * The rate limit that protects the budget lives in middleware rather than here,
 * because "20 mints an hour" is a property of the ENDPOINT - the same use case
 * called from a script or a job should not inherit an HTTP-shaped budget.
 */
export class MintRealtimeCredentialUseCase {
  constructor(
    private readonly minter: RealtimeCredentialMinter,
    private readonly sessions: RealtimeSessionRepository,
    private readonly conversations: ConversationRepository,
    /**
     * Injected, not read from `process.env` in here. The core stays free of
     * configuration, and a test can mint with any model without an environment.
     */
    private readonly settings: RealtimeSessionSettings,
  ) {}

  async execute(
    userId: string,
    command: MintRealtimeCredentialCommand = {},
  ): Promise<MintedCredential> {
    const conversationId = command.conversationId ?? null;

    if (conversationId) {
      const conversation = await this.conversations.findById(userId, conversationId);

      // Not "you may not use this one" - as far as this user is concerned it
      // does not exist. A 403 here would confirm the id to a stranger.
      if (!conversation) throw ApplicationError.notFound("Conversation not found");
    }

    const credential = await this.minter.mint({
      model: this.settings.model,
      voice: this.settings.voice,
    });

    /**
     * Recorded AFTER a successful mint, so the table counts credentials that
     * were actually issued rather than attempts. The model and voice stored are
     * the ones the UPSTREAM applied, not the ones requested - if OpenAI ever
     * substitutes, the audit trail should say what really happened.
     */
    await this.sessions.record({
      userId,
      conversationId,
      model: credential.model,
      voice: credential.voice,
      expiresAt: credential.expiresAt,
    });

    return credential;
  }
}
