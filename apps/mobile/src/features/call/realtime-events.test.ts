import { describe, expect, it } from "vitest";
import { toRealtimeEvent } from "./realtime-events";

/**
 * These fixtures are the GA event names, not the beta ones.
 *
 * The rename is the reason this translator exists: `response.audio_transcript.delta`
 * became `response.output_audio_transcript.delta`, and code written against the
 * old name receives absolutely nothing while looking completely healthy. If
 * these tests are ever "fixed" by renaming them back, the app goes silent.
 */

describe("translating data channel events", () => {
  it("reads the assistant transcript deltas", () => {
    expect(
      toRealtimeEvent({
        type: "response.output_audio_transcript.delta",
        item_id: "item_9",
        delta: "Good ",
      }),
    ).toEqual({ type: "output.transcript.delta", itemId: "item_9", delta: "Good " });
  });

  it("reads the user transcript, which is a different event entirely", () => {
    expect(
      toRealtimeEvent({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "item_8",
        transcript: "what is the time",
      }),
    ).toEqual({
      type: "input.transcript.done",
      itemId: "item_8",
      transcript: "what is the time",
    });
  });

  it("keeps the commit, which is what anchors a user line in order", () => {
    expect(
      toRealtimeEvent({ type: "input_audio_buffer.committed", item_id: "item_8" }),
    ).toEqual({ type: "input.committed", itemId: "item_8" });
  });

  it("pulls function calls out of response.done", () => {
    const event = toRealtimeEvent({
      type: "response.done",
      response: {
        output: [
          { type: "message", role: "assistant" },
          {
            type: "function_call",
            name: "get_current_time",
            call_id: "call_abc",
            arguments: '{"timeZone":"Europe/Beirut"}',
          },
        ],
      },
    });

    expect(event).toEqual({
      type: "response.done",
      calls: [
        {
          callId: "call_abc",
          name: "get_current_time",
          // Still a string. Parsing belongs with the schema that validates it.
          argumentsJson: '{"timeZone":"Europe/Beirut"}',
        },
      ],
    });
  });

  it("reports response.done with no calls as an empty list, not a failure", () => {
    expect(
      toRealtimeEvent({ type: "response.done", response: { output: [] } }),
    ).toEqual({ type: "response.done", calls: [] });
  });

  it("also reads the incremental function call event", () => {
    expect(
      toRealtimeEvent({
        type: "response.function_call_arguments.done",
        call_id: "call_xyz",
        name: "search_conversations",
        arguments: '{"query":"shibuya"}',
      }),
    ).toEqual({
      type: "function.call",
      call: {
        callId: "call_xyz",
        name: "search_conversations",
        argumentsJson: '{"query":"shibuya"}',
      },
    });
  });

  /**
   * The important one. OpenAI ships new event types without warning, and a
   * throw here would take down a live call over something we did not need.
   */
  it("does not throw on an event it has never seen", () => {
    expect(toRealtimeEvent({ type: "response.output_item.added" })).toEqual({
      type: "unhandled",
      wireType: "response.output_item.added",
    });
  });

  it("survives a frame that is not an event at all", () => {
    expect(toRealtimeEvent(null).type).toBe("unhandled");
    expect(toRealtimeEvent("ping").type).toBe("unhandled");
    expect(toRealtimeEvent({ item_id: "x" }).type).toBe("unhandled");
  });

  it("degrades a well-named event with missing fields to unhandled", () => {
    // Better an ignored frame than a transcript line keyed on `undefined`.
    expect(toRealtimeEvent({ type: "response.output_audio_transcript.delta" })).toEqual(
      { type: "unhandled", wireType: "response.output_audio_transcript.delta" },
    );
  });

  it("carries the error message through", () => {
    expect(
      toRealtimeEvent({
        type: "error",
        error: { type: "invalid_request_error", message: "session expired" },
      }),
    ).toEqual({ type: "error", message: "session expired" });
  });
});
