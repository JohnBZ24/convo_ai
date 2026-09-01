import { memo, useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { colors, ORB_BASE_DIAMETER } from "~/theme/tokens";
import { amplitude } from "./amplitude";
import type { CallActivity, CallPhase } from "./call-store";

interface OrbProps {
  phase: CallPhase;
  activity: CallActivity;
  onPress: () => void;
}

/**
 * The orb IS the button. There is no separate mic control anywhere in the app.
 *
 * Every animation here runs on the UI thread, reading `amplitude` directly. No
 * value crosses to JS, so the orb keeps moving while React is busy rendering a
 * transcript - which is exactly when a voice app must not look frozen.
 */
function OrbComponent({ phase, activity, onPress }: OrbProps) {
  /** A slow breath, used while connecting or thinking - when there is no voice to follow. */
  const idlePulse = useSharedValue(0);

  const isIdlePulsing =
    phase === "connecting" || phase === "ending" || activity === "thinking";

  useEffect(() => {
    if (!isIdlePulsing) {
      cancelAnimation(idlePulse);
      idlePulse.value = withTiming(0, { duration: 300 });
      return;
    }

    idlePulse.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [isIdlePulsing, idlePulse]);

  /**
   * One source of truth for "how big is the orb right now", so the core and the
   * halo cannot drift apart by a frame.
   */
  const level = useDerivedValue(() =>
    isIdlePulsing ? idlePulse.value * 0.45 : amplitude.value,
  );

  const coreStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(level.value, [0, 1], [1, 1.18]) }],
  }));

  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(level.value, [0, 1], [1, 1.55]) }],
    opacity: interpolate(level.value, [0, 1], [0.16, 0.42]),
  }));

  const isDormant = phase === "idle" || phase === "error";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={isDormant ? "Start talking" : "End the conversation"}
      hitSlop={24}
      style={styles.pressable}
    >
      <View style={styles.stack}>
        <Animated.View style={[styles.halo, haloStyle]} pointerEvents="none" />
        <Animated.View
          style={[styles.core, coreStyle, isDormant && styles.coreDormant]}
          pointerEvents="none"
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    alignItems: "center",
    justifyContent: "center",
  },
  stack: {
    width: ORB_BASE_DIAMETER * 1.6,
    height: ORB_BASE_DIAMETER * 1.6,
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
    width: ORB_BASE_DIAMETER,
    height: ORB_BASE_DIAMETER,
    borderRadius: ORB_BASE_DIAMETER / 2,
    backgroundColor: colors.accent,
  },
  core: {
    width: ORB_BASE_DIAMETER,
    height: ORB_BASE_DIAMETER,
    borderRadius: ORB_BASE_DIAMETER / 2,
    backgroundColor: colors.accent,
  },
  /** Dormant is a ring, not a disc: the app looks asleep until it is tapped. */
  coreDormant: {
    backgroundColor: "transparent",
    borderWidth: 2,
    borderColor: colors.accent,
  },
});

export const Orb = memo(OrbComponent);
