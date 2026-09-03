import { create } from "zustand";

/**
 * Whether this device believes it can reach anything.
 *
 * A store rather than a hook with its own listener, because `_layout.tsx`
 * ALREADY subscribes to `expo-network` to drive TanStack Query's
 * `onlineManager`. Adding a second subscription for the call screen would mean
 * two sources of truth that can disagree - and the one the user notices would
 * be whichever updated last.
 *
 * Zustand only, no `react-native` and no `expo-network`, so the state machine
 * that reads it stays testable.
 */
export interface NetworkState {
  /**
   * Starts TRUE, deliberately.
   *
   * The first `expo-network` reading arrives a moment after launch, and
   * assuming offline until told otherwise would blank the orb behind "No
   * connection" every cold start. Being briefly wrong in the optimistic
   * direction costs one failed request with a clear message; being wrong the
   * other way makes a working app look broken.
   */
  online: boolean;
  setOnline: (online: boolean) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  online: true,
  setOnline: (online) => set({ online }),
}));

/** Read it outside React - the call session needs it in a callback, not a render. */
export function isOnline(): boolean {
  return useNetworkStore.getState().online;
}
