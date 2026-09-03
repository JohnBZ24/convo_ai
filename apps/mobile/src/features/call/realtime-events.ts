/**
 * The data channel's wire protocol, narrowed to the events this app acts on.
 *
 * These names are TRANSLATED, not passed through. OpenAI renamed most of them
 * between the beta and the GA interface - `response.audio_transcript.delta`
 * became `response.output_audio_transcript.delta`, `/realtime/sessions` became
 * `/realtime/client_secrets` - and anything written against the old names
 * silently receives nothing. Translating here means the next rename is a change
 * to ONE file instead of a hunt through the call screen.
 *
 * Everything unrecognised becomes `unhandled` rather than throwing. OpenAI adds
 * events without warning, and an exception on the data channel would take down
 * a live call over an event we did not need.
 */

/** One function call the model wants run. `arguments` stays a JSON string. */
export interface RealtimeFunctionCall {
  callId: string;
  name: string;
  /**
   * The model's raw JSON, unparsed on purpose: parsing belongs with the Zod
   * schema that validates it, and a malformed string must become a tool error
   * the model can read rather than a crash here.
   */
  argumentsJson: string;
}

export type RealtimeEvent =
  /** The session is up. Correlates a device-side bug with the server audit row. */
  | { readonly type: "session.created"; readonly sessionId: string }
  /** Server VAD heard the user start. Also the barge-in signal. */
  | { readonly type: "speech.started" }
  | { readonly type: "speech.stopped" }
  /**
   * The user's audio became a conversation item. This is where a user line
   * CLAIMS ITS PLACE in the transcript - see transcript-assembler.
   */
  | { readonly type: "input.committed"; readonly itemId: string }
  | {
      readonly type: "input.transcript.delta";
      readonly itemId: string;
      readonly delta: string;
    }
  | {
      readonly type: "input.transcript.done";
      readonly itemId: string;
      readonly transcript: string;
    }
  | { readonly type: "response.created" }
  | {
      readonly type: "output.transcript.delta";
      readonly itemId: string;
      readonly delta: string;
    }
  | {
      readonly type: "output.transcript.done";
      readonly itemId: string;
      readonly transcript: string;
    }
  /** Carries any function calls the model produced. */
  | {
      readonly type: "response.done";
      readonly calls: readonly RealtimeFunctionCall[];
    }
  /** The incremental route to the same call. De-duplicated by `callId`. */
  | { readonly type: "function.call"; readonly call: RealtimeFunctionCall }
  | { readonly type: "error"; readonly message: string }
  /** `wireType` is kept so a log names the event we ignored. */
  | { readonly type: "unhandled"; readonly wireType: string };

/** Narrow an `unknown` to a string, or undefined. Absent and wrong-typed are the same. */
function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toFunctionCall(item: unknown): RealtimeFunctionCall | null {
  if (typeof item !== "object" || item === null) return null;

  const record = item as Record<string, unknown>;
  if (record.type !== "function_call") return null;

  const callId = str(record.call_id);
  const name = str(record.name);
  if (!callId || !name) return null;

  return { callId, name, argumentsJson: str(record.arguments) ?? "{}" };
}

/**
 * `response.done` is the documented place a completed function call arrives:
 * `response.output[]` holds one entry per call, with `arguments` already whole.
 */
function callsFromResponse(response: unknown): readonly RealtimeFunctionCall[] {
  if (typeof response !== "object" || response === null) return [];

  const output = (response as Record<string, unknown>).output;
  if (!Array.isArray(output)) return [];

  const calls: RealtimeFunctionCall[] = [];
  for (const item of output) {
    const call = toFunctionCall(item);
    if (call) calls.push(call);
  }
  return calls;
}

/**
 * One raw data-channel message in, one domain event out.
 *
 * Takes the already-parsed object rather than the string: the caller has to
 * handle a malformed JSON frame anyway, and doing it here would hide it.
 */
export function toRealtimeEvent(raw: unknown): RealtimeEvent {
  if (typeof raw !== "object" || raw === null) {
    return { type: "unhandled", wireType: "<not an object>" };
  }

  const event = raw as Record<string, unknown>;
  const wireType = str(event.type) ?? "<untyped>";

  switch (wireType) {
    case "session.created":
    case "session.updated": {
      const session = event.session as Record<string, unknown> | undefined;
      return { type: "session.created", sessionId: str(session?.id) ?? "" };
    }

    case "input_audio_buffer.speech_started":
      return { type: "speech.started" };

    case "input_audio_buffer.speech_stopped":
      return { type: "speech.stopped" };

    case "input_audio_buffer.committed": {
      const itemId = str(event.item_id);
      return itemId
        ? { type: "input.committed", itemId }
        : { type: "unhandled", wireType };
    }

    case "conversation.item.input_audio_transcription.delta": {
      const itemId = str(event.item_id);
      const delta = str(event.delta);
      return itemId && delta !== undefined
        ? { type: "input.transcript.delta", itemId, delta }
        : { type: "unhandled", wireType };
    }

    case "conversation.item.input_audio_transcription.completed": {
      const itemId = str(event.item_id);
      const transcript = str(event.transcript);
      return itemId && transcript !== undefined
        ? { type: "input.transcript.done", itemId, transcript }
        : { type: "unhandled", wireType };
    }

    case "response.created":
      return { type: "response.created" };

    case "response.output_audio_transcript.delta": {
      const itemId = str(event.item_id);
      const delta = str(event.delta);
      return itemId && delta !== undefined
        ? { type: "output.transcript.delta", itemId, delta }
        : { type: "unhandled", wireType };
    }

    case "response.output_audio_transcript.done": {
      const itemId = str(event.item_id);
      const transcript = str(event.transcript);
      return itemId && transcript !== undefined
        ? { type: "output.transcript.done", itemId, transcript }
        : { type: "unhandled", wireType };
    }

    case "response.function_call_arguments.done": {
      const callId = str(event.call_id);
      const name = str(event.name);
      return callId && name
        ? {
            type: "function.call",
            call: { callId, name, argumentsJson: str(event.arguments) ?? "{}" },
          }
        : { type: "unhandled", wireType };
    }

    case "response.done":
      return { type: "response.done", calls: callsFromResponse(event.response) };

    case "error": {
      const detail = event.error as Record<string, unknown> | undefined;
      return {
        type: "error",
        message: str(detail?.message) ?? "The voice session reported an error",
      };
    }

    default:
      return { type: "unhandled", wireType };
  }
}
