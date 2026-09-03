import type { RealtimeCredential } from "@convo/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { RealtimeEvent } from "./realtime-events";
import {
  type MinimalDataChannel,
  type MinimalPeerConnection,
  type MinimalStatsReport,
  RealtimeSession,
  type RealtimeSessionDeps,
} from "./realtime-session";

const CREDENTIAL: RealtimeCredential = {
  clientSecret: "ek_test",
  expiresAt: "2026-09-01T12:01:00.000Z",
  expiresInSeconds: 60,
  model: "gpt-realtime-2",
  voice: "marin",
  sessionId: "sess_test",
  callsUrl: "https://api.example.test/v1/realtime/calls",
};

/** Every side effect appends here, so a test can assert on ORDER, not just calls. */
let trace: string[] = [];

class FakeDataChannel implements MinimalDataChannel {
  readyState = "connecting";
  readonly sent: string[] = [];
  private readonly listeners = new Map<
    string,
    ((event: { data?: unknown }) => void)[]
  >();

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    trace.push("channel.close");
    this.readyState = "closed";
  }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(type, [...existing, listener]);
  }

  emit(type: string, event: { data?: unknown } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakePeerConnection implements MinimalPeerConnection {
  iceGatheringState = "complete";
  connectionState = "new";
  localDescription: { sdp: string } | null = null;
  channel: FakeDataChannel | null = null;
  remoteSdp: string | null = null;
  stats: Record<string, unknown>[] = [];
  private readonly listeners = new Map<string, (() => void)[]>();

  addTrack(): void {
    trace.push("peer.addTrack");
  }

  createDataChannel(label: string): MinimalDataChannel {
    trace.push(`peer.createDataChannel:${label}`);
    this.channel = new FakeDataChannel();
    return this.channel;
  }

  async createOffer(): Promise<{ type: string; sdp: string }> {
    trace.push("peer.createOffer");
    return { type: "offer", sdp: "v=0\r\noffer" };
  }

  async setLocalDescription(description: { type: string; sdp: string }): Promise<void> {
    trace.push("peer.setLocalDescription");
    this.localDescription = { sdp: description.sdp };
  }

  async setRemoteDescription(description: {
    type: string;
    sdp: string;
  }): Promise<void> {
    trace.push("peer.setRemoteDescription");
    this.remoteSdp = description.sdp;
  }

  async getStats(): Promise<MinimalStatsReport> {
    const rows = this.stats;
    return {
      forEach(callback) {
        for (const row of rows) callback(row);
      },
    };
  }

  addEventListener(type: string, listener: () => void): void {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(type, [...existing, listener]);
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  close(): void {
    trace.push("peer.close");
    this.connectionState = "closed";
  }
}

interface Harness {
  session: RealtimeSession;
  peer: FakePeerConnection;
  tracks: { stopped: boolean }[];
  events: RealtimeEvent[];
  failures: string[];
  ready: string[];
  deps: RealtimeSessionDeps;
}

function harness(overrides: Partial<RealtimeSessionDeps> = {}): Harness {
  const peer = new FakePeerConnection();
  const tracks = [{ stopped: false }];
  const events: RealtimeEvent[] = [];
  const failures: string[] = [];
  const ready: string[] = [];

  const deps: RealtimeSessionDeps = {
    webrtc: {
      createPeerConnection: () => peer,
      getUserMedia: async () => {
        trace.push("getUserMedia");
        return {
          getTracks: () => tracks.map((t) => ({ stop: () => (t.stopped = true) })),
          getAudioTracks: () => tracks,
        };
      },
    },
    api: {
      createConversation: async () => {
        trace.push("api.createConversation");
        return "conv-1";
      },
      mintCredential: async () => {
        trace.push("api.mintCredential");
        return CREDENTIAL;
      },
      postOffer: async () => {
        trace.push("api.postOffer");
        return "v=0\r\nanswer";
      },
      endConversation: async () => {
        trace.push("api.endConversation");
      },
    },
    audio: {
      begin: () => trace.push("audio.begin"),
      end: () => trace.push("audio.end"),
    },
    requestMicrophone: async () => {
      trace.push("requestMicrophone");
      return true;
    },
    log: () => {},
    iceGatheringTimeoutMs: 10,
    ...overrides,
  };

  const session = new RealtimeSession(deps, {
    onReady: (id) => ready.push(id),
    onEvent: (event) => events.push(event),
    onFailure: (message) => failures.push(message),
  });

  return { session, peer, tracks, events, failures, ready, deps };
}

beforeEach(() => {
  trace = [];
});

describe("opening a call", () => {
  /**
   * THE ordering test.
   *
   * The credential lives about sixty seconds, and the permission dialog, the
   * microphone and ICE gathering are all slower than they look. Minting before
   * them spends the whole budget waiting - so the mint must be the LAST thing
   * before the SDP exchange.
   */
  it("mints only after the offer exists", async () => {
    const { session } = harness();

    await session.open();

    expect(trace).toEqual([
      "requestMicrophone",
      "api.createConversation",
      // Audio focus BEFORE the mic: the mode the microphone is opened in is
      // what decides whether hardware echo cancellation is engaged.
      "audio.begin",
      "getUserMedia",
      "peer.addTrack",
      "peer.createDataChannel:oai-events",
      "peer.createOffer",
      "peer.setLocalDescription",
      "api.mintCredential",
      "api.postOffer",
      "peer.setRemoteDescription",
    ]);
  });

  /**
   * The offer that goes on the wire is `localDescription`, NOT the object
   * `createOffer` returned. Gathering rewrites it with the candidates, and
   * sending the original is how you get a connection that negotiates and then
   * never carries audio.
   */
  it("sends the gathered local description, not the raw offer", async () => {
    const base = harness();
    const sent: string[] = [];

    base.peer.setLocalDescription = async (description) => {
      base.peer.localDescription = { sdp: `${description.sdp}\r\na=candidate:host` };
    };

    const session = new RealtimeSession(
      {
        ...base.deps,
        api: {
          ...base.deps.api,
          postOffer: async (url, secret, sdp) => {
            sent.push(url, secret, sdp);
            return "v=0\r\nanswer";
          },
        },
      },
      { onReady: () => {}, onEvent: () => {}, onFailure: () => {} },
    );

    await session.open();

    expect(sent[0]).toBe(CREDENTIAL.callsUrl);
    expect(sent[1]).toBe(CREDENTIAL.clientSecret);
    expect(sent[2]).toContain("a=candidate:host");
  });

  /**
   * The React-Native-specific trap: `setLocalDescription` resolves before ICE
   * candidates are gathered. An offer with no candidates negotiates happily and
   * then never connects.
   */
  it("waits for ICE gathering, with a ceiling so a slow STUN cannot stall", async () => {
    const { session, peer } = harness();
    peer.iceGatheringState = "gathering";

    const opened = session.open();

    // Never completes: the ceiling is what has to rescue this.
    await expect(opened).resolves.toBeUndefined();
    expect(trace).toContain("api.postOffer");
  });

  it("goes live when the data channel opens, not when the SDP is set", async () => {
    const { session, peer, ready } = harness();

    await session.open();
    expect(ready).toEqual([]);

    peer.channel?.emit("open");
    expect(ready).toEqual(["conv-1"]);
  });

  it("translates data channel frames into domain events", async () => {
    const { session, peer, events } = harness();
    await session.open();

    peer.channel?.emit("message", {
      data: JSON.stringify({
        type: "response.output_audio_transcript.delta",
        item_id: "a",
        delta: "Hi",
      }),
    });

    expect(events).toEqual([
      { type: "output.transcript.delta", itemId: "a", delta: "Hi" },
    ]);
  });

  it("ignores an unreadable frame instead of dropping the call", async () => {
    const { session, peer, events, failures } = harness();
    await session.open();

    peer.channel?.emit("message", { data: "<html>" });

    expect(events).toEqual([]);
    expect(failures).toEqual([]);
  });
});

describe("failing to open", () => {
  it("stops without a conversation when the microphone is refused", async () => {
    const { session, failures } = harness({ requestMicrophone: async () => false });

    await session.open();

    expect(failures).toEqual(["Convo needs the microphone to hear you"]);
    expect(trace).not.toContain("api.createConversation");
    expect(session.conversationId).toBeNull();
  });

  /**
   * The one that costs money and battery if it is wrong: a mint that fails
   * after `getUserMedia` must not leave the microphone open.
   */
  it("releases the microphone when the mint fails", async () => {
    const base = harness();
    const failures: string[] = [];
    const session = new RealtimeSession(
      {
        ...base.deps,
        api: {
          ...base.deps.api,
          mintCredential: async () => {
            throw new Error("Too many sessions this hour");
          },
        },
      },
      {
        onReady: () => {},
        onEvent: () => {},
        onFailure: (message) => failures.push(message),
      },
    );

    await session.open();

    expect(failures).toEqual(["Too many sessions this hour"]);
    expect(base.tracks.every((track) => track.stopped)).toBe(true);
    expect(trace).toContain("peer.close");
    expect(trace).toContain("audio.end");
    // And the conversation is not left `active` forever because of it.
    expect(trace).toContain("api.endConversation");
  });

  it("reports a dropped connection, but not a deliberate hang-up", async () => {
    const { session, peer, failures } = harness();
    await session.open();

    peer.connectionState = "failed";
    peer.emit("connectionstatechange");
    expect(failures).toEqual(["The connection dropped"]);

    await session.close();
    peer.connectionState = "closed";
    peer.emit("connectionstatechange");
    expect(failures).toHaveLength(1);
  });
});

describe("closing a call", () => {
  it("stops the tracks, closes the peer, and marks the conversation ended", async () => {
    const { session, tracks } = harness();
    await session.open();
    trace = [];

    await session.close();

    expect(tracks.every((track) => track.stopped)).toBe(true);
    expect(trace).toEqual([
      "channel.close",
      "peer.close",
      "audio.end",
      "api.endConversation",
    ]);
  });

  it("is safe to call twice", async () => {
    const { session } = harness();
    await session.open();
    await session.close();
    trace = [];

    await session.close();

    expect(trace).toEqual([]);
  });

  /**
   * A UI stuck in `ending` is worse than a conversation the server still thinks
   * is active, so a failed PATCH is logged and swallowed.
   */
  it("does not throw when the conversation cannot be marked ended", async () => {
    const base = harness();
    const session = new RealtimeSession(
      {
        ...base.deps,
        api: {
          ...base.deps.api,
          endConversation: async () => {
            throw new Error("offline");
          },
        },
      },
      { onReady: () => {}, onEvent: () => {}, onFailure: () => {} },
    );

    await session.open();

    await expect(session.close()).resolves.toBeUndefined();
  });

  it("drops nothing on the floor if send is called with no open channel", () => {
    const { session } = harness();
    expect(() => session.send({ type: "response.create" })).not.toThrow();
  });

  it("sends a client event once the channel is open", async () => {
    const { session, peer } = harness();
    await session.open();
    const channel = peer.channel;
    if (!channel) throw new Error("no data channel");
    channel.readyState = "open";

    session.send({ type: "response.create" });

    expect(channel.sent).toEqual(['{"type":"response.create"}']);
  });
});

describe("audio levels", () => {
  it("separates the microphone from the assistant", async () => {
    const { session, peer } = harness();
    await session.open();

    peer.stats = [
      { type: "media-source", kind: "audio", audioLevel: 0.21 },
      { type: "inbound-rtp", kind: "audio", audioLevel: 0.44 },
      { type: "transport", bytesSent: 1024 },
    ];

    await expect(session.readAudioLevels()).resolves.toEqual({
      mic: 0.21,
      remote: 0.44,
    });
  });

  it("reads zero before there is a peer connection", async () => {
    const { session } = harness();

    await expect(session.readAudioLevels()).resolves.toEqual({ mic: 0, remote: 0 });
  });
});
