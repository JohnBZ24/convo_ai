import type { TurnRole } from "@convo/shared";
import { BaseEntity } from "./base.entity";

export interface TurnProps {
  id: string;
  conversationId: string;
  seq: number;
  role: TurnRole;
  text: string;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
}

/**
 * One utterance, either the user's or the model's.
 *
 * `seq` comes from the DEVICE. The server never assigns it, because a
 * server-assigned number could not distinguish a retried turn from a new one -
 * and mobile networks retry. `(conversationId, seq)` is unique, so the retry
 * collides and is answered as a replay.
 */
export class Turn extends BaseEntity {
  readonly conversationId: string;
  readonly seq: number;
  readonly role: TurnRole;
  readonly text: string;
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
  readonly createdAt: Date;

  private constructor(props: TurnProps) {
    super(props.id);
    this.conversationId = props.conversationId;
    this.seq = props.seq;
    this.role = props.role;
    this.text = props.text;
    this.startedAt = props.startedAt;
    this.endedAt = props.endedAt;
    this.createdAt = props.createdAt;
  }

  static fromPersistence(props: TurnProps): Turn {
    return new Turn(props);
  }

  /** Only a user turn may name the conversation. See Conversation.deriveTitle. */
  get canTitleConversation(): boolean {
    return this.role === "user";
  }
}
