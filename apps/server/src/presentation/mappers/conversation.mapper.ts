import type { ConversationDetail, ConversationSummary, Turn } from "@convo/shared";
import type { Conversation } from "~/core/domain/entities/conversation.entity";
import type { Turn as TurnEntity } from "~/core/domain/entities/turn.entity";

/**
 * Domain entity -> wire shape.
 *
 * The only thing this really does is turn `Date` into an ISO string, and that
 * is the point. `JSON.stringify` would do it silently on the way out, which
 * means the response contract check in `defineHandler` would be inspecting
 * Dates against a schema that says "string" and failing on correct code. So the
 * conversion happens HERE, before the check, and the body a handler returns is
 * exactly the body the device receives.
 *
 * It is also the seam that stops persistence details leaking: `userId` is on
 * the entity and deliberately not on the wire - the caller is that user.
 */

export function toConversationSummary(conversation: Conversation): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    status: conversation.status,
    turnCount: conversation.turnCount,
    lastTurnAt: conversation.lastTurnAt?.toISOString() ?? null,
    startedAt: conversation.startedAt.toISOString(),
    endedAt: conversation.endedAt?.toISOString() ?? null,
  };
}

export function toTurn(turn: TurnEntity): Turn {
  return {
    id: turn.id,
    seq: turn.seq,
    role: turn.role,
    text: turn.text,
    startedAt: turn.startedAt?.toISOString() ?? null,
    endedAt: turn.endedAt?.toISOString() ?? null,
    createdAt: turn.createdAt.toISOString(),
  };
}

export function toConversationDetail(
  conversation: Conversation,
  turns: TurnEntity[],
): ConversationDetail {
  return { ...toConversationSummary(conversation), turns: turns.map(toTurn) };
}
