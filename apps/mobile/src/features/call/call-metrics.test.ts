import { describe, expect, it } from "vitest";
import { CallTimeline, ReplyLatency } from "./call-metrics";

/** A clock that only moves when a test says so. */
function fakeClock(start = 1000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("timing a connect", () => {
  it("measures the headline the user actually feels", () => {
    const clock = fakeClock();
    const timeline = new CallTimeline(clock.now);

    timeline.mark("tap");
    clock.advance(4200);
    timeline.mark("remoteAudio");

    expect(timeline.timings().tapToRemoteAudio).toBe(4200);
  });

  /**
   * The reason the breakdown exists. "Tap to first audio was 4.2s" is not
   * actionable; "of which 2.0s was ICE gathering" says where to look.
   */
  it("attributes the time to the step that spent it", () => {
    const clock = fakeClock();
    const timeline = new CallTimeline(clock.now);

    timeline.mark("tap");
    clock.advance(30);
    timeline.mark("permission");
    clock.advance(120);
    timeline.mark("conversation");
    timeline.mark("audioMode");
    clock.advance(250);
    timeline.mark("microphone");
    clock.advance(60);
    timeline.mark("offer");
    clock.advance(2000);
    timeline.mark("iceComplete");
    clock.advance(300);
    timeline.mark("credential");
    clock.advance(400);
    timeline.mark("answer");

    expect(timeline.timings()).toMatchObject({
      permissionMs: 30,
      conversationMs: 120,
      microphoneMs: 250,
      offerMs: 60,
      iceGatheringMs: 2000,
      credentialMs: 300,
      sdpExchangeMs: 400,
    });
  });

  it("is null about steps that never happened, rather than reporting zero", () => {
    const clock = fakeClock();
    const timeline = new CallTimeline(clock.now);

    timeline.mark("tap");

    expect(timeline.timings().tapToRemoteAudio).toBeNull();
    expect(timeline.timings().iceGatheringMs).toBeNull();
  });

  /**
   * A connect that failed at the mint should log the steps it DID complete -
   * seeing how far it got is the entire point of logging a failed connect.
   */
  it("logs only what it measured", () => {
    const clock = fakeClock();
    const timeline = new CallTimeline(clock.now);

    timeline.mark("tap");
    clock.advance(40);
    timeline.mark("permission");

    expect(timeline.recorded()).toEqual({ permissionMs: 40 });
  });

  it("keeps the first time a mark was reached", () => {
    const clock = fakeClock();
    const timeline = new CallTimeline(clock.now);

    timeline.mark("tap");
    clock.advance(100);
    timeline.mark("tap");
    clock.advance(50);
    timeline.mark("live");

    expect(timeline.timings().tapToLive).toBe(150);
  });
});

describe("timing a reply", () => {
  it("measures from the end of speech to the model answering", () => {
    const clock = fakeClock();
    const latency = new ReplyLatency(clock.now);

    latency.speechStopped();
    clock.advance(620);

    expect(latency.replyStarted()).toBe(620);
  });

  /** Only the FIRST delta starts a reply; the rest are the same reply. */
  it("returns null for every delta after the first", () => {
    const clock = fakeClock();
    const latency = new ReplyLatency(clock.now);

    latency.speechStopped();
    clock.advance(500);

    expect(latency.replyStarted()).toBe(500);
    expect(latency.replyStarted()).toBeNull();
  });

  it("returns null for a reply nobody asked for", () => {
    const latency = new ReplyLatency(fakeClock().now);

    expect(latency.replyStarted()).toBeNull();
  });

  /**
   * Barge-in. The user talks over the model, the reply is cancelled, and the
   * measurement in flight is void. Without the reset, the NEXT reply would be
   * reported as having taken however long the interruption lasted.
   */
  it("forgets a pending measurement when the user interrupts", () => {
    const clock = fakeClock();
    const latency = new ReplyLatency(clock.now);

    latency.speechStopped();
    clock.advance(9000);
    latency.reset();

    expect(latency.replyStarted()).toBeNull();
  });

  it("collects every sample for the summary line", () => {
    const clock = fakeClock();
    const latency = new ReplyLatency(clock.now);

    for (const ms of [400, 800, 600]) {
      latency.speechStopped();
      clock.advance(ms);
      latency.replyStarted();
    }

    expect(latency.all()).toEqual([400, 800, 600]);
  });

  /** Median, not mean: one slow first reply should not colour the whole call. */
  it("reports a median", () => {
    const clock = fakeClock();
    const latency = new ReplyLatency(clock.now);

    for (const ms of [400, 800, 600]) {
      latency.speechStopped();
      clock.advance(ms);
      latency.replyStarted();
    }

    expect(latency.median()).toBe(600);
  });

  it("averages the middle pair when there is an even number", () => {
    const clock = fakeClock();
    const latency = new ReplyLatency(clock.now);

    for (const ms of [400, 500, 700, 800]) {
      latency.speechStopped();
      clock.advance(ms);
      latency.replyStarted();
    }

    expect(latency.median()).toBe(600);
  });

  it("has no median before anything was measured", () => {
    expect(new ReplyLatency().median()).toBeNull();
  });
});
