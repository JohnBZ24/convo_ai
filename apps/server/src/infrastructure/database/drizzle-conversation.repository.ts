import { type Database, schema } from "@convo/db";
import { and, desc, eq, exists, ilike, or, sql } from "drizzle-orm";
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

const { conversations, turns } = schema;

type ConversationRow = typeof conversations.$inferSelect;
type TurnRow = typeof turns.$inferSelect;

function toConversation(row: ConversationRow): Conversation {
  return Conversation.fromPersistence({
    id: row.id,
    userId: row.userId,
    title: row.title,
    status: row.status,
    turnCount: row.turnCount,
    lastTurnAt: row.lastTurnAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  });
}

/**
 * Neutralise LIKE metacharacters in text supplied by the MODEL.
 *
 * Without this, a query of "%" matches every conversation the user has and a
 * search becomes a full history dump - the exact outcome a prompt injection
 * would be aiming for. Not an injection risk in the SQL sense (the pattern is
 * still a bound parameter), but a wildcard is a wildcard.
 *
 * The backslash goes first, or it would re-escape the escapes added after it.
 */
function escapeLikePattern(query: string): string {
  return query.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&");
}

/**
 * "This conversation mentions `query`" - the predicate BOTH the sidebar's
 * search box and the model's `search_conversations` tool are built on.
 *
 * Extracted rather than written twice, because the two would drift: the one a
 * person uses would gain a fix that the one a model uses did not, and the
 * difference would only show up as "the assistant cannot find a conversation I
 * can see".
 *
 * EXISTS rather than a JOIN + DISTINCT: a conversation with forty matching
 * turns should appear once, and EXISTS stops at the first hit instead of
 * building every matching pair only to collapse them again.
 *
 * KNOWN LIMITATION: `ilike` cannot use a b-tree index, so this scans the
 * user's turns. Correct at this size and honest about it - the fix when it
 * matters is a tsvector column with a GIN index, which is a migration and a
 * change to this one function. See docs/HANDOFF.md.
 */
function matchesQuery(database: Database, query: string) {
  const pattern = `%${escapeLikePattern(query)}%`;

  const mentionedInATurn = exists(
    database
      .select({ matched: sql`1` })
      .from(turns)
      .where(
        and(eq(turns.conversationId, conversations.id), ilike(turns.text, pattern)),
      ),
  );

  return or(ilike(conversations.title, pattern), mentionedInATurn);
}

function toTurn(row: TurnRow): Turn {
  return Turn.fromPersistence({
    id: row.id,
    conversationId: row.conversationId,
    seq: row.seq,
    role: row.role,
    text: row.text,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    createdAt: row.createdAt,
  });
}

/**
 * Drizzle implementation of the conversation aggregate's persistence.
 *
 * Two things in here are load-bearing and should not be "simplified":
 *
 *   1. EVERY query names `userId` in its WHERE clause. Not as a check after
 *      the fact - as part of the predicate, so another user's row is never in
 *      the result set to begin with and the 404 is literally true.
 *   2. `appendTurn` runs in ONE transaction. The insert, the counter bump and
 *      the title are a single atomic step; splitting them would let a crash
 *      between statements leave `turn_count` disagreeing with the rows.
 */
export class DrizzleConversationRepository implements ConversationRepository {
  constructor(private readonly database: Database) {}

  async create(userId: string): Promise<Conversation> {
    const [row] = await this.database
      .insert(conversations)
      .values({ userId })
      .returning();

    // The insert either returns its row or throws; there is no third case.
    if (!row) throw new Error("insert returned no row");

    return toConversation(row);
  }

  async findById(userId: string, id: string): Promise<Conversation | null> {
    const [row] = await this.database
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      .limit(1);

    return row ? toConversation(row) : null;
  }

  async findTurns(conversationId: string): Promise<Turn[]> {
    const rows = await this.database
      .select()
      .from(turns)
      .where(eq(turns.conversationId, conversationId))
      .orderBy(turns.seq);

    return rows.map(toTurn);
  }

  async list(
    userId: string,
    options: ListConversationsOptions,
  ): Promise<ConversationPage> {
    const { limit, after } = options;

    /**
     * A ROW comparison, not two ANDed comparisons. `(started_at, id) < (a, b)`
     * is what the `(user_id, started_at DESC, id DESC)` index can satisfy as a
     * single range scan; the hand-expanded equivalent
     * `started_at < a OR (started_at = a AND id < b)` usually cannot.
     *
     * Both parameters are bound as STRINGS with an explicit cast. Inside a raw
     * fragment there is no column to infer an encoder from, and postgres.js
     * refuses a bare `Date` there with "The 'string' argument must be of type
     * string ... Received an instance of Date". The cast is what turns the text
     * back into a timestamptz, so it is load-bearing, not decoration.
     */
    const keyset = after
      ? sql`(${conversations.startedAt}, ${conversations.id}) < (${after.startedAt.toISOString()}::timestamptz, ${after.id}::uuid)`
      : undefined;

    /**
     * The search term joins the SAME where clause as the keyset. Filtering a
     * fetched page in JS instead would break pagination outright: 30 rows might
     * hold two matches, and "load more" would page through history the user
     * cannot see.
     */
    const matching = options.query
      ? matchesQuery(this.database, options.query)
      : undefined;

    // One row more than asked for: its existence is the entire "is there a
    // next page?" answer, and it costs nothing extra on an index scan.
    const rows = await this.database
      .select()
      .from(conversations)
      .where(and(eq(conversations.userId, userId), keyset, matching))
      .orderBy(desc(conversations.startedAt), desc(conversations.id))
      .limit(limit + 1);

    return {
      items: rows.slice(0, limit).map(toConversation),
      hasMore: rows.length > limit,
    };
  }

  async search(
    userId: string,
    options: SearchConversationsOptions,
  ): Promise<Conversation[]> {
    const rows = await this.database
      .select()
      .from(conversations)
      .where(
        and(
          // Ownership in the predicate, as everywhere else in this class.
          eq(conversations.userId, userId),
          matchesQuery(this.database, options.query),
        ),
      )
      .orderBy(desc(conversations.startedAt), desc(conversations.id))
      .limit(options.limit);

    return rows.map(toConversation);
  }

  async end(userId: string, id: string, at: Date): Promise<Conversation | null> {
    const [row] = await this.database
      .update(conversations)
      .set({ status: "ended", endedAt: at })
      .where(
        and(
          eq(conversations.id, id),
          eq(conversations.userId, userId),
          // Only an ACTIVE conversation is touched, so a second call cannot
          // move `endedAt`. The already-ended row is fetched below instead.
          eq(conversations.status, "active"),
        ),
      )
      .returning();

    if (row) return toConversation(row);

    // Either it was already ended - answer with the original timestamp - or it
    // is not this user's, in which case this returns null too.
    return this.findById(userId, id);
  }

  async rename(
    userId: string,
    id: string,
    title: string,
  ): Promise<Conversation | null> {
    const [row] = await this.database
      .update(conversations)
      .set({ title })
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      .returning();

    // No row means no such conversation OF THIS USER - the ownership term is
    // in the UPDATE's own predicate, so a stranger's row is never touched and
    // never read back to tell them it exists.
    return row ? toConversation(row) : null;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    /**
     * `returning({ id })` rather than counting affected rows: postgres.js
     * reports a count, but reading it back through Drizzle's result shape
     * differs by driver, while a returned row is the same everywhere.
     *
     * The turns go with this by ON DELETE CASCADE, declared on the turns table.
     * Deleting them here in a transaction would be the same work said twice,
     * and the version the database enforces is the one that cannot be skipped.
     */
    const rows = await this.database
      .delete(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      .returning({ id: conversations.id });

    return rows.length > 0;
  }

  async appendTurn(
    userId: string,
    conversationId: string,
    input: AppendTurnInput,
  ): Promise<AppendTurnResult | null> {
    return this.database.transaction(async (tx) => {
      // Ownership first, inside the transaction: a turn is never written
      // anywhere until this row has proved the conversation belongs to the
      // caller.
      const [owned] = await tx
        .select()
        .from(conversations)
        .where(
          and(eq(conversations.id, conversationId), eq(conversations.userId, userId)),
        )
        .limit(1);

      if (!owned) return null;

      /**
       * THE idempotency guarantee. The unique index on
       * `(conversation_id, seq)` rejects a retried turn, and DO NOTHING turns
       * that rejection into an empty `returning()` rather than an error - so a
       * replay is detected by the absence of a row, not by parsing a message.
       */
      const [inserted] = await tx
        .insert(turns)
        .values({
          conversationId,
          seq: input.seq,
          role: input.role,
          text: input.text,
          startedAt: input.startedAt,
          endedAt: input.endedAt,
        })
        .onConflictDoNothing({ target: [turns.conversationId, turns.seq] })
        .returning();

      if (!inserted) {
        const [stored] = await tx
          .select()
          .from(turns)
          .where(
            and(eq(turns.conversationId, conversationId), eq(turns.seq, input.seq)),
          )
          .limit(1);

        if (!stored) throw new Error("turn conflicted but could not be read back");

        // Counters are NOT touched: nothing was written, so nothing changed.
        return {
          turn: toTurn(stored),
          conversation: toConversation(owned),
          replayed: true,
        };
      }

      const [updated] = await tx
        .update(conversations)
        .set({
          turnCount: sql`${conversations.turnCount} + 1`,
          lastTurnAt: input.endedAt ?? inserted.createdAt,
          /**
           * `coalesce` rather than an if: it applies the title only when the
           * column is still null, decided by the database at write time. Two
           * turns racing to name the same conversation therefore cannot
           * overwrite each other - the first one to land wins.
           */
          ...(input.titleIfUnset
            ? { title: sql`coalesce(${conversations.title}, ${input.titleIfUnset})` }
            : {}),
        })
        .where(eq(conversations.id, conversationId))
        .returning();

      if (!updated) throw new Error("conversation vanished mid-transaction");

      return {
        turn: toTurn(inserted),
        conversation: toConversation(updated),
        replayed: false,
      };
    });
  }
}
