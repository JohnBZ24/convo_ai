import { PermissionsAndroid, Platform } from "react-native";
import { mediaDevices, RTCPeerConnection } from "react-native-webrtc";
import type { MinimalMediaStream, MinimalPeerConnection } from "./realtime-session";

/**
 * The only file in this app that imports `react-native-webrtc`.
 *
 * Everything above it works against the `Minimal*` interfaces, which is what
 * lets `realtime-session.ts` be unit tested at all: importing this module from
 * a test would pull in React Native's Flow-typed entry point, which no test
 * runner can parse. The casts here are the price of that boundary and belong
 * exactly here, at its edge.
 */

export function createRealtimePeerConnection(): MinimalPeerConnection {
  const peer = new RTCPeerConnection({
    /**
     * OpenAI's own samples pass no ICE servers at all - their endpoint has a
     * public address, so host candidates plus peer-reflexive discovery carry
     * the connection. A STUN server is kept anyway because it costs nothing
     * behind the gathering ceiling in `realtime-session.ts` and rescues the
     * NAT configurations where peer-reflexive alone does not.
     */
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  return peer as unknown as MinimalPeerConnection;
}

/**
 * Audio only, and no explicit constraints beyond that.
 *
 * Echo cancellation, noise suppression and auto gain are ON by default in
 * WebRTC and are the entire reason this app is not using a WebSocket - naming
 * them here would only create a place to accidentally turn one off.
 */
export async function openMicrophone(): Promise<MinimalMediaStream> {
  const stream = await mediaDevices.getUserMedia({ audio: true });
  return stream as unknown as MinimalMediaStream;
}

/**
 * `getUserMedia` does NOT request this for you on Android - it fails with a
 * permission error instead, which reads like a hardware fault.
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true;

  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: "Microphone",
      message: "Convo needs the microphone to hear you.",
      buttonPositive: "Allow",
      buttonNegative: "Not now",
    },
  );

  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/** The device's own IANA zone, for `get_current_time`. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
