import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthStore } from "~/features/auth/auth-store";
import { conversationKeys } from "~/features/conversations/use-conversations";
import { isOnline } from "~/features/network/network-store";
import {
  appendTurn,
  createConversation,
  endConversation,
} from "~/lib/api/conversations";
import { mintRealtimeCredential, postRealtimeOffer } from "~/lib/api/realtime";
import { executeTool } from "~/lib/api/tools";
import { useLiveAmplitude } from "./amplitude";
import { beginCallAudio, endCallAudio } from "./audio-route";
import { ReplyLatency } from "./call-metrics";
import { useCallStore } from "./call-store";
import { type DeviceToolDeps, runFunctionCall } from "./device-tools";
import { describeFailure, isWorthRetrying } from "./failure-message";
import type { RealtimeEvent, RealtimeFunctionCall } from "./realtime-events";
import { RealtimeSession, type RealtimeSessionDeps } from "./realtime-session";
import {
  emptyTranscript,
  reduceTranscript,
  type TranscriptLine,
  type TranscriptState,
  visibleLines,
} from "./transcript-assembler";
import { completedTurn, TurnRecorder } from "./turn-recorder";
import {
  createRealtimePeerConnection,
  deviceTimeZone,
  openMicrophone,
  requestMicrophonePermission,
} from "./webrtc-adapter";

/**
 * How long to wait before each reconnect attempt, and how many there are.
 *
 * The first is IMMEDIATE: most drops are already over by the time WebRTC
 * reports `failed`, so the fastest recovery is to try at once. The rest back
 * off, because a network that is genuinely down will still be down in 200ms and
 * a tight loop would only spend battery and credential mints. Four entries, so
 * a call gives up after roughly twelve seconds of failing to come back.
 */
const RECONNECT_DELAYS_MS = [0, 1000, 3000, 8000] as const;

/**
 * One line, and the detail as a JSON STRING rather than an object.
 *
 * `console.log("...", obj)` looks identical in Metro and is unparseable in
 * logcat: Hermes pretty-prints an object across several lines in JavaScript
 * syntax - unquoted keys, single-quoted strings - so a release build emits
 * something that is neither one line nor JSON. `scripts/call-metrics.mjs`
 * reads these, and stringifying here is what makes them machine-readable at
 * the only place they are actually collected.
 *
 * Nothing passed in carries a transcript or a secret; keep it that way.
 */
function logCall(message: string, detail?: Record<string, unknown>): void {
  console.log(
    detail ? `[call] ${message} ${JSON.stringify(detail)}` : `[call] ${message}`,
  );
}

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
  const drop = useCallStore((state) => state.drop);
  const fail = useCallStore((state) => state.fail);
  const token = useAuthStore((state) => state.token);

  const queryClient = useQueryClient();

  const [transcript, setTranscript] = useState<TranscriptState>(emptyTranscript);

  const sessionRef = useRef<RealtimeSession | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  /**
   * The assembler's state, held OUTSIDE React as well as in it.
   *
   * `completedTurn` needs the state after the event has been reduced, and a
   * `setState` updater is the wrong place to ask for it: updaters have to be
   * pure and React may run one twice. Reducing here and pushing the result into
   * state keeps the updater trivial and gives the recorder the value it needs.
   */
  const transcriptRef = useRef<TranscriptState>(emptyTranscript);

  /** Posts completed turns. Built once the conversation id is known. */
  const recorderRef = useRef<TurnRecorder | null>(null);

  /**
   * How long the model takes to start answering after server VAD decides the
   * user has stopped. The second number in iteration 7's table, and the one a
   * person actually feels in conversation.
   */
  const latencyRef = useRef(new ReplyLatency());

  /**
   * Consecutive failed reconnects for THIS call. Reset when the connection
   * genuinely comes back, so a long call over a flaky network keeps recovering,
   * but a connection that cannot be re-established gives up instead of looping.
   */
  const reconnectsRef = useRef(0);

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
      const next = reduceTranscript(transcriptRef.current, event);
      if (next !== transcriptRef.current) {
        transcriptRef.current = next;
        setTranscript(next);
      }

      /**
       * Where the transcript stops being ephemeral. A line that has just
       * finished gets its seq from its POSITION in `next` and goes to the
       * server; everything else about the call is unchanged.
       *
       * Not awaited: the recorder has its own queue and its own retries, and a
       * live call must not wait on the network to carry on listening.
       */
      const turn = completedTurn(next, event);
      if (turn) void recorderRef.current?.record(turn);

      switch (event.type) {
        case "speech.started":
          /**
           * Also the BARGE-IN signal. `interrupt_response: true` is set on the
           * session, so the model's reply is cancelled server-side; all this
           * side has to do is stop claiming it is speaking, and forget any
           * pending latency measurement - the reply that was being timed is
           * never going to arrive.
           */
          latencyRef.current.reset();
          setActivity("listening");
          break;

        case "speech.stopped":
          latencyRef.current.speechStopped();
          setActivity("thinking");
          break;

        case "response.created":
          setActivity("thinking");
          break;

        /**
         * With WebRTC the audio itself never crosses the data channel, so the
         * first transcript delta is the earliest honest signal that the model
         * has started speaking.
         */
        case "output.transcript.delta": {
          // Only the FIRST delta of a reply returns a number; the rest find
          // nothing pending, which is exactly what makes this the start time.
          const latencyMs = latencyRef.current.replyStarted();
          if (latencyMs !== null) logCall("reply latency", { latencyMs });
          setActivity("speaking");
          break;
        }

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

  /**
   * The data channel is open, so the call is live AND the conversation id is
   * known - which is the earliest moment a turn could be posted, and therefore
   * the right moment to build the thing that posts them.
   *
   * The token is read per request rather than captured here, for the same
   * reason as everywhere else in this file: a refresh mid-call must not leave
   * the recorder holding a stale one.
   */
  const onReady = useCallback(
    (conversationId: string) => {
      recorderRef.current = new TurnRecorder({
        post: (turn) => {
          const bearer = tokenRef.current;
          if (!bearer) throw new Error("Not signed in");
          return appendTurn(bearer, conversationId, turn);
        },
        log: (message, detail) => {
          console.log(`[call] ${message}`, detail ?? "");
        },
      });

      /**
       * The connection is genuinely back, so the budget resets. A call that
       * survives four separate Wi-Fi blips over half an hour is recovering, not
       * failing - only CONSECUTIVE failures should give up.
       */
      reconnectsRef.current = 0;

      markReady(conversationId);
    },
    [markReady],
  );

  /**
   * A dropped connection, and what to do about it.
   *
   * Spaced out rather than hammered: the usual cause is a phone moving between
   * Wi-Fi cells or a laptop that slept for a second, and the first retry is
   * immediate because most drops are already over by the time we hear about
   * them. After that it backs off, because a network that is still down will
   * still be down 200ms later.
   */
  const onDroppedRef = useRef<() => void>(() => undefined);

  const onDropped = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;

    const attempt = reconnectsRef.current;
    const delay = RECONNECT_DELAYS_MS[attempt];

    if (delay === undefined) {
      fail("The connection dropped and could not be restored");
      return;
    }

    reconnectsRef.current = attempt + 1;
    // No-op after the first attempt: the phase is already `reconnecting`.
    drop();

    setTimeout(() => {
      // The user hung up while we were waiting, or a new call started.
      if (sessionRef.current !== session) return;

      void session.reconnect().catch((error) => {
        if (sessionRef.current !== session) return;

        /**
         * A refused credential or a signed-out session fails identically every
         * time; retrying it just spends the user's patience before showing the
         * same message.
         */
        if (isWorthRetrying(error)) onDroppedRef.current();
        else fail(describeFailure(error));
      });
    }, delay);
  }, [drop, fail]);

  onDroppedRef.current = onDropped;

  /** Opens a call. Depends on `phase` only - see the note at the top. */
  useEffect(() => {
    if (phase !== "connecting") return undefined;

    /**
     * Fail FAST when the device knows it is offline.
     *
     * Without this the call sits on the orb for the client's full 10s timeout
     * and then reports "The server is not responding", which sends the user
     * looking at the laptop when the problem is the phone's own Wi-Fi. The
     * store starts optimistic, so this only fires once `expo-network` has
     * actually said otherwise.
     */
    if (!isOnline()) {
      fail("No connection. Check Wi-Fi and try again");
      return undefined;
    }

    transcriptRef.current = emptyTranscript;
    setTranscript(emptyTranscript);
    answered.current = new Set();
    latencyRef.current = new ReplyLatency();
    reconnectsRef.current = 0;

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
      log: logCall,
    };

    const session = new RealtimeSession(deps, {
      onReady,
      onEvent: (event) => onEventRef.current(event),
      onDropped: () => onDroppedRef.current(),
      onFailure: fail,
    });

    sessionRef.current = session;
    void session.open();

    return undefined;
  }, [phase, onReady, fail]);

  /**
   * The last turn of a call finishes at almost the same moment the user taps to
   * hang up, so its POST is usually still in flight here. Let the recorder
   * drain, then refresh the sidebar - the list is worth refetching only once
   * the turn that names the conversation has actually landed.
   *
   * Deliberately NOT awaited before `finish()`: a phone on a bad signal can
   * spend seconds inside the recorder's backoff, and the UI must not sit on
   * "Ending" for that.
   */
  const settleAndRefresh = useCallback(() => {
    /**
     * One line per call with the reply latencies, so `scripts/call-metrics.mjs`
     * can fill in the table without anyone timing a stopwatch against a phone.
     */
    const latencies = latencyRef.current.all();
    if (latencies.length > 0) {
      /**
       * Deliberately does NOT repeat the individual samples: each was already
       * logged as it happened, and a summary that re-lists them makes any
       * reader that consumes both count every reply twice. This line is a
       * human's quick read of the call; the per-reply lines are the data.
       */
      logCall("reply latency summary", {
        samples: latencies.length,
        medianMs: latencyRef.current.median(),
      });
    }

    const recorder = recorderRef.current;
    recorderRef.current = null;

    void (recorder?.drain() ?? Promise.resolve()).finally(() => {
      void queryClient.invalidateQueries({ queryKey: conversationKeys.lists() });
    });
  }, [queryClient]);

  /** Closes it. `ending` is the user hanging up; `error` is everything else. */
  useEffect(() => {
    if (phase !== "ending" && phase !== "error") return undefined;

    const session = sessionRef.current;
    sessionRef.current = null;

    if (!session) {
      if (phase === "ending") finish();
      settleAndRefresh();
      return undefined;
    }

    void session.close().finally(() => {
      // Only from `ending`. Calling it from `error` would clear the message
      // the user has not read yet.
      if (phase === "ending") finish();
      settleAndRefresh();
    });

    return undefined;
  }, [phase, finish, settleAndRefresh]);

  /** A backgrounded or unmounted screen must not leave the microphone open. */
  useEffect(() => {
    return () => {
      void sessionRef.current?.close();
      sessionRef.current = null;
      // The recorder's queue keeps running on its own; only this handle goes.
      recorderRef.current = null;
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
