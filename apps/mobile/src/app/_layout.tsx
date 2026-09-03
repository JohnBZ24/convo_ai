import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import * as Network from "expo-network";
import { Stack, useRootNavigationState, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { PerformanceMonitor } from "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAuthStore } from "~/features/auth/auth-store";
import { useNetworkStore } from "~/features/network/network-store";
import { colors } from "~/theme/tokens";

/**
 * The UI/JS frame-rate overlay, for iteration 7's measurement table.
 *
 * Behind a build-time flag rather than a dev-only check, because the numbers
 * that matter are a RELEASE build's - a dev build carries the bridge's
 * debugging overhead and would report a frame rate the user never sees. Set
 * `EXPO_PUBLIC_PERF_OVERLAY=true` in `apps/mobile/.env` and rebuild; Metro
 * inlines it, so this costs nothing in a normal build.
 */
const SHOW_PERFORMANCE_OVERLAY = process.env.EXPO_PUBLIC_PERF_OVERLAY === "true";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

/**
 * TanStack Query assumes a browser: it listens for `visibilitychange` and
 * `navigator.onLine`, neither of which exists here. Without these two bridges
 * a refetch-on-focus never fires and every query believes it is offline
 * forever.
 */
function useQueryPlatformBridges() {
  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (status: AppStateStatus) => {
        focusManager.setFocused(status === "active");
      },
    );

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const apply = (state: { isInternetReachable?: boolean; isConnected?: boolean }) => {
      const online = Boolean(state.isInternetReachable ?? state.isConnected);
      onlineManager.setOnline(online);
      // The SAME reading drives the call screen. Two subscriptions would be two
      // sources of truth that can disagree, and the user would see whichever
      // updated last.
      useNetworkStore.getState().setOnline(online);
    };

    /**
     * Ask once as well as subscribing. The listener only fires on a CHANGE, so
     * an app launched with Wi-Fi already off would never hear about it.
     */
    void Network.getNetworkStateAsync()
      .then(apply)
      .catch(() => undefined);

    const subscription = Network.addNetworkStateListener(apply);

    return () => subscription.remove();
  }, []);
}

/**
 * Sends the user to the right screen once the stored token has been checked.
 *
 * Two guards, and BOTH are load-bearing:
 *
 * - `status !== "unknown"` - redirecting before `restore` finishes would flash
 *   the sign-in screen at a user who is already signed in.
 * - the navigator must be mounted. This hook runs inside the ROOT layout, which
 *   renders before `<Stack>` has a navigation tree, and a `router.replace` from
 *   there is silently DROPPED - no error, no navigation. The app then sits on
 *   the voice screen with no session, which reads as a broken guard rather than
 *   a timing bug.
 */
function useAuthRedirect() {
  const status = useAuthStore((state) => state.status);
  const segments = useSegments();
  const router = useRouter();
  const navigationState = useRootNavigationState();

  useEffect(() => {
    if (status === "unknown") return;
    if (!navigationState?.key) return;

    const onSignIn = segments[0] === "sign-in";

    if (status === "signed-out" && !onSignIn) router.replace("/sign-in");
    if (status === "signed-in" && onSignIn) router.replace("/");
    /**
     * `navigationState?.key` MUST be in this list. It is read above as a guard,
     * and on a cold start it becomes available AFTER `restore` has already
     * settled `status` - so without it the effect never re-runs once the
     * navigator is ready, and the redirect is simply never issued. The symptom
     * is an app that sits on the voice screen with no session and no error.
     */
  }, [status, segments, router, navigationState?.key]);
}

export default function RootLayout() {
  const restore = useAuthStore((state) => state.restore);
  const [restoreStarted, setRestoreStarted] = useState(false);
  const startedRef = useRef(false);

  useQueryPlatformBridges();
  useAuthRedirect();

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void restore().finally(() => setRestoreStarted(true));
  }, [restore]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          {/*
            No `backgroundColor`: SDK 57 removed it along with
            `edgeToEdgeEnabled`, because edge-to-edge is now unconditional and
            the bar is always transparent. The root view supplies the colour.
          */}
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
              animation: restoreStarted ? "default" : "none",
            }}
          />
          {SHOW_PERFORMANCE_OVERLAY ? <PerformanceMonitor /> : null}
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
