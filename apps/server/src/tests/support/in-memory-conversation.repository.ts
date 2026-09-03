import type {
  AppendTurnInput,
  AppendTurnResult,
  ConversationPage,
  ConversationRepository,
  ListConversationsOptions,
  SearchConversationsOptions,
} from "~/core/application/ports/conversation-repository.port";
import { Conversation } from "~/core/domain/entities/conversation.entity";
import { Turn } from "~/core/domain/entities/turn.entity";

/**
 * A conversation repository that lives in an array.
 *
 * This is the payoff of the port: every use-case test below runs against this
 * and therefore needs no Postgres, no migrations and no cleanup - so the tests
 * are fast, parallel-safe, and fail for exactly one reason.
 *
 * It reproduces the two behaviours the real one is trusted for - ownership in
 * the WHERE clause, and idempotent append - because a fake that is more
 * permissive than the real thing tests nothing.
 */
export class InMemoryConversationRepository implements ConversationRepository {
  private readonly conversations = new Map<string, Conversation>();
  private readonly turns = new Map<string, Turn[]>();
  private sequence = 0;

  private nextId(prefix: string) {
    this.sequence += 1;
    return `${prefix}${String(this.sequence).padStart(8, "0")}-1111-4111-8111-111111111111`.slice(
      0,
      36,
    );
  }

  async create(userId: string): Promise<Conversation> {
    const conversation = Conversation.fromPersistence({
      id: this.nextId("c"),
      userId,
      title: null,
      status: "active",
      turnCount: 0,
      lastTurnAt: null,
      // Distinct, increasing timestamps so ordering assertions are meaningful.
      startedAt: new Date(Date.UTC(2026, 7, 20, 10, 0, this.sequence)),
      endedAt: null,
    });

    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  async findById(userId: string, id: string): Promise<Conversation | null> {
    const conversation = this.conversations.get(id);
    // The ownership filter, exactly as the SQL does it: not yours, not found.
    return conversation && conversation.userId === userId ? conversation : null;
  }

  async findTurns(conversationId: string): Promise<Turn[]> {
    return [...(this.turns.get(conversationId) ?? [])].sort((a, b) => a.seq - b.seq);
  }

  async list(
    userId: string,
    options: ListConversationsOptions,
  ): Promise<ConversationPage> {
    const ordered = [...this.conversations.values()]
      // The search term is part of the predicate here too, not applied to a
      // page afterwards - a fake that paged first and filtered second would
      // hide the bug this ordering exists to prevent.
      .filter((c) => c.userId === userId && this.matches(c, options.query))
      .sort((a, b) => {
        const byTime = b.startedAt.getTime() - a.startedAt.getTime();
        return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
      });

    const after = options.after;
    const remaining = after
      ? ordered.filter(
          (c) =>
            c.startedAt.getTime() < after.startedAt.getTime() ||
            (c.startedAt.getTime() === after.startedAt.getTime() &&
              c.id.localeCompare(after.id) < 0),
        )
      : ordered;

    return {
      items: remaining.slice(0, options.limit),
      hasMore: remaining.length > options.limit,
    };
  }

  /**
   * Mirrors the SQL: case-insensitive substring over the title OR any turn's
   * text. Null matches everything, which is what an absent search box means.
   *
   * Shared by `list` and `search` for the same reason the SQL predicate is:
   * the box a person types into and the tool the model calls have to agree
   * about what "matches" means.
   *
   * Wildcards are LITERAL here, because the real implementation escapes them
   * before they reach the LIKE pattern. A fake that let "%" match everything
   * would quietly stop testing the thing that matters most about this method.
   */
  private matches(conversation: Conversation, query: string | null): boolean {
    if (!query) return true;

    const needle = query.toLowerCase();
    if (conversation.title?.toLowerCase().includes(needle)) return true;

    return (this.turns.get(conversation.id) ?? []).some((turn) =>
      turn.text.toLowerCase().includes(needle),
    );
  }

  /** Newest first, capped. Scoped by user, as every method here is. */
  async search(
    userId: string,
    options: SearchConversationsOptions,
  ): Promise<Conversation[]> {
    return [...this.conversations.values()]
      .filter(
        (conversation) =>
          conversation.userId === userId && this.matches(conversation, options.query),
      )
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, options.limit);
  }

  async end(userId: string, id: string, at: Date): Promise<Conversation | null> {
    const conversation = await this.findById(userId, id);
    if (!conversation) return null;

    const ended = conversation.end(at);
    this.conversations.set(id, ended);
    return ended;
  }

  async rename(
    userId: string,
    id: string,
    title: string,
  ): Promise<Conversation | null> {
    const conversation = await this.findById(userId, id);
    if (!conversation) return null;

    const renamed = conversation.rename(title);
    this.conversations.set(id, renamed);
    return renamed;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    // The ownership check first, as the SQL predicate does it - a stranger's
    // conversation must not be removable and must not report that it exists.
    const conversation = await this.findById(userId, id);
    if (!conversation) return false;

    this.conversations.delete(id);
    // Standing in for ON DELETE CASCADE. A fake that left the turns behind
    // would not be reproducing what the database actually does.
    this.turns.delete(id);
    return true;
  }

  async appendTurn(
    userId: string,
    conversationId: string,
    input: AppendTurnInput,
  ): Promise<AppendTurnResult | null> {
    const conversation = await this.findById(userId, conversationId);
    if (!conversation) return null;

    const stored = this.turns.get(conversationId) ?? [];
    const existing = stored.find((turn) => turn.seq === input.seq);

    // Same seq twice is a replay: nothing is written, no counter moves.
    if (existing) return { turn: existing, conversation, replayed: true };

    const turn = Turn.fromPersistence({
      id: this.nextId("t"),
      conversationId,
      seq: input.seq,
      role: input.role,
      text: input.text,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      createdAt: new Date(Date.UTC(2026, 7, 20, 11, 0, input.seq)),
    });

    this.turns.set(conversationId, [...stored, turn]);

    const updated = Conversation.fromPersistence({
      id: conversation.id,
      userId: conversation.userId,
      // coalesce, as the SQL does: only an untitled conversation takes a title.
      title: conversation.title ?? input.titleIfUnset,
      status: conversation.status,
      turnCount: conversation.turnCount + 1,
      lastTurnAt: input.endedAt ?? turn.createdAt,
      startedAt: conversation.startedAt,
      endedAt: conversation.endedAt,
    });

    this.conversations.set(conversationId, updated);
    return { turn, conversation: updated, replayed: false };
  }
}
