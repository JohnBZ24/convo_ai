import { create } from "zustand";

/**
 * The call state machine.
 *
 *   idle --tap--> connecting --ready--> live --tap--> ending --> idle
 *                     |                  |             |
 *                     +----- error <-----+-------------+
 *
 * Iteration 4 has no audio, so `connecting` and `ending` are driven by timers.
 * Iteration 5 replaces those timers with WebRTC lifecycle events and nothing
 * else here changes - which is the point of keeping the machine separate from
 * whatever produces the transitions.
 */
export type CallPhase = "idle" | "connecting" | "live" | "ending" | "error";

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

  start: () => void;
  markReady: (conversationId: string) => void;
  setActivity: (activity: CallActivity) => void;
  stop: () => void;
  finish: () => void;
  fail: (message: string) => void;
  dismissError: () => void;
}

export const useCallStore = create<CallState>((set, get) => ({
  phase: "idle",
  activity: "listening",
  error: null,
  conversationId: null,

  /**
   * The first tap. Ignored unless idle or recovering from an error, so a
   * double-tap cannot open two sessions - which on iteration 5 would mean two
   * WebRTC connections and two bills.
   */
  start: () => {
    const { phase } = get();
    if (phase !== "idle" && phase !== "error") return;
    set({ phase: "connecting", error: null, activity: "thinking" });
  },

  markReady: (conversationId) => {
    if (get().phase !== "connecting") return;
    set({ phase: "live", activity: "listening", conversationId });
  },

  setActivity: (activity) => {
    if (get().phase !== "live") return;
    set({ activity });
  },

  /** The second tap. */
  stop: () => {
    if (get().phase !== "live") return;
    set({ phase: "ending" });
  },

  finish: () => set({ phase: "idle", activity: "listening", conversationId: null }),

  /**
   * Reachable from any phase: a connection can drop mid-sentence. The
   * conversation id is kept so the transcript already on screen still belongs
   * to something after a retry.
   */
  fail: (message) => set({ phase: "error", error: message }),

  dismissError: () => set({ phase: "idle", error: null, activity: "listening" }),
}));

/** True while the orb should look "engaged" - connecting, live or ending. */
export function isCallActive(phase: CallPhase): boolean {
  return phase === "connecting" || phase === "live" || phase === "ending";
}
