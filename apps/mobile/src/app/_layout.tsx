import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import * as Network from "expo-network";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAuthStore } from "~/features/auth/auth-store";
import { colors } from "~/theme/tokens";

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
    const subscription = Network.addNetworkStateListener((state) => {
      onlineManager.setOnline(Boolean(state.isInternetReachable ?? state.isConnected));
    });

    return () => subscription.remove();
  }, []);
}

/**
 * Sends the user to the right screen once the stored token has been checked.
 *
 * Guarded on `status !== "unknown"`: redirecting before `restore` finishes
 * would flash the sign-in screen at a user who is already signed in.
 */
function useAuthRedirect() {
  const status = useAuthStore((state) => state.status);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === "unknown") return;

    const onSignIn = segments[0] === "sign-in";

    if (status === "signed-out" && !onSignIn) router.replace("/sign-in");
    if (status === "signed-in" && onSignIn) router.replace("/");
  }, [status, segments, router]);
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
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
