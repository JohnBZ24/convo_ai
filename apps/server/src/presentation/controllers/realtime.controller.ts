import {
  errorEnvelope,
  mintRealtimeTokenBody,
  realtimeCredential,
} from "@convo/shared";
import { container } from "~/infrastructure/di/container";
import { currentUser } from "~/presentation/http/authenticated-user";
import { defineHandler } from "~/presentation/http/define-handler";
import { toRealtimeCredential } from "~/presentation/mappers/realtime.mapper";

/**
 * The HTTP adapter for credential minting.
 *
 * Same four lines as every other controller: take the user from the session,
 * call one use case, map, choose a status. The rate limit is NOT here - it is
 * `realtimeMintStack` on the route file, so the endpoint's security posture is
 * readable from the URL map rather than buried in a handler.
 */
export const mintRealtimeToken = defineHandler({
  operationId: "mintRealtimeToken",
  method: "post",
  path: "/api/realtime/token",
  summary: "Mint a realtime session credential",
  description:
    "Exchanges the server's OpenAI key for an ephemeral credential the device uses to open its OWN WebRTC connection to OpenAI. Conversation audio never passes through this API. The credential lives about a minute - long enough to establish the connection, which then outlives it - so mint immediately before connecting, not in advance. Rate limited to 20 per hour per user, because every mint is a billable session.",
  tags: ["realtime"],
  requiresAuth: true,
  body: mintRealtimeTokenBody,
  responses: {
    201: realtimeCredential,
    400: errorEnvelope,
    401: errorEnvelope,
    404: errorEnvelope,
    429: errorEnvelope,
    502: errorEnvelope,
  },
  handler: async ({ body, context }) => {
    const user = currentUser(context);

    const credential = await container.mintRealtimeCredential.execute(user.id, {
      conversationId: body.conversationId,
    });

    return {
      // 201: this created a session upstream and an audit row here. A retry is
      // a NEW credential, not the same one, so it is not idempotent and must
      // not look it.
      status: 201,
      body: toRealtimeCredential(
        credential,
        container.realtimeCredentialMinter.callsUrl,
        new Date(),
      ),
    };
  },
});
