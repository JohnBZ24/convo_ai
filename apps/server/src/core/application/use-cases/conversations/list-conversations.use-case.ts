import {
  decodeCursor,
  encodeCursor,
} from "~/core/application/pagination/keyset-cursor";
import type { ConversationRepository } from "~/core/application/ports/conversation-repository.port";
import type { Conversation } from "~/core/domain/entities/conversation.entity";

export interface ListConversationsResult {
  items: Conversation[];
  nextCursor: string | null;
}

/**
 * The sidebar's feed: newest first, keyset paginated.
 *
 * Keyset rather than OFFSET because the user is scrolling a list that is still
 * being written to. With an offset, starting a new conversation mid-scroll
 * shifts every subsequent row down one and the next page repeats an item. A
 * cursor names a POSITION, so nothing inserted above it can disturb the page.
 */
export class ListConversationsUseCase {
  constructor(private readonly conversations: ConversationRepository) {}

  async execute(
    userId: string,
    options: { limit: number; cursor?: string | undefined },
  ): Promise<ListConversationsResult> {
    const after = options.cursor ? decodeCursor(options.cursor) : null;

    const page = await this.conversations.list(userId, {
      limit: options.limit,
      after,
    });

    const last = page.items.at(-1);

    return {
      items: page.items,
      // A cursor is only issued when there is genuinely more to fetch, so the
      // client stops on a null rather than on an empty page.
      nextCursor:
        page.hasMore && last
          ? encodeCursor({ startedAt: last.startedAt, id: last.id })
          : null,
    };
  }
}
