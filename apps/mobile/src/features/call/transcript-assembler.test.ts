import { describe, expect, it } from "vitest";
import type { RealtimeEvent } from "./realtime-events";
import {
  emptyTranscript,
  reduceTranscript,
  visibleLines,
} from "./transcript-assembler";

function replay(...events: RealtimeEvent[]) {
  return events.reduce(reduceTranscript, emptyTranscript);
}

describe("assembling the transcript", () => {
  it("accumulates deltas into one line", () => {
    const state = replay(
      { type: "output.transcript.delta", itemId: "a", delta: "Half " },
      { type: "output.transcript.delta", itemId: "a", delta: "past " },
      { type: "output.transcript.delta", itemId: "a", delta: "three." },
    );

    expect(visibleLines(state)).toEqual([
      { id: "a", role: "assistant", text: "Half past three." },
    ]);
  });

  /**
   * The final transcript REPLACES the deltas. Appending it would print the
   * whole sentence twice, which is what a first attempt at this does.
   */
  it("replaces the accumulated text when the final transcript lands", () => {
    const state = replay(
      { type: "output.transcript.delta", itemId: "a", delta: "Half past" },
      { type: "output.transcript.done", itemId: "a", transcript: "Half past three." },
    );

    expect(visibleLines(state)).toEqual([
      { id: "a", role: "assistant", text: "Half past three." },
    ]);
  });

  /**
   * THE ordering test, and the reason `input_audio_buffer.committed` is handled
   * at all.
   *
   * Input transcription is asynchronous: the model starts answering the moment
   * the user's audio is committed, so the assistant's first delta routinely
   * beats the user's own words onto the wire. Keying off the first delta would
   * print the reply above the question.
   */
  it("keeps the user's line above a reply that was transcribed first", () => {
    const state = replay(
      { type: "input.committed", itemId: "user_1" },
      { type: "output.transcript.delta", itemId: "asst_1", delta: "It is three." },
      {
        type: "input.transcript.done",
        itemId: "user_1",
        transcript: "what is the time",
      },
    );

    expect(visibleLines(state)).toEqual([
      { id: "user_1", role: "user", text: "what is the time" },
      { id: "asst_1", role: "assistant", text: "It is three." },
    ]);
  });

  it("hides a slot that has claimed its place but has no words yet", () => {
    const state = replay(
      { type: "input.committed", itemId: "user_1" },
      { type: "output.transcript.delta", itemId: "asst_1", delta: "One moment." },
    );

    // The slot is still held - it is just not drawn as a blank gap.
    expect(state.entries).toHaveLength(2);
    expect(visibleLines(state)).toEqual([
      { id: "asst_1", role: "assistant", text: "One moment." },
    ]);
  });

  it("does not cross-contaminate two interleaved items", () => {
    const state = replay(
      { type: "input.committed", itemId: "u" },
      { type: "input.transcript.delta", itemId: "u", delta: "hello" },
      { type: "output.transcript.delta", itemId: "a", delta: "Hi " },
      { type: "input.transcript.delta", itemId: "u", delta: " there" },
      { type: "output.transcript.delta", itemId: "a", delta: "back." },
    );

    expect(visibleLines(state)).toEqual([
      { id: "u", role: "user", text: "hello there" },
      { id: "a", role: "assistant", text: "Hi back." },
    ]);
  });

  it("treats a second commit for the same item as a no-op", () => {
    const once = replay({ type: "input.committed", itemId: "u" });
    const twice = reduceTranscript(once, { type: "input.committed", itemId: "u" });

    // Same reference: nothing changed, so nothing downstream re-renders.
    expect(twice).toBe(once);
  });

  it("ignores events that say nothing about the transcript", () => {
    const state = replay({ type: "output.transcript.delta", itemId: "a", delta: "Hi" });
    const after = reduceTranscript(state, { type: "speech.started" });

    expect(after).toBe(state);
  });

  /**
   * `visibleLines` returns the SAME array when there is nothing to filter,
   * which is the common case. A fresh array on every delta would re-render the
   * list on every token.
   */
  it("returns the same array when there is nothing to hide", () => {
    const state = replay({ type: "output.transcript.delta", itemId: "a", delta: "Hi" });

    expect(visibleLines(state)).toBe(state.entries);
  });
});
