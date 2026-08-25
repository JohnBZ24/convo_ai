/**
 * The voices `audio.output.voice` accepts.
 *
 * Enumerated rather than typed as a bare string so that a typo in
 * `REALTIME_VOICE` fails when the server BOOTS, with a message naming the
 * valid options - not sixty seconds into a demo when OpenAI rejects the mint
 * and the orb spins forever.
 *
 * Verified against the live API on 25 Aug 2026. If OpenAI adds a voice, this
 * list is the one place to add it.
 */
export const REALTIME_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "cedar",
  "coral",
  "echo",
  "marin",
  "sage",
  "shimmer",
  "verse",
] as const;

export type RealtimeVoice = (typeof REALTIME_VOICES)[number];

export function isRealtimeVoice(value: string): value is RealtimeVoice {
  return (REALTIME_VOICES as readonly string[]).includes(value);
}
