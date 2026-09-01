import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { BorderlessButton } from "react-native-gesture-handler";
import type { DrawerLayoutMethods } from "react-native-gesture-handler/ReanimatedDrawerLayout";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Sidebar } from "~/components/sidebar";
import { useAuthStore } from "~/features/auth/auth-store";
import { useMockAmplitude } from "~/features/call/amplitude";
import { useCallStore } from "~/features/call/call-store";
import { Orb } from "~/features/call/orb";
import { Transcript, type TranscriptLine } from "~/features/call/transcript";
import {
  colors,
  ORB_BASE_DIAMETER,
  ORB_CENTRE_FRACTION,
  spacing,
  typography,
} from "~/theme/tokens";

/**
 * Iteration 4 has no audio, so a tap runs a scripted exchange instead. It exists
 * to prove the shell - the state machine, the orb, the list - on the device
 * before WebRTC is in the picture.
 */
const SCRIPTED_LINES: readonly TranscriptLine[] = [
  { id: "1", role: "user", text: "What is on my calendar tomorrow?" },
  {
    id: "2",
    role: "assistant",
    text: "You have two things: a design review at ten, and dinner at eight.",
  },
  { id: "3", role: "user", text: "Move the design review to the afternoon." },
  { id: "4", role: "assistant", text: "Done - it is at three now. Anything else?" },
];

export default function VoiceScreen() {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const drawerRef = useRef<DrawerLayoutMethods>(null);

  /**
   * One selector per field, NOT `useCallStore()` bare.
   *
   * The bare call subscribes to the whole store, so every `activity` change
   * re-rendered this screen - and with it the sidebar, whose drawer panel was
   * then reconciled from scratch. That is the JS work the menu tap had to queue
   * behind, which is why the tap felt laggy while the swipe (pure UI thread)
   * stayed smooth.
   */
  const phase = useCallStore((state) => state.phase);
  const activity = useCallStore((state) => state.activity);
  const error = useCallStore((state) => state.error);
  const start = useCallStore((state) => state.start);
  const markReady = useCallStore((state) => state.markReady);
  const stop = useCallStore((state) => state.stop);
  const finish = useCallStore((state) => state.finish);
  const dismissError = useCallStore((state) => state.dismissError);
  const signOut = useAuthStore((state) => state.signOut);

  const [lines, setLines] = useState<readonly TranscriptLine[]>([]);

  /**
   * The mock amplitude source. Iteration 5 deletes this line and starts the
   * real microphone instead - everything downstream reads the same shared
   * value, so nothing else on this screen changes.
   */
  useMockAmplitude(phase === "live" && activity !== "thinking");

  /** Fake the connect and teardown delays the real transport will have. */
  useEffect(() => {
    if (phase === "connecting") {
      const timer = setTimeout(() => markReady("mock-conversation"), 700);
      return () => clearTimeout(timer);
    }

    if (phase === "ending") {
      const timer = setTimeout(finish, 400);
      return () => clearTimeout(timer);
    }

    return undefined;
  }, [phase, markReady, finish]);

  /** Reveal the scripted transcript a line at a time while live. */
  useEffect(() => {
    if (phase !== "live") return undefined;

    let index = 0;
    const timer = setInterval(() => {
      const next = SCRIPTED_LINES[index];
      if (!next) {
        clearInterval(timer);
        return;
      }
      setLines((current) => [...current, next]);
      index += 1;
    }, 1800);

    return () => clearInterval(timer);
  }, [phase]);

  const onOrbPress = useCallback(() => {
    if (phase === "error") {
      dismissError();
      return;
    }
    if (phase === "live") {
      stop();
      return;
    }
    setLines([]);
    start();
  }, [phase, start, stop, dismissError]);

  /**
   * Opening takes ~293ms, and that is as fast as this drawer goes.
   *
   * Measured, not assumed: `openDrawer()` itself returns in 3-29ms, so the delay
   * is the drawer's spring, not JS. Passing `animationSpeed` to speed it up
   * makes it WORSE - 1.25 gave 532ms and 2.0 gave 430ms against the default's
   * 293ms - because `mass = 1/animationSpeed`, and raising the speed pushes the
   * damping ratio past 1, where the spring approaches its target asymptotically
   * and takes longer to satisfy Reanimated's finished threshold. The default is
   * slightly underdamped and gets there soonest. Leave it alone.
   */
  /**
   * `animationSpeed: 2` on the CALL, not on the drawer.
   *
   * Measured: a tap took ~300ms to reach the open state, while `openDrawer()`
   * itself returned in 3-29ms. So the delay was never JS - it is the drawer's
   * spring (mass 1, damping 40, stiffness 500 -> settling ~200ms plus the
   * threshold). A swipe hides this because the drawer tracks the finger 1:1 and
   * only springs the last few pixels; a tap has no such feedback, so the whole
   * settle reads as lag.
   *
   * `mass = 1 / animationSpeed`, so 2 halves the mass and roughly halves the
   * settle. Passed per call so the SWIPE release keeps the default feel, which
   * is already right.
   */
  const openDrawer = useCallback(() => drawerRef.current?.openDrawer(), []);

  /**
   * The orb's CENTRE sits at 38% of USABLE height - the window minus both
   * insets - so it lands in the same visual place on a phone with a gesture bar
   * as on this one with three-button navigation. Never a pixel constant.
   */
  const usableHeight = height - insets.top - insets.bottom;
  const orbTop = usableHeight * ORB_CENTRE_FRACTION - ORB_BASE_DIAMETER * 0.8;

  /**
   * Every prop below is stable across renders, on purpose.
   *
   * `Sidebar` is memoised, and a fresh array or arrow function here would defeat
   * that on every single render - rebuilding the drawer's whole panel subtree
   * and putting that work in front of the next tap.
   */
  const conversations = useMemo(
    () => [{ id: "mock-conversation", title: "What is on my calendar tomorrow?" }],
    [],
  );

  const closeDrawer = useCallback(() => drawerRef.current?.closeDrawer(), []);

  const onNewChat = useCallback(() => {
    setLines([]);
    closeDrawer();
  }, [closeDrawer]);

  const onSignOut = useCallback(() => void signOut(), [signOut]);

  return (
    <Sidebar
      ref={drawerRef}
      conversations={conversations}
      onNewChat={onNewChat}
      onSelect={closeDrawer}
      onSignOut={onSignOut}
    >
      <View
        style={[
          styles.screen,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        {/*
          A real native button, from gesture-handler - not RN's `Pressable` and
          not a raw `GestureDetector`.

          `BorderlessButton` is built on `NativeViewGestureHandler`, so the press
          is recognised in native code and COORDINATES with the drawer's pan
          instead of racing it. RN's own `Pressable` lives in a separate touch
          system that has no say in gesture-handler's arbitration, which is why
          it dropped presses here: the button sits at x 0..70dp and the drawer
          claims x 0..48dp for its edge swipe, so they overlap almost entirely.

          The target is a full 48dp square (Material's minimum) rather than the
          22dp glyph plus hitSlop, so it is comfortably hittable with a thumb.
        */}
        <BorderlessButton
          style={[styles.menu, { top: insets.top + spacing.sm }]}
          onPress={openDrawer}
          rippleRadius={26}
          accessibilityRole="button"
          accessibilityLabel="Open conversations"
        >
          <Text style={styles.menuGlyph}>{"☰"}</Text>
        </BorderlessButton>

        <View style={[styles.orbSlot, { marginTop: orbTop }]}>
          <Orb phase={phase} activity={activity} onPress={onOrbPress} />
          <Text style={styles.status}>{statusLabel(phase, error)}</Text>
        </View>

        <View style={styles.transcript}>
          <Transcript lines={lines} />
        </View>
      </View>
    </Sidebar>
  );
}

function statusLabel(phase: string, error: string | null): string {
  if (phase === "error") return error ?? "Something went wrong";
  if (phase === "connecting") return "Connecting";
  if (phase === "ending") return "Ending";
  if (phase === "live") return "Listening";
  return "Tap to talk";
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  menu: {
    position: "absolute",
    left: spacing.sm,
    zIndex: 1,
    /** 48dp square: Material's minimum touch target, not the 22dp glyph. */
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  menuGlyph: {
    fontSize: 22,
    color: colors.text,
  },
  orbSlot: {
    alignItems: "center",
  },
  status: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.sm,
  },
  transcript: {
    flex: 1,
    marginTop: spacing.md,
  },
});
