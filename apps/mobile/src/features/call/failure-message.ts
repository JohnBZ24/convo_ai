import { ApiRequestError } from "~/lib/api/client";

/**
 * Turning a failure into the one sentence the orb can show.
 *
 * This is iteration 7's "real error surfaces". Before it, every failure became
 * `error.message`, which is written for a developer: "Request failed with
 * status code 429" tells a user nothing they can act on, and "Could not reach
 * the server" was the same sentence whether the laptop was asleep, the Wi-Fi
 * was off, or the session had expired.
 *
 * Two rules:
 *
 *   1. Say what the USER can do. "Sign in again" is useful; "401 Unauthorized"
 *      is not.
 *   2. Never surface an upstream message verbatim. OpenAI's errors name
 *      accounts and models, and the server already refuses to forward them -
 *      undoing that here would be an odd place to leak them.
 *
 * Pure, and it imports nothing from `react-native`, so the mapping is tested
 * rather than eyeballed on a phone.
 */

/** Short enough to read at a glance under the orb, which is where it lands. */
const MESSAGES: Record<string, string> = {
  /** The fetch never completed: aeroplane mode, wrong LAN address, laptop asleep. */
  NETWORK: "No connection. Check Wi-Fi and try again",
  TIMEOUT: "The server is not responding",
  UNAUTHORIZED: "Your session expired. Sign in again",
  FORBIDDEN: "This account cannot start a call",
  RATE_LIMITED: "Too many calls just now. Wait a minute",
  UPSTREAM_ERROR: "The voice service is unavailable",
  SERVICE_UNAVAILABLE: "The server is starting up. Try again",
  INTERNAL_ERROR: "Something went wrong on our side",
  /** From `postRealtimeOffer`, which talks to OpenAI directly. */
  REALTIME_SDP_REJECTED: "The voice service refused the connection",
  REALTIME_SDP_MALFORMED: "The voice service sent an unusable answer",
  UNREADABLE: "The server sent something unreadable",
};

/** When nothing more specific is known. Deliberately not "Error: undefined". */
export const GENERIC_CALL_FAILURE = "Could not start the conversation";

/** The microphone case, which is a permission problem and not an error at all. */
export const MICROPHONE_DENIED = "Convo needs the microphone to hear you";

export function describeFailure(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const known = MESSAGES[error.code];
    if (known) return known;

    /**
     * A 5xx we have no copy for is still OURS to apologise for, and a 4xx we
     * have no copy for is still the caller's to fix. Splitting on the status
     * beats falling through to a generic sentence for both.
     */
    if (error.status >= 500) return MESSAGES.INTERNAL_ERROR ?? GENERIC_CALL_FAILURE;
    if (error.status >= 400) return GENERIC_CALL_FAILURE;

    return GENERIC_CALL_FAILURE;
  }

  /**
   * Anything else: keep the message only if it looks like something a person
   * wrote. Our own `throw new Error("Not signed in")` is worth showing; a
   * stack-shaped string or a JSON blob from a library is not.
   */
  if (error instanceof Error && isReadable(error.message)) return error.message;

  return GENERIC_CALL_FAILURE;
}

/**
 * A crude but effective filter. Library errors are long, contain punctuation
 * a sentence would not, or name internals; ours are short imperative English.
 */
function isReadable(message: string): boolean {
  const trimmed = message.trim();

  if (trimmed.length === 0 || trimmed.length > 80) return false;
  if (trimmed.includes("\n")) return false;
  // Paths, URLs, JSON and stack frames - never in a sentence meant for a user.
  if (/[{}<>]|https?:\/\/|\bat \w+\.|[\\/]\w+[\\/]/.test(trimmed)) return false;

  return true;
}

/**
 * Whether losing the connection is worth trying to recover from silently.
 *
 * A dropped WebRTC connection usually means the network moved - a phone
 * changing Wi-Fi cell, a laptop that slept for a second - and reconnecting is
 * far better than making the user tap twice. But a rejected credential or a
 * signed-out session will fail identically every time, so retrying those just
 * spends time and money before showing the same message.
 */
export function isWorthRetrying(error: unknown): boolean {
  if (error instanceof ApiRequestError) {
    if (error.code === "NETWORK" || error.code === "TIMEOUT") return true;
    // 401/403 will not fix itself; 429 needs longer than a retry loop allows.
    if (error.status === 401 || error.status === 403 || error.status === 429) {
      return false;
    }
    return error.status === 0 || error.status >= 500;
  }

  return false;
}
