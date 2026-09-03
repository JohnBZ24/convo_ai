import type { RealtimeCredential } from "@convo/shared";
import { ApiRequestError, apiRequest } from "./client";

/**
 * The two halves of reaching OpenAI.
 *
 * The mint goes to OUR server, which holds the `OPENAI_API_KEY` and exchanges
 * it for a credential that lives about a minute. The SDP offer goes STRAIGHT to
 * OpenAI with that credential - the conversation never touches our server,
 * which is the whole architecture in two functions.
 */

export function mintRealtimeCredential(
  token: string,
  conversationId: string,
): Promise<RealtimeCredential> {
  return apiRequest<RealtimeCredential>("/api/realtime/token", {
    method: "POST",
    body: { conversationId },
    token,
    /**
     * Longer than the default, because this one waits on OpenAI through our
     * server, which gives itself `OPENAI_REQUEST_TIMEOUT_MS` (10s) before it
     * reports an upstream failure. Giving up at 10s here would abandon the
     * request just as the server was about to explain what went wrong.
     */
    timeoutMs: 20_000,
  });
}

/**
 * The SDP exchange. Not `apiRequest`: this is the one call in the app that does
 * not go to our API, does not carry the user's token, and trades `application/sdp`
 * rather than JSON in either direction.
 *
 * `callsUrl` comes from the mint rather than being compiled in, so pointing the
 * server at a proxy or a regional host moves both halves together and a build
 * already on a phone follows.
 */
export async function postRealtimeOffer(
  callsUrl: string,
  clientSecret: string,
  sdp: string,
): Promise<string> {
  const response = await fetch(callsUrl, {
    method: "POST",
    headers: {
      // The ephemeral `ek_...`, never the user's session token and never the
      // server's API key.
      authorization: `Bearer ${clientSecret}`,
      "content-type": "application/sdp",
    },
    body: sdp,
  });

  const body = await response.text();

  if (!response.ok) {
    throw new ApiRequestError(
      // Kept short: this reaches the user as the orb status line.
      "The voice service refused the connection",
      response.status,
      "REALTIME_SDP_REJECTED",
    );
  }

  if (!body.startsWith("v=")) {
    throw new ApiRequestError(
      "The voice service sent an unusable answer",
      response.status,
      "REALTIME_SDP_MALFORMED",
    );
  }

  return body;
}
