import { useEffect } from "react";
import { makeMutable, useFrameCallback, withTiming } from "react-native-reanimated";

/**
 * THE amplitude contract.
 *
 * One shared value, 0..1, living outside React. Iteration 4 fills it from the
 * mock below; iteration 5 will fill it from the real microphone. Nothing that
 * READS it changes, which is the whole reason it is declared here rather than
 * inside whichever component happens to need it first - the orb animation is
 * proven on a real device before any audio code exists.
 *
 * It is written on the UI thread and read on the UI thread, so a busy JS thread
 * cannot stall the orb.
 */
export const amplitude = makeMutable(0);

/**
 * A speech-shaped envelope, entirely on the UI thread.
 *
 * Three sines rather than a single one, because a pure sine reads as a
 * breathing light rather than a voice: a ~4.5Hz syllable rate, an ~11Hz jitter
 * for the texture inside a syllable, and a slow gate that closes between
 * phrases so the orb actually goes quiet the way a talking person does.
 */
export function useMockAmplitude(enabled: boolean): void {
  const frame = useFrameCallback((info) => {
    "worklet";
    const t = info.timeSinceFirstFrame / 1000;
    const syllable = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 4.5);
    const jitter = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 11.3);
    const phraseGate = Math.max(0, Math.sin(t * 2 * Math.PI * 0.32));

    amplitude.value = phraseGate * (0.65 * syllable + 0.35 * jitter);
  }, false);

  useEffect(() => {
    frame.setActive(enabled);

    if (!enabled) {
      // Ease out rather than snap: a hard cut to 0 reads as a glitch.
      amplitude.value = withTiming(0, { duration: 220 });
    }
  }, [enabled, frame]);
}
