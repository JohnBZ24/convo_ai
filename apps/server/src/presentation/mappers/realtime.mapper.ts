import type { RealtimeCredential } from "@convo/shared";
import type { MintedCredential } from "~/core/application/ports/realtime-credential-minter.port";

/**
 * Minted credential -> wire shape.
 *
 * As with the conversation mapper, the real work is turning `Date` into an ISO
 * string BEFORE `defineHandler` checks the response against its schema - so the
 * body that is validated is the body the device receives.
 *
 * `expiresInSeconds` is computed here rather than left to the client. The
 * device needs to know how long it has, and a phone's clock can be minutes off;
 * a duration is immune to that, an absolute timestamp is not. Both are sent -
 * the timestamp for logs, the duration to act on.
 */
export function toRealtimeCredential(
  credential: MintedCredential,
  callsUrl: string,
  now: Date,
): RealtimeCredential {
  const remainingMs = credential.expiresAt.getTime() - now.getTime();

  return {
    clientSecret: credential.value,
    expiresAt: credential.expiresAt.toISOString(),
    // Never zero or negative: the schema requires a positive integer, and a
    // credential that has already expired is a bug worth failing loudly on.
    expiresInSeconds: Math.max(1, Math.round(remainingMs / 1000)),
    model: credential.model,
    voice: credential.voice,
    sessionId: credential.sessionId,
    callsUrl,
  };
}
