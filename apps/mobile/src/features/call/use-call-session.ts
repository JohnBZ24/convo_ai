import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthStore } from "~/features/auth/auth-store";
import { createConversation, endConversation } from "~/lib/api/conversations";
import { mintRealtimeCredential, postRealtimeOffer } from "~/lib/api/realtime";
import { executeTool } from "~/lib/api/tools";
import { useLiveAmplitude } from "./amplitude";
import { beginCallAudio, endCallAudio } from "./audio-route";
import { useCallStore } from "./call-store";
import { type DeviceToolDeps, runFunctionCall } from "./device-tools";
import type { RealtimeEvent, RealtimeFunctionCall } from "./realtime-events";
import { RealtimeSession, type RealtimeSessionDeps } from "./realtime-session";
import {
  emptyTranscript,
  reduceTranscript,
  type TranscriptLine,
  type TranscriptState,
  visibleLines,
} from "./transcript-assembler";
import {
  createRealtimePeerConnection,
  deviceTimeZone,
  openMicrophone,
  requestMicrophonePermission,
} from "./webrtc-adapter";

/**
 * The wiring: call machine <-> transport <-> transcript.
 *
 * This is what replaced the two `setTimeout`s that faked `connecting` and
 * `ending` in iteration 4. `call-store.ts` is untouched - it was always meant
 * to be driven by whatever produced the transitions, and now something real
 * does.
 *
 * Everything the transport needs is read through a ref rather than closed over,
 * so the effect that opens a call depends on `phase` ALONE. A dependency on the
 * auth token would tear down and reopen a live WebRTC connection the moment the
 * token was refreshed.
 */
export function useCallSession(): readonly TranscriptLine[] {
  const phase = useCallStore((state) => state.phase);
  const markReady = useCallStore((state) => state.markReady);
  const setActivity = useCallStore((state) => state.setActivity);
  const finish = useCallStore((state) => state.finish);
  const fail = useCallStore((state) => state.fail);
  const token = useAuthStore((state) => state.token);

  const [transcript, setTranscript] = useState<TranscriptState>(emptyTranscript);

  const sessionRef = useRef<RealtimeSession | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  /** Function calls already answered. `response.done` can repeat one. */
  const answered = useRef(new Set<string>());

  const dispatchCall = useCallback(async (call: RealtimeFunctionCall) => {
    const session = sessionRef.current;
    const bearer = tokenRef.current;
    if (!session || answered.current.has(call.callId)) return;
    answered.current.add(call.callId);

    const deps: DeviceToolDeps = {
      proxy: async (name, request) => {
        if (!bearer) throw new Error("Not signed in");
        const response = await executeTool(bearer, name, request);
        return response.result;
      },
      now: () => new Date(),
      deviceTimeZone,
    };

    const output = await runFunctionCall(call, session.conversationId, deps);

    session.send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: call.callId, output },
    });
    // The model is waiting on us: without this it never speaks the answer.
    session.send({ type: "response.create" });
  }, []);

  const onEvent = useCallback(
    (event: RealtimeEvent) => {
      setTranscript((state) => reduceTranscript(state, event));

      switch (event.type) {
        case "speech.started":
          setActivity("listening");
          break;

        case "speech.stopped":
        case "response.created":
          setActivity("thinking");
          break;

        /**
         * With WebRTC the audio itself never crosses the data channel, so the
         * first transcript delta is the earliest honest signal that the model
         * has started speaking.
         */
        case "output.transcript.delta":
          setActivity("speaking");
          break;

        case "response.done":
          setActivity("listening");
          for (const call of event.calls) void dispatchCall(call);
          break;

        case "function.call":
          void dispatchCall(event.call);
          break;

        default:
          break;
      }
    },
    [dispatchCall, setActivity],
  );

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  /** Opens a call. Depends on `phase` only - see the note at the top. */
  useEffect(() => {
    if (phase !== "connecting") return undefined;

    setTranscript(emptyTranscript);
    answered.current = new Set();

    const deps: RealtimeSessionDeps = {
      webrtc: {
        createPeerConnection: createRealtimePeerConnection,
        getUserMedia: openMicrophone,
      },
      api: {
        createConversation: async () => {
          const bearer = tokenRef.current;
          if (!bearer) throw new Error("Not signed in");
          const conversation = await createConversation(bearer);
          return conversation.id;
        },
        mintCredential: async (conversationId) => {
          const bearer = tokenRef.current;
          if (!bearer) throw new Error("Not signed in");
          return mintRealtimeCredential(bearer, conversationId);
        },
        postOffer: postRealtimeOffer,
        endConversation: async (conversationId) => {
          const bearer = tokenRef.current;
          if (!bearer) return;
          await endConversation(bearer, conversationId);
        },
      },
      audio: { begin: beginCallAudio, end: endCallAudio },
      requestMicrophone: requestMicrophonePermission,
      /**
       * The server's redacting logger cannot be imported here, and the app has
       * none of its own. Nothing passed in carries a transcript or a secret -
       * `realtime-session` logs the session id and the model, never the
       * `clientSecret` - so keep it that way when adding a call.
       */
      log: (message, detail) => {
        console.log(`[call] ${message}`, detail ?? "");
      },
    };

    const session = new RealtimeSession(deps, {
      onReady: markReady,
      onEvent: (event) => onEventRef.current(event),
      onFailure: fail,
    });

    sessionRef.current = session;
    void session.open();

    return undefined;
  }, [phase, markReady, fail]);

  /** Closes it. `ending` is the user hanging up; `error` is everything else. */
  useEffect(() => {
    if (phase !== "ending" && phase !== "error") return undefined;

    const session = sessionRef.current;
    sessionRef.current = null;

    if (!session) {
      if (phase === "ending") finish();
      return undefined;
    }

    void session.close().finally(() => {
      // Only from `ending`. Calling it from `error` would clear the message
      // the user has not read yet.
      if (phase === "ending") finish();
    });

    return undefined;
  }, [phase, finish]);

  /** A backgrounded or unmounted screen must not leave the microphone open. */
  useEffect(() => {
    return () => {
      void sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, []);

  const activity = useCallStore((state) => state.activity);

  /**
   * Which level the orb follows. While the model is talking that is the audio
   * arriving, not the microphone - otherwise the orb would show the echo of
   * the loudspeaker rather than the voice.
   */
  const sample = useMemo(() => {
    if (phase !== "live") return null;

    return async () => {
      const levels = await (sessionRef.current?.readAudioLevels() ??
        Promise.resolve({ mic: 0, remote: 0 }));
      return activity === "speaking" ? levels.remote : levels.mic;
    };
  }, [phase, activity]);

  useLiveAmplitude(sample);

  return visibleLines(transcript);
}
