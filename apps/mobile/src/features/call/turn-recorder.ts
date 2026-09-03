import { TURN_TEXT_MAX_LENGTH } from "@convo/shared";
import type { RealtimeEvent } from "./realtime-events";
import type { TranscriptState } from "./transcript-assembler";

/**
 * Turning a finished line of transcript into a stored turn.
 *
 * Until this existed the transcript lived in React state and died with the
 * screen: `POST /api/conversations/:id/turns` had no caller at all. Nothing
 * here imports React, React Native or the API client - the transport arrives
 * through `deps`, for the same reason `realtime-session.ts` takes its WebRTC
 * that way, and because the retry behaviour is the part worth testing.
 */

export interface PendingTurn {
  seq: number;
  role: "user" | "assistant";
  text: string;
}

/**
 * The turn a `*.transcript.done` event completes, or null if it completes none.
 *
 * `seq` is THE POSITION OF THE LINE'S SLOT in the assembler's order, 1-based -
 * not a counter. That is what makes a retry safe: the same line always computes
 * the same seq, so a second POST collides with the server's unique index on
 * `(conversation_id, seq)` and is answered as a replay instead of storing the
 * sentence twice.
 *
 * A counter could not do that. It would have to be incremented somewhere, and
 * whether it had been incremented before a failed request is exactly the thing
 * a dropped response cannot tell you.
 *
 * Take `state` AFTER the event has been reduced, so a line that claimed its
 * slot on this very event still has one.
 */
export function completedTurn(
  state: TranscriptState,
  event: RealtimeEvent,
): PendingTurn | null {
  if (event.type !== "input.transcript.done" && event.type !== "output.transcript.done")
    return null;

  const index = state.entries.findIndex((entry) => entry.id === event.itemId);
  if (index === -1) return null;

  /**
   * Whitespace-only transcripts are real and routine: the VAD commits a cough
   * or a door, and transcription returns "" or " ". Storing those would fill
   * the history with blank rows, and the server rejects an empty `text` with a
   * 422 anyway - which the recorder would then retry three times for nothing.
   */
  const text = event.transcript.trim();
  if (text.length === 0) return null;

  return {
    seq: index + 1,
    role: event.type === "input.transcript.done" ? "user" : "assistant",
    // The server's cap. Truncating here turns an impossible-to-satisfy 422
    // into a stored turn that is merely long.
    text: text.slice(0, TURN_TEXT_MAX_LENGTH),
  };
}

export interface TurnRecorderDeps {
  /** Posts one turn. Rejects on anything the server or the network refuses. */
  post: (turn: PendingTurn) => Promise<unknown>;
  log?: (message: string, detail?: Record<string, unknown>) => void;
  /** Injected so tests do not spend real seconds inside a backoff. */
  wait?: (ms: number) => Promise<void>;
  /** Delay before each retry, in order. Its length is the retry count. */
  backoffMs?: readonly number[];
}

const DEFAULT_BACKOFF_MS = [500, 2000, 5000] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Posts completed turns, in order, surviving a bad network.
 *
 * Two rules, both of which matter on a phone:
 *
 *   1. SERIAL. Turns queue behind one another rather than racing. A call
 *      produces a handful of these a minute, so there is nothing to gain from
 *      parallelism, and a burst of retries from a phone that just came back on
 *      to a weak signal is exactly what a queue avoids.
 *   2. AT MOST ONCE PER SEQ, locally. A seq that has been handed to `record`
 *      is never handed to it again, so a repeated `done` event - which OpenAI
 *      does emit - costs nothing. The server's unique index is the second line
 *      of defence, for the retry that DID reach it before the response was
 *      lost.
 *
 * Failure is logged and dropped, never thrown. A turn that will not store is a
 * missing line in a history screen; an unhandled rejection during a live call
 * would be a crash while the user is talking.
 */
export class TurnRecorder {
  private queue: Promise<void> = Promise.resolve();
  private readonly claimed = new Set<number>();

  constructor(private readonly deps: TurnRecorderDeps) {}

  /**
   * Queue a turn. Resolves when the queue has drained PAST it - which is what
   * a test awaits; nothing in the app does, because a call must not wait on
   * the network to carry on listening.
   */
  record(turn: PendingTurn): Promise<void> {
    if (this.claimed.has(turn.seq)) return this.queue;
    this.claimed.add(turn.seq);

    this.queue = this.queue.then(() => this.deliver(turn));
    return this.queue;
  }

  /** Resolves once every queued turn has been delivered or given up on. */
  drain(): Promise<void> {
    return this.queue;
  }

  private async deliver(turn: PendingTurn): Promise<void> {
    const wait = this.deps.wait ?? sleep;
    const backoff = this.deps.backoffMs ?? DEFAULT_BACKOFF_MS;

    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.deps.post(turn);
        return;
      } catch (error) {
        const delay = backoff[attempt];

        if (delay === undefined) {
          /**
           * Out of attempts. The transcript on screen is unaffected - it is
           * assembled from the data channel, not from what was stored - so the
           * user sees their conversation either way and only the history is
           * short a line.
           */
          this.deps.log?.("gave up storing a turn", {
            seq: turn.seq,
            role: turn.role,
            error: describe(error),
          });
          return;
        }

        await wait(delay);
      }
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
