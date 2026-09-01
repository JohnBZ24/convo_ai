import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
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

  const { phase, activity, error, start, markReady, stop, finish, dismissError } =
    useCallStore();
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
   * The orb's CENTRE sits at 38% of USABLE height - the window minus both
   * insets - so it lands in the same visual place on a phone with a gesture bar
   * as on this one with three-button navigation. Never a pixel constant.
   */
  const usableHeight = height - insets.top - insets.bottom;
  const orbTop = usableHeight * ORB_CENTRE_FRACTION - ORB_BASE_DIAMETER * 0.8;

  const conversations = [
    { id: "mock-conversation", title: "What is on my calendar tomorrow?" },
  ];

  return (
    <Sidebar
      ref={drawerRef}
      conversations={conversations}
      onNewChat={() => {
        setLines([]);
        drawerRef.current?.closeDrawer();
      }}
      onSelect={() => drawerRef.current?.closeDrawer()}
      onSignOut={() => void signOut()}
    >
      <View
        style={[
          styles.screen,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        <Pressable
          style={[styles.menu, { top: insets.top + spacing.sm }]}
          onPress={() => drawerRef.current?.openDrawer()}
          accessibilityRole="button"
          accessibilityLabel="Open conversations"
          hitSlop={16}
        >
          <Text style={styles.menuGlyph}>{"☰"}</Text>
        </Pressable>

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
    left: spacing.md,
    zIndex: 1,
    padding: spacing.sm,
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
