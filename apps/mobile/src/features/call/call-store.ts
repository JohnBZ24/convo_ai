import { create } from "zustand";

/**
 * The call state machine.
 *
 *   idle --tap--> connecting --ready--> live --tap--> ending --> idle
 *                     |                  |  ^          |
 *                     |                  v  |          |
 *                     |            reconnecting        |
 *                     |                  |             |
 *                     +----- error <-----+-------------+
 *
 * Iteration 4 has no audio, so `connecting` and `ending` are driven by timers.
 * Iteration 5 replaces those timers with WebRTC lifecycle events and nothing
 * else here changes - which is the point of keeping the machine separate from
 * whatever produces the transitions.
 *
 * Iteration 7 adds `reconnecting`: a dropped connection is not the same thing
 * as a failed one, and a phone that changed Wi-Fi cell mid-sentence should get
 * its call back rather than an error message. The transcript is deliberately
 * NOT cleared on the way through, so the conversation is still on screen when
 * the audio returns.
 */
export type CallPhase =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "ending"
  | "error";

/**
 * While `live`, this drives the orb's visual. It is NOT part of the phase
 * machine: a call is live whether the user is talking or the model is.
 */
export type CallActivity = "listening" | "thinking" | "speaking";

export interface CallState {
  phase: CallPhase;
  activity: CallActivity;
  /** Set only in the `error` phase. Shown to the user, so keep it plain. */
  error: string | null;
  /** The conversation this call is recording into, once the server has one. */
  conversationId: string | null;
  /** How many times this call has been recovered. Shown to nobody; logged. */
  reconnectCount: number;

  start: () => void;
  markReady: (conversationId: string) => void;
  setActivity: (activity: CallActivity) => void;
  stop: () => void;
  finish: () => void;
  drop: () => void;
  fail: (message: string) => void;
  dismissError: () => void;
}

export const useCallStore = create<CallState>((set, get) => ({
  phase: "idle",
  activity: "listening",
  error: null,
  conversationId: null,
  reconnectCount: 0,

  /**
   * The first tap. Ignored unless idle or recovering from an error, so a
   * double-tap cannot open two sessions - which on iteration 5 would mean two
   * WebRTC connections and two bills.
   */
  start: () => {
    const { phase } = get();
    if (phase !== "idle" && phase !== "error") return;
    set({
      phase: "connecting",
      error: null,
      activity: "thinking",
      reconnectCount: 0,
    });
  },

  /**
   * Reached from `connecting` on a first connect and from `reconnecting` after
   * a recovery, which is why it accepts both - a recovered call must land back
   * in `live` or the orb would stay spinning over a working connection.
   */
  markReady: (conversationId) => {
    const { phase } = get();
    if (phase !== "connecting" && phase !== "reconnecting") return;
    set({ phase: "live", activity: "listening", conversationId });
  },

  setActivity: (activity) => {
    if (get().phase !== "live") return;
    set({ activity });
  },

  /** The second tap. Also allowed while reconnecting: hanging up must always work. */
  stop: () => {
    const { phase } = get();
    if (phase !== "live" && phase !== "reconnecting") return;
    set({ phase: "ending" });
  },

  finish: () =>
    set({
      phase: "idle",
      activity: "listening",
      conversationId: null,
      reconnectCount: 0,
    }),

  /**
   * The connection dropped and is being rebuilt.
   *
   * Only from `live`: a drop during `connecting` has nothing to recover to, and
   * one during `ending` is just the teardown doing its job. `conversationId` is
   * KEPT, because the recovered call records into the same conversation and the
   * transcript already on screen belongs to it.
   */
  drop: () => {
    if (get().phase !== "live") return;
    set((state) => ({
      phase: "reconnecting",
      activity: "thinking",
      reconnectCount: state.reconnectCount + 1,
    }));
  },

  /**
   * Reachable from any phase: a connection can drop mid-sentence. The
   * conversation id is kept so the transcript already on screen still belongs
   * to something after a retry.
   */
  fail: (message) => set({ phase: "error", error: message }),

  dismissError: () => set({ phase: "idle", error: null, activity: "listening" }),
}));

/** True while the orb should look "engaged" - anything but idle and error. */
export function isCallActive(phase: CallPhase): boolean {
  return (
    phase === "connecting" ||
    phase === "live" ||
    phase === "reconnecting" ||
    phase === "ending"
  );
}
