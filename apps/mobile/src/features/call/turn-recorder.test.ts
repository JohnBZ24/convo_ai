import { describe, expect, it, vi } from "vitest";
import type { RealtimeEvent } from "./realtime-events";
import { emptyTranscript, reduceTranscript } from "./transcript-assembler";
import { completedTurn, type PendingTurn, TurnRecorder } from "./turn-recorder";

/**
 * Replay events through the assembler and collect the turns that would be
 * stored - exactly what `use-call-session` does per event, minus React.
 */
function record(...events: RealtimeEvent[]): PendingTurn[] {
  let state = emptyTranscript;
  const stored: PendingTurn[] = [];

  for (const event of events) {
    state = reduceTranscript(state, event);
    const turn = completedTurn(state, event);
    if (turn) stored.push(turn);
  }

  return stored;
}

describe("deciding what to store", () => {
  it("stores nothing until a line is finished", () => {
    expect(
      record(
        { type: "input.committed", itemId: "u1" },
        { type: "output.transcript.delta", itemId: "a1", delta: "Half past" },
      ),
    ).toEqual([]);
  });

  it("stores the authoritative transcript, not the accumulated deltas", () => {
    const stored = record(
      { type: "output.transcript.delta", itemId: "a1", delta: "Half pas" },
      { type: "output.transcript.done", itemId: "a1", transcript: "Half past three." },
    );

    expect(stored).toEqual([{ seq: 1, role: "assistant", text: "Half past three." }]);
  });

  /**
   * THE test this module exists for.
   *
   * Input transcription is asynchronous, so the model's reply is finished
   * BEFORE the user's own words arrive. A counter incremented on each `done`
   * would therefore number the reply 1 and the question 2, and the stored
   * conversation would read backwards. The seq is the slot's position, claimed
   * at `input_audio_buffer.committed`, so it does not care what finishes first.
   */
  it("numbers the question before the answer even though the answer finished first", () => {
    const stored = record(
      { type: "input.committed", itemId: "u1" },
      { type: "output.transcript.delta", itemId: "a1", delta: "Hello!" },
      { type: "output.transcript.done", itemId: "a1", transcript: "Hello there!" },
      { type: "input.transcript.done", itemId: "u1", transcript: "Hello." },
    );

    expect(stored).toEqual([
      { seq: 2, role: "assistant", text: "Hello there!" },
      { seq: 1, role: "user", text: "Hello." },
    ]);
  });

  it("gives the same line the same seq every time, which is what makes a retry safe", () => {
    const events: RealtimeEvent[] = [
      { type: "input.committed", itemId: "u1" },
      { type: "input.transcript.done", itemId: "u1", transcript: "Hello." },
    ];

    expect(record(...events)).toEqual(record(...events));
  });

  /**
   * The VAD commits a cough or a door and transcription returns nothing. The
   * server rejects an empty `text` with a 422, so posting it would burn three
   * retries to store a blank row that should not exist.
   */
  it.each(["", "   ", "\n"])("does not store a transcript of %j", (transcript) => {
    expect(
      record(
        { type: "input.committed", itemId: "u1" },
        { type: "input.transcript.done", itemId: "u1", transcript },
      ),
    ).toEqual([]);
  });

  it("trims, so a leading space does not become part of the stored line", () => {
    const stored = record({
      type: "output.transcript.done",
      itemId: "a1",
      transcript: "  Hello there!  ",
    });

    expect(stored[0]?.text).toBe("Hello there!");
  });

  it("ignores an event for a line it has never seen", () => {
    expect(
      completedTurn(emptyTranscript, {
        type: "input.transcript.done",
        itemId: "ghost",
        transcript: "Hello.",
      }),
    ).toBeNull();
  });
});

describe("posting turns", () => {
  const turn = (seq: number): PendingTurn => ({ seq, role: "user", text: `#${seq}` });

  it("posts what it is given", async () => {
    const post = vi.fn(async () => undefined);
    const recorder = new TurnRecorder({ post });

    await recorder.record(turn(1));

    expect(post).toHaveBeenCalledWith({ seq: 1, role: "user", text: "#1" });
  });

  /**
   * OpenAI can emit the same `done` twice. The server would answer the second
   * one `replayed: true` and be none the worse, but there is no reason to spend
   * a request on a phone's radio to find that out.
   */
  it("posts a seq once, however many times the event arrives", async () => {
    const post = vi.fn(async () => undefined);
    const recorder = new TurnRecorder({ post });

    await recorder.record(turn(1));
    await recorder.record(turn(1));

    expect(post).toHaveBeenCalledTimes(1);
  });

  it("posts in order rather than racing", async () => {
    const order: number[] = [];
    const recorder = new TurnRecorder({
      post: async (pending) => {
        // A slow first post: if these ran concurrently, 2 would land first.
        if (pending.seq === 1) await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(pending.seq);
      },
    });

    void recorder.record(turn(1));
    await recorder.record(turn(2));

    expect(order).toEqual([1, 2]);
  });

  it("retries a failed post", async () => {
    let attempts = 0;
    const post = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("Could not reach the server");
    });

    const recorder = new TurnRecorder({
      post,
      wait: async () => undefined,
      backoffMs: [1, 1, 1],
    });

    await recorder.record(turn(1));

    expect(post).toHaveBeenCalledTimes(3);
  });

  it("backs off between attempts rather than hammering", async () => {
    const waited: number[] = [];
    const recorder = new TurnRecorder({
      post: async () => {
        throw new Error("offline");
      },
      wait: async (ms) => {
        waited.push(ms);
      },
      backoffMs: [10, 20],
    });

    await recorder.record(turn(1));

    expect(waited).toEqual([10, 20]);
  });

  /**
   * A turn that will not store is a missing line in a history screen. An
   * unhandled rejection while the user is mid-sentence is a crash, so the
   * failure stops here.
   */
  it("gives up quietly, and says so in the log", async () => {
    const log = vi.fn();
    const recorder = new TurnRecorder({
      post: async () => {
        throw new Error("offline");
      },
      wait: async () => undefined,
      backoffMs: [1],
      log,
    });

    await expect(recorder.record(turn(1))).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      "gave up storing a turn",
      expect.objectContaining({ seq: 1, error: "offline" }),
    );
  });

  it("keeps going after one turn fails permanently", async () => {
    const posted: number[] = [];
    const recorder = new TurnRecorder({
      post: async (pending) => {
        if (pending.seq === 1) throw new Error("offline");
        posted.push(pending.seq);
      },
      wait: async () => undefined,
      backoffMs: [1],
    });

    void recorder.record(turn(1));
    await recorder.record(turn(2));

    expect(posted).toEqual([2]);
  });

  it("drains, so a hang-up can wait for what is still in flight", async () => {
    const posted: number[] = [];
    const recorder = new TurnRecorder({
      post: async (pending) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        posted.push(pending.seq);
      },
    });

    void recorder.record(turn(1));
    void recorder.record(turn(2));
    await recorder.drain();

    expect(posted).toEqual([1, 2]);
  });
});
