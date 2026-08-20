import type { TurnRole } from "@convo/shared";
import type { KeysetPosition } from "~/core/application/pagination/keyset-cursor";
import type { Conversation } from "~/core/domain/entities/conversation.entity";
import type { Turn } from "~/core/domain/entities/turn.entity";

/**
 * Persistence for the conversation aggregate.
 *
 * Turns have no repository of their own on purpose. They are only reachable
 * through the conversation that owns them, so there is no method here that can
 * be called without a `userId` - and therefore no way to write a query that
 * forgets the ownership filter. That is the invariant this interface exists to
 * make structural rather than remembered.
 *
 * NestJS note: this is the `Repository<T>` you would inject. The difference is
 * that it is declared HERE, in the layer that consumes it, and implemented in
 * infrastructure - so the use cases compile with no database in the graph.
 */

export interface ListConversationsOptions {
  limit: number;
  /** Exclusive: return rows strictly after this position in the ordering. */
  after: KeysetPosition | null;
}

export interface ConversationPage {
  items: Conversation[];
  /** Whether a further page exists. The use case turns this into a cursor. */
  hasMore: boolean;
}

export interface AppendTurnInput {
  seq: number;
  role: TurnRole;
  text: string;
  startedAt: Date | null;
  endedAt: Date | null;
  /**
   * Applied ONLY if the conversation has no title yet and the insert actually
   * happened. Computed by the use case (the "first user turn names it" rule is
   * policy) but applied inside the repository's transaction, because it has to
   * be atomic with the insert.
   */
  titleIfUnset: string | null;
}

export interface AppendTurnResult {
  turn: Turn;
  /** The conversation AFTER the append, with counters already updated. */
  conversation: Conversation;
  /** True when this seq was already stored, so nothing changed. */
  replayed: boolean;
}

export interface ConversationRepository {
  create(userId: string): Promise<Conversation>;

  /** Null when no such conversation belongs to this user. */
  findById(userId: string, id: string): Promise<Conversation | null>;

  /** Ordered by seq. The conversation's ownership must already be established. */
  findTurns(conversationId: string): Promise<Turn[]>;

  list(userId: string, options: ListConversationsOptions): Promise<ConversationPage>;

  /**
   * Marks the conversation ended. Null when it is not this user's.
   * Already-ended conversations are returned unchanged - see Conversation.end.
   */
  end(userId: string, id: string, at: Date): Promise<Conversation | null>;

  /** Null when the conversation is not this user's. */
  appendTurn(
    userId: string,
    conversationId: string,
    input: AppendTurnInput,
  ): Promise<AppendTurnResult | null>;
}
