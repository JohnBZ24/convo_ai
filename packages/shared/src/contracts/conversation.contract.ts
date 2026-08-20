import { z } from "zod";
import { isoTimestamp, paginated } from "./common.contract";

/**
 * The wire shapes for conversations and turns.
 *
 * These are the SAME objects the handlers validate with, so the published
 * OpenAPI document describes what the server actually accepts rather than what
 * someone remembered to write down. Timestamps are ISO-8601 STRINGS here, not
 * Dates - the mapper in the presentation layer converts, so that a response is
 * checked against this schema in the same shape the device will parse.
 */

export const turnRole = z.enum(["user", "assistant"]);
export type TurnRole = z.infer<typeof turnRole>;

export const conversationStatus = z.enum(["active", "ended"]);
export type ConversationStatus = z.infer<typeof conversationStatus>;

/** An upper bound on a single utterance. Generous, but not unbounded. */
export const TURN_TEXT_MAX_LENGTH = 20_000;

/** How long a derived title may be before it is truncated. */
export const CONVERSATION_TITLE_MAX_LENGTH = 80;

export const turn = z
  .object({
    id: z.uuid(),
    seq: z.number().int().positive(),
    role: turnRole,
    text: z.string(),
    startedAt: isoTimestamp.nullable(),
    endedAt: isoTimestamp.nullable(),
    createdAt: isoTimestamp,
  })
  .meta({ id: "Turn", description: "One utterance within a conversation" });

export type Turn = z.infer<typeof turn>;

/**
 * What the sidebar renders. `turnCount` and `lastTurnAt` are denormalised on
 * the conversations table precisely so this can be listed without touching
 * `turns`.
 */
export const conversationSummary = z
  .object({
    id: z.uuid(),
    title: z.string().nullable(),
    status: conversationStatus,
    turnCount: z.number().int().nonnegative(),
    lastTurnAt: isoTimestamp.nullable(),
    startedAt: isoTimestamp,
    endedAt: isoTimestamp.nullable(),
  })
  .meta({ id: "ConversationSummary", description: "A conversation without its turns" });

export type ConversationSummary = z.infer<typeof conversationSummary>;

export const conversationDetail = conversationSummary
  .extend({ turns: z.array(turn) })
  .meta({ id: "ConversationDetail", description: "A conversation with every turn" });

export type ConversationDetail = z.infer<typeof conversationDetail>;

export const conversationList = paginated(conversationSummary).meta({
  id: "ConversationList",
  description: "Keyset-paginated conversations, newest first",
});

/** Path parameter for every per-conversation route. */
export const conversationIdParams = z.object({ id: z.uuid() });

/**
 * Ending is expressed as a status transition rather than a bare `POST /end`,
 * so the one PATCH has room for further transitions without a new endpoint.
 * "active" is deliberately absent: a finished conversation does not reopen.
 */
export const endConversationBody = z
  .object({ status: z.literal("ended") })
  .meta({ id: "EndConversationRequest", description: "End an active conversation" });

export type EndConversationBody = z.infer<typeof endConversationBody>;

/**
 * `seq` is assigned by the DEVICE, not the server.
 *
 * That is what makes a retry safe: the same turn carries the same seq, the
 * unique index on (conversation_id, seq) rejects the duplicate, and the server
 * answers 200 "replayed" instead of storing it twice. A server-assigned
 * sequence could not tell a retry from a new turn.
 */
export const appendTurnBody = z
  .object({
    seq: z.number().int().positive(),
    role: turnRole,
    text: z.string().min(1).max(TURN_TEXT_MAX_LENGTH),
    startedAt: isoTimestamp.optional(),
    endedAt: isoTimestamp.optional(),
  })
  .meta({ id: "AppendTurnRequest", description: "Record one completed utterance" });

export type AppendTurnBody = z.infer<typeof appendTurnBody>;

/**
 * The updated conversation travels back with the turn so the device can
 * reconcile `turnCount` and the derived title without a second request - and
 * so a replayed turn visibly does NOT bump the count.
 */
export const appendTurnResponse = z
  .object({
    turn,
    conversation: conversationSummary,
    /** True when this seq was already stored: the request changed nothing. */
    replayed: z.boolean(),
  })
  .meta({ id: "AppendTurnResponse", description: "Result of recording a turn" });

export type AppendTurnResponse = z.infer<typeof appendTurnResponse>;
