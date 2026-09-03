import { useEffect } from "react";
import { makeMutable, useFrameCallback, withTiming } from "react-native-reanimated";

/**
 * THE amplitude contract.
 *
 * One shared value, 0..1, living outside React. Iteration 4 filled it from the
 * mock below; iteration 5 fills it from the real microphone and the real
 * assistant audio. Nothing that READS it changed, which is the whole reason it
 * is declared here rather than inside whichever component needed it first - the
 * orb animation was proven on a real device before any audio code existed.
 *
 * The mock writes it from a frame callback, on the UI thread. The live source
 * cannot: WebRTC stats are only readable from JS. So it writes a `withTiming`
 * instead - the WRITE is on the JS thread, but the interpolation between
 * samples runs on the UI thread, so a 10Hz sample rate still animates smoothly
 * and a busy JS thread still cannot stall the orb. That property is what this
 * value exists to protect.
 */
export const amplitude = makeMutable(0);

/** Long enough to bridge two samples, short enough not to smear a syllable. */
const SAMPLE_INTERVAL_MS = 100;
const EASE_IN_MS = 120;
const EASE_OUT_MS = 220;

/**
 * A speech-shaped envelope, entirely on the UI thread.
 *
 * Three sines rather than a single one, because a pure sine reads as a
 * breathing light rather than a voice: a ~4.5Hz syllable rate, an ~11Hz jitter
 * for the texture inside a syllable, and a slow gate that closes between
 * phrases so the orb actually goes quiet the way a talking person does.
 *
 * Kept after iteration 5: it is how the orb is exercised without spending a
 * realtime session.
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
      amplitude.value = withTiming(0, { duration: EASE_OUT_MS });
    }
  }, [enabled, frame]);
}

/**
 * The real thing: poll `sample` and write what it returns.
 *
 * `sample` must be stable across renders, or the interval is torn down and
 * rebuilt on every one. Pass `null` to stop.
 */
export function useLiveAmplitude(sample: (() => Promise<number>) | null): void {
  useEffect(() => {
    if (!sample) {
      amplitude.value = withTiming(0, { duration: EASE_OUT_MS });
      return undefined;
    }

    let stopped = false;

    const timer = setInterval(() => {
      void sample().then((level) => {
        if (stopped) return;
        amplitude.value = withTiming(shape(level), { duration: EASE_IN_MS });
      });
    }, SAMPLE_INTERVAL_MS);

    return () => {
      stopped = true;
      clearInterval(timer);
      amplitude.value = withTiming(0, { duration: EASE_OUT_MS });
    };
  }, [sample]);
}

/**
 * WebRTC reports `audioLevel` as linear amplitude, and ordinary speech sits
 * around 0.02-0.3 there - fed straight to the orb it would barely move. A
 * square root opens up the quiet end, which is where a conversation lives, and
 * the multiplier puts normal speech near the top of the orb's range.
 *
 * Calibrated against iteration 4's measured 344-356px orb sweep on the Note 8.
 */
function shape(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  return Math.min(1, Math.sqrt(level) * 1.4);
}
