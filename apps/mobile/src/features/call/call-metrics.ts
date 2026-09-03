/**
 * Timing a call, so iteration 7 can report NUMBERS rather than claims.
 *
 * Pure and injectable-clock, for the usual reason in this folder: it has to be
 * testable without a phone, and it must not import `react-native`. The device
 * writes these to logcat as one line per call, which `scripts/call-metrics.mjs`
 * turns into the table in DESIGN.md.
 *
 * The BREAKDOWN matters as much as the total. "Tap to first audio was 4.2s" is
 * not actionable; "of which 2.0s was ICE gathering and 0.3s was the mint" says
 * where to look. Each mark is a step in `RealtimeSession.open()`, in order.
 */

export const CALL_MARKS = [
  /** The orb was tapped: the user's clock starts here, so ours does too. */
  "tap",
  /** The microphone permission dialog is behind us (usually instant after the first run). */
  "permission",
  /** `POST /api/conversations` returned. */
  "conversation",
  /** `InCallManager.start` - MODE_IN_COMMUNICATION is set. */
  "audioMode",
  /** `getUserMedia` resolved. The mic is open, in the mode set above. */
  "microphone",
  /** `createOffer` + `setLocalDescription` done. */
  "offer",
  /** ICE gathering finished, or hit its 2s ceiling. */
  "iceComplete",
  /** The ephemeral credential is in hand. Its ~60s life starts here. */
  "credential",
  /** OpenAI's SDP answer is applied. */
  "answer",
  /** `ontrack` - the first remote audio arrived. THE number the user feels. */
  "remoteAudio",
  /** The data channel opened: the call is live and events flow. */
  "live",
] as const;

export type CallMark = (typeof CALL_MARKS)[number];

/** What one connect actually cost, in milliseconds, all relative to `tap`. */
export interface CallTimings {
  /** The headline: tap to the first audio packet from the model. */
  tapToRemoteAudio: number | null;
  /** Tap to the data channel opening, which is when the UI says "live". */
  tapToLive: number | null;
  /** The steps, so a slow total says WHERE it was slow. */
  permissionMs: number | null;
  conversationMs: number | null;
  microphoneMs: number | null;
  offerMs: number | null;
  iceGatheringMs: number | null;
  credentialMs: number | null;
  sdpExchangeMs: number | null;
}

/**
 * Records when each step of a connect happened.
 *
 * A mark is recorded ONCE. A reconnect gets a fresh timeline rather than
 * overwriting this one, so a dropped call cannot quietly rewrite the numbers
 * for the connect that preceded it.
 */
export class CallTimeline {
  private readonly marks = new Map<CallMark, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  mark(name: CallMark): void {
    if (this.marks.has(name)) return;
    this.marks.set(name, this.now());
  }

  at(name: CallMark): number | null {
    return this.marks.get(name) ?? null;
  }

  /** Milliseconds between two marks, or null if either never happened. */
  between(from: CallMark, to: CallMark): number | null {
    const start = this.marks.get(from);
    const end = this.marks.get(to);
    if (start === undefined || end === undefined) return null;
    return end - start;
  }

  timings(): CallTimings {
    return {
      tapToRemoteAudio: this.between("tap", "remoteAudio"),
      tapToLive: this.between("tap", "live"),
      permissionMs: this.between("tap", "permission"),
      conversationMs: this.between("permission", "conversation"),
      microphoneMs: this.between("audioMode", "microphone"),
      offerMs: this.between("microphone", "offer"),
      iceGatheringMs: this.between("offer", "iceComplete"),
      credentialMs: this.between("iceComplete", "credential"),
      sdpExchangeMs: this.between("credential", "answer"),
    };
  }

  /**
   * Only the timings that actually happened.
   *
   * A connect that failed at the mint should log the four steps it DID
   * complete, not eight nulls - the point of logging a failed connect is to
   * see how far it got.
   */
  recorded(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(this.timings())) {
      if (typeof value === "number") out[key] = value;
    }
    return out;
  }
}

/**
 * How long the model takes to start answering after the user stops talking.
 *
 * The second number in the design's table, and the one a person actually
 * notices in conversation. Measured from `input_audio_buffer.speech_stopped`
 * to the first output transcript delta, because with WebRTC the audio never
 * crosses the data channel - the first delta is the earliest HONEST signal
 * that the model has begun speaking. It slightly overstates the real audio
 * latency, and that is the right direction to be wrong in.
 */
export class ReplyLatency {
  private pendingSince: number | null = null;
  private readonly samples: number[] = [];

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** The user stopped talking. Server VAD decided this, not the app. */
  speechStopped(): void {
    this.pendingSince = this.now();
  }

  /**
   * The model started answering. Returns the latency, or null when nothing was
   * pending - which is the normal case for every delta after the first, and
   * for a reply the model volunteers without being asked.
   */
  replyStarted(): number | null {
    if (this.pendingSince === null) return null;

    const latency = this.now() - this.pendingSince;
    this.pendingSince = null;
    this.samples.push(latency);
    return latency;
  }

  /**
   * A cancelled reply leaves nothing pending. Without this, barge-in - the
   * user talking over the model - would leave a stale start time and the NEXT
   * reply would be reported as having taken however long the interruption
   * lasted.
   */
  reset(): void {
    this.pendingSince = null;
  }

  /** Every latency this call measured, in order, for the summary log line. */
  all(): readonly number[] {
    return this.samples;
  }

  /** Median, not mean: one slow first reply should not colour the whole call. */
  median(): number | null {
    if (this.samples.length === 0) return null;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 1) return sorted[middle] ?? null;

    const lower = sorted[middle - 1];
    const upper = sorted[middle];
    if (lower === undefined || upper === undefined) return null;

    return Math.round((lower + upper) / 2);
  }
}
