import { CONVERSATION_TITLE_MAX_LENGTH, type ConversationStatus } from "@convo/shared";
import { BaseEntity } from "./base.entity";

export interface ConversationProps {
  id: string;
  userId: string;
  title: string | null;
  status: ConversationStatus;
  turnCount: number;
  lastTurnAt: Date | null;
  startedAt: Date;
  endedAt: Date | null;
}

/**
 * One voice session, from the first tap of the orb to the second.
 *
 * The aggregate root: turns belong to a conversation and are only ever reached
 * through one. That is not bookkeeping - it is what forces every turn query to
 * pass through an ownership check, because there is no way to ask for a turn
 * without naming the conversation it is in.
 */
export class Conversation extends BaseEntity {
  readonly userId: string;
  readonly title: string | null;
  readonly status: ConversationStatus;
  readonly turnCount: number;
  readonly lastTurnAt: Date | null;
  readonly startedAt: Date;
  readonly endedAt: Date | null;

  private constructor(props: ConversationProps) {
    super(props.id);
    this.userId = props.userId;
    this.title = props.title;
    this.status = props.status;
    this.turnCount = props.turnCount;
    this.lastTurnAt = props.lastTurnAt;
    this.startedAt = props.startedAt;
    this.endedAt = props.endedAt;
  }

  /** Rehydrate from a stored row. The only way in - entities are not `new`ed. */
  static fromPersistence(props: ConversationProps): Conversation {
    return new Conversation(props);
  }

  get isEnded(): boolean {
    return this.status === "ended";
  }

  /**
   * Ending is IDEMPOTENT: a second PATCH returns the same conversation with
   * the original `endedAt`, rather than moving the timestamp or failing. A
   * phone that loses its response and retries must not see an error for work
   * that already succeeded.
   */
  end(at: Date): Conversation {
    if (this.isEnded) return this;

    return new Conversation({
      id: this.id,
      userId: this.userId,
      title: this.title,
      status: "ended",
      turnCount: this.turnCount,
      lastTurnAt: this.lastTurnAt,
      startedAt: this.startedAt,
      endedAt: at,
    });
  }

  /**
   * A conversation is titled by what the USER said first - never by the
   * assistant, whose opening line is usually a greeting and says nothing about
   * the conversation.
   *
   * Returns null when there is nothing usable, which leaves the title unset so
   * a later turn can still supply one.
   */
  static deriveTitle(text: string): string | null {
    const collapsed = text.replace(/\s+/g, " ").trim();
    if (collapsed.length === 0) return null;
    if (collapsed.length <= CONVERSATION_TITLE_MAX_LENGTH) return collapsed;

    // Cut at a word boundary so a title never ends mid-word. If the first word
    // is itself longer than the limit, a hard cut is the only option left.
    const clipped = collapsed.slice(0, CONVERSATION_TITLE_MAX_LENGTH);
    const lastSpace = clipped.lastIndexOf(" ");
    const body = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;

    return `${body.trimEnd()}...`;
  }
}
