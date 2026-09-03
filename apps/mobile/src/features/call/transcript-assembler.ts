import type { RealtimeEvent } from "./realtime-events";

/**
 * One spoken line. The `id` is OpenAI's `item_id`, so a delta always finds the
 * line it belongs to without the app inventing a key.
 */
export interface TranscriptLine {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface TranscriptState {
  /**
   * Every line IN THE ORDER ITS SLOT WAS CLAIMED, including one that is still
   * waiting for its transcription to arrive.
   */
  readonly entries: readonly TranscriptLine[];
}

export const emptyTranscript: TranscriptState = { entries: [] };

/**
 * Assemble the transcript from data-channel events. Pure: same events in, same
 * lines out, and no React or timers anywhere near it.
 *
 * The ordering problem this solves, which is not obvious until you see it on a
 * device: input transcription is ASYNCHRONOUS. The model starts answering the
 * moment the user's audio is committed, so `response.output_audio_transcript.delta`
 * routinely arrives BEFORE the user's own words have been transcribed. Keying
 * off the first delta would therefore print the reply above the question.
 *
 * `input_audio_buffer.committed` fires at commit time, before any of that, so
 * the user's line claims its slot then and fills in later.
 */
export function reduceTranscript(
  state: TranscriptState,
  event: RealtimeEvent,
): TranscriptState {
  switch (event.type) {
    case "input.committed":
      return anchor(state, event.itemId, "user");

    case "input.transcript.delta":
      return write(state, event.itemId, "user", (text) => text + event.delta);

    /** The authoritative text REPLACES the accumulated deltas, never appends. */
    case "input.transcript.done":
      return write(state, event.itemId, "user", () => event.transcript);

    case "output.transcript.delta":
      return write(state, event.itemId, "assistant", (text) => text + event.delta);

    case "output.transcript.done":
      return write(state, event.itemId, "assistant", () => event.transcript);

    default:
      return state;
  }
}

/** Claim a slot without writing text. A no-op if the line already exists. */
function anchor(
  state: TranscriptState,
  id: string,
  role: TranscriptLine["role"],
): TranscriptState {
  if (state.entries.some((entry) => entry.id === id)) return state;
  return { entries: [...state.entries, { id, role, text: "" }] };
}

function write(
  state: TranscriptState,
  id: string,
  role: TranscriptLine["role"],
  next: (current: string) => string,
): TranscriptState {
  const index = state.entries.findIndex((entry) => entry.id === id);

  if (index === -1) {
    return { entries: [...state.entries, { id, role, text: next("") }] };
  }

  const existing = state.entries[index];
  if (!existing) return state;

  const text = next(existing.text);
  if (text === existing.text) return state;

  const entries = [...state.entries];
  entries[index] = { ...existing, text };
  return { entries };
}

/**
 * The lines worth rendering. A slot that has claimed its place but has no words
 * yet is not one - it would draw as a blank gap the moment anyone spoke.
 *
 * Returns the SAME array when nothing is empty, which is the common case, so a
 * memoised list does not re-render on every delta.
 */
export function visibleLines(state: TranscriptState): readonly TranscriptLine[] {
  const hasEmpty = state.entries.some((entry) => entry.text.length === 0);
  if (!hasEmpty) return state.entries;
  return state.entries.filter((entry) => entry.text.length > 0);
}
