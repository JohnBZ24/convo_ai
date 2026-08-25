import { z } from "zod";
import { isoTimestamp } from "./common.contract";

/**
 * The contract for minting an ephemeral OpenAI credential.
 *
 * This is the endpoint that spends money, and the one place where the server's
 * permanent `OPENAI_API_KEY` is traded for something safe to hand a phone. What
 * comes back is short-lived by design: the device uses it within a second or
 * two to open its WebRTC connection, and it is dead about a minute later. The
 * WebRTC session outlives it.
 */

/**
 * Optional, because the device may mint before it has created a conversation.
 * When present the server VERIFIES the conversation is the caller's - a
 * credential is never minted against someone else's session.
 */
export const mintRealtimeTokenBody = z
  .object({
    conversationId: z
      .uuid()
      .optional()
      .describe("The conversation this session belongs to, for the audit trail."),
  })
  .meta({
    id: "MintRealtimeTokenRequest",
    description: "Request an ephemeral credential for a realtime voice session",
  });

export type MintRealtimeTokenBody = z.infer<typeof mintRealtimeTokenBody>;

export const realtimeCredential = z
  .object({
    /**
     * The `ek_...` value. Sent to OpenAI as a bearer token by the DEVICE, and
     * never stored anywhere - not in the database, not in a log.
     */
    clientSecret: z.string(),
    expiresAt: isoTimestamp,
    /** Seconds remaining at the moment of the response. Saves clock-skew maths. */
    expiresInSeconds: z.number().int().positive(),
    model: z.string(),
    voice: z.string(),
    /** OpenAI's `sess_...`. Correlates a device-side bug with the audit row. */
    sessionId: z.string(),
    /**
     * Where the device POSTs its SDP offer.
     *
     * Sent by the server rather than compiled into the app so that the OpenAI
     * base URL is configuration in ONE place. A build already on a phone
     * follows the server if that ever changes.
     */
    callsUrl: z.url(),
  })
  .meta({
    id: "RealtimeCredential",
    description: "A short-lived credential the device uses to reach OpenAI directly",
  });

export type RealtimeCredential = z.infer<typeof realtimeCredential>;
