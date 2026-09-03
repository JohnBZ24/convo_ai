import type { RealtimeCredential } from "@convo/shared";
import { CallTimeline } from "./call-metrics";
import { describeFailure } from "./failure-message";
import { type RealtimeEvent, toRealtimeEvent } from "./realtime-events";

/**
 * The transport: one voice call, from tap to teardown.
 *
 * No React, no Zustand, and - deliberately - no `react-native-webrtc`. Every
 * boundary arrives through `deps`, for the same reason the server's use cases
 * take ports: the ORDER of these steps is the load-bearing part and it has to
 * be testable without a phone. There is also a hard practical reason -
 * importing `react-native-webrtc` here would drag React Native's Flow-typed
 * entry point into vitest, which no test runner can parse. Same trap as
 * `expo-constants`.
 */

/** The slice of `RTCPeerConnection` this app uses. */
export interface MinimalPeerConnection {
  readonly iceGatheringState: string;
  readonly connectionState: string;
  readonly localDescription: { sdp: string } | null;
  addTrack(track: unknown, stream: unknown): void;
  createDataChannel(label: string): MinimalDataChannel;
  createOffer(): Promise<{ type: string; sdp: string }>;
  setLocalDescription(description: { type: string; sdp: string }): Promise<void>;
  setRemoteDescription(description: { type: string; sdp: string }): Promise<void>;
  getStats(): Promise<MinimalStatsReport>;
  addEventListener(type: string, listener: () => void): void;
  close(): void;
}

export interface MinimalDataChannel {
  readonly readyState: string;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
}

export interface MinimalStatsReport {
  forEach(callback: (stat: Record<string, unknown>) => void): void;
}

export interface MinimalMediaStream {
  getTracks(): { stop(): void }[];
  getAudioTracks(): unknown[];
}

export interface RealtimeSessionDeps {
  webrtc: {
    createPeerConnection: () => MinimalPeerConnection;
    getUserMedia: () => Promise<MinimalMediaStream>;
  };
  api: {
    createConversation: () => Promise<string>;
    mintCredential: (conversationId: string) => Promise<RealtimeCredential>;
    postOffer: (callsUrl: string, clientSecret: string, sdp: string) => Promise<string>;
    endConversation: (conversationId: string) => Promise<void>;
  };
  /** Audio focus and speaker routing. Started BEFORE the mic is opened. */
  audio: { begin: () => void; end: () => void };
  requestMicrophone: () => Promise<boolean>;
  log: (message: string, detail?: Record<string, unknown>) => void;
  /** Ceiling on the ICE gathering wait. See `open()`. */
  iceGatheringTimeoutMs?: number;
  /** Injected so the connect timings can be asserted without a real clock. */
  now?: () => number;
}

export interface RealtimeSessionHandlers {
  /** The data channel is open: the call is live. */
  onReady: (conversationId: string) => void;
  onEvent: (event: RealtimeEvent) => void;
  /**
   * The connection died mid-call and MIGHT come back.
   *
   * Separate from `onFailure` because the two want different responses: a drop
   * is a phone that changed Wi-Fi cell and should be recovered silently, while
   * a failure is something the user has to be told about. Collapsing them - as
   * iteration 5 did - turns every momentary network blip into an error screen
   * and a conversation the user has to restart.
   */
  onDropped: () => void;
  onFailure: (message: string) => void;
}

const DATA_CHANNEL_LABEL = "oai-events";
const DEFAULT_ICE_GATHERING_TIMEOUT_MS = 2000;

export class RealtimeSession {
  private peer: MinimalPeerConnection | null = null;
  private channel: MinimalDataChannel | null = null;
  private stream: MinimalMediaStream | null = null;
  private conversation: string | null = null;
  private closed = false;
  /** So a teardown that runs twice does not stop audio focus it never took. */
  private audioActive = false;
  /** Guards against a drop reported twice for the same peer connection. */
  private dropReported = false;

  /**
   * Timings for the CURRENT connect. A reconnect gets a fresh one, so a
   * recovered call cannot rewrite the numbers of the connect before it.
   */
  private timeline: CallTimeline;

  constructor(
    private readonly deps: RealtimeSessionDeps,
    private readonly handlers: RealtimeSessionHandlers,
  ) {
    this.timeline = new CallTimeline(deps.now);
  }

  get conversationId(): string | null {
    return this.conversation;
  }

  /** The connect timings, for the metrics log line and for tests. */
  get timings() {
    return this.timeline.timings();
  }

  /**
   * The connect sequence. The order is not arbitrary.
   *
   * The minted credential lives about a minute, so EVERYTHING SLOW HAPPENS
   * FIRST: the permission dialog, the microphone, the offer. The mint is the
   * last thing before the SDP exchange, and the credential is dead sixty
   * seconds later - by which time the connection it opened has outlived it.
   */
  async open(): Promise<void> {
    this.timeline.mark("tap");

    try {
      const granted = await this.deps.requestMicrophone();
      if (!granted) {
        this.handlers.onFailure("Convo needs the microphone to hear you");
        return;
      }
      this.timeline.mark("permission");
      if (this.abandoned()) return;

      this.conversation = await this.deps.api.createConversation();
      this.timeline.mark("conversation");
      if (this.abandoned()) return;

      /**
       * Before `getUserMedia`, not after. This is what puts Android in
       * MODE_IN_COMMUNICATION, and the mode the microphone is OPENED in is
       * what decides whether hardware echo cancellation is engaged - which is
       * the entire reason this app uses WebRTC rather than a WebSocket.
       */
      this.deps.audio.begin();
      this.audioActive = true;
      this.timeline.mark("audioMode");

      this.stream = await this.deps.webrtc.getUserMedia();
      this.timeline.mark("microphone");
      if (this.abandoned()) return;

      await this.negotiate();
    } catch (error) {
      /**
       * `close()`, not just a media release: a conversation was very likely
       * already created, and leaving it `active` forever because the mint was
       * rate limited would be a row nothing ever tidies up.
       */
      await this.close();
      this.handlers.onFailure(describeFailure(error));
    }
  }

  /**
   * Rebuild the peer connection for a call that dropped.
   *
   * Deliberately does NOT redo the slow half: the permission is granted, the
   * conversation exists, `MODE_IN_COMMUNICATION` is still set and the
   * microphone is still open. Reopening the mic would be the worst thing to do
   * here - the audio mode it is opened in decides whether hardware echo
   * cancellation is engaged, and tearing that down mid-call risks coming back
   * without it.
   *
   * Throws on failure rather than reporting it, so the caller can decide
   * whether to try again or give up. See `use-call-session`.
   */
  async reconnect(): Promise<void> {
    if (this.closed) return;
    if (!this.conversation || !this.stream) {
      throw new Error("Nothing to reconnect to");
    }

    this.deps.log("reconnecting the call", { conversationId: this.conversation });

    // A fresh timeline: this connect's numbers are its own.
    this.timeline = new CallTimeline(this.deps.now);
    this.timeline.mark("tap");
    this.timeline.mark("permission");
    this.timeline.mark("conversation");
    this.timeline.mark("audioMode");
    this.timeline.mark("microphone");

    this.discardPeer();
    await this.negotiate();
  }

  /**
   * Peer connection, offer, credential, answer.
   *
   * Split out of `open()` so `reconnect()` can run exactly this half again
   * against the microphone that is already open.
   */
  private async negotiate(): Promise<void> {
    const stream = this.stream;
    const conversation = this.conversation;
    if (!stream || !conversation) throw new Error("Nothing to negotiate with");

    const peer = this.deps.webrtc.createPeerConnection();
    this.peer = peer;
    this.dropReported = false;

    for (const track of stream.getAudioTracks()) {
      peer.addTrack(track, stream);
    }

    const channel = peer.createDataChannel(DATA_CHANNEL_LABEL);
    this.channel = channel;
    this.wireChannel(channel);
    this.wireConnectionState(peer);
    this.wireRemoteTrack(peer);

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    this.timeline.mark("offer");
    if (this.abandoned()) return;

    /**
     * The browser-versus-React-Native trap.
     *
     * Every published OpenAI sample POSTs the SDP straight after
     * `setLocalDescription`. In a browser that is fine. Here the promise
     * resolves before ICE candidates are gathered, and an offer with no
     * candidates negotiates happily and then never connects - which presents
     * as a call that reaches `live` and stays silent.
     */
    await this.waitForIceGathering(peer);
    this.timeline.mark("iceComplete");
    if (this.abandoned()) return;

    const localSdp = peer.localDescription?.sdp ?? offer.sdp;

    // ---- the credential's clock starts here ----
    const credential = await this.deps.api.mintCredential(conversation);
    this.timeline.mark("credential");
    if (this.abandoned()) return;

    this.deps.log("realtime credential minted", {
      sessionId: credential.sessionId,
      model: credential.model,
      expiresInSeconds: credential.expiresInSeconds,
    });

    const answerSdp = await this.deps.api.postOffer(
      credential.callsUrl,
      credential.clientSecret,
      localSdp,
    );
    if (this.abandoned()) return;

    await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
    this.timeline.mark("answer");
  }

  /** Safe to call twice, and safe to call while `open()` is still running. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    const conversationId = this.conversation;
    this.releaseMedia();

    if (!conversationId) return;

    try {
      await this.deps.api.endConversation(conversationId);
    } catch (error) {
      /**
       * Logged, not raised. A conversation the server still thinks is active
       * is a tidiness problem; a UI stuck in `ending` is a broken app.
       */
      this.deps.log("could not mark the conversation ended", {
        error: describeFailure(error),
      });
    }
  }

  /** A client event on the data channel. Silently dropped if it is not open. */
  send(payload: unknown): void {
    const channel = this.channel;
    if (channel?.readyState !== "open") return;
    channel.send(JSON.stringify(payload));
  }

  /**
   * Mic and assistant levels, 0..1 linear, straight off the RTP stats.
   *
   * `media-source` is what this device is sending; `inbound-rtp` is what it is
   * receiving. There is no Web Audio API in React Native, so this is the only
   * honest source of a level - and it is the real signal rather than an
   * envelope shaped to look like one.
   */
  async readAudioLevels(): Promise<{ mic: number; remote: number }> {
    const peer = this.peer;
    if (!peer) return { mic: 0, remote: 0 };

    let mic = 0;
    let remote = 0;

    const report = await peer.getStats();
    report.forEach((stat) => {
      const level = stat.audioLevel;
      if (typeof level !== "number") return;

      if (stat.type === "media-source") mic = Math.max(mic, level);
      if (stat.type === "inbound-rtp") remote = Math.max(remote, level);
    });

    return { mic, remote };
  }

  private wireChannel(channel: MinimalDataChannel): void {
    channel.addEventListener("open", () => {
      const conversationId = this.conversation;
      if (this.closed || !conversationId) return;

      this.timeline.mark("live");
      // One line per connect, with the whole breakdown. This is what
      // `scripts/call-metrics.mjs` reads out of logcat.
      this.deps.log("call connected", this.timeline.recorded());

      this.handlers.onReady(conversationId);
    });

    channel.addEventListener("message", (event) => {
      if (this.closed) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        this.deps.log("unreadable data channel frame");
        return;
      }

      this.handlers.onEvent(toRealtimeEvent(parsed));
    });
  }

  /**
   * `ontrack` is the first remote audio, and therefore the honest end of
   * "tap to first audio out" - the number in the design's table. Nothing else
   * needs the event; the audio plays itself.
   */
  private wireRemoteTrack(peer: MinimalPeerConnection): void {
    peer.addEventListener("track", () => {
      if (this.closed) return;
      this.timeline.mark("remoteAudio");
    });
  }

  private wireConnectionState(peer: MinimalPeerConnection): void {
    peer.addEventListener("connectionstatechange", () => {
      // A deliberate hang-up also moves through `closed`. Only report a drop.
      if (this.closed || this.dropReported) return;
      if (peer !== this.peer) return;

      /**
       * `failed` only, not `disconnected`. WebRTC reports `disconnected` for
       * any gap in connectivity and recovers from most of them on its own
       * within a few seconds; tearing the peer down and renegotiating on the
       * first one would turn a hiccup into a visible reconnect.
       */
      if (peer.connectionState === "failed") {
        this.dropReported = true;
        this.deps.log("the connection dropped");
        this.handlers.onDropped();
      }
    });
  }

  private waitForIceGathering(peer: MinimalPeerConnection): Promise<void> {
    if (peer.iceGatheringState === "complete") return Promise.resolve();

    const ceiling = this.deps.iceGatheringTimeoutMs ?? DEFAULT_ICE_GATHERING_TIMEOUT_MS;

    return new Promise<void>((resolve) => {
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };

      // A ceiling, not a deadline: host candidates are usually enough, so a
      // slow STUN round trip must not hold the call open past the credential.
      const timer = setTimeout(finish, ceiling);

      peer.addEventListener("icegatheringstatechange", () => {
        if (peer.iceGatheringState === "complete") finish();
      });
    });
  }

  /** True once `close()` has run. Checked after every await in `open()`. */
  private abandoned(): boolean {
    if (!this.closed) return false;
    this.releaseMedia();
    return true;
  }

  /**
   * Throw away the peer connection and data channel, KEEPING the microphone,
   * the audio mode and the conversation. This is the half of a teardown that a
   * reconnect needs; `releaseMedia` is the whole thing.
   */
  private discardPeer(): void {
    this.channel?.close();
    this.channel = null;

    this.peer?.close();
    this.peer = null;
  }

  private releaseMedia(): void {
    // Tracks first: this is what turns off the microphone indicator.
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    this.stream = null;

    this.discardPeer();

    if (this.audioActive) {
      this.audioActive = false;
      this.deps.audio.end();
    }
  }
}
