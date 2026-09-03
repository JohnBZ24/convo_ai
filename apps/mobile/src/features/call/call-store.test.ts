import { beforeEach, describe, expect, it } from "vitest";
import { isCallActive, useCallStore } from "./call-store";

const initial = useCallStore.getState();

beforeEach(() => {
  useCallStore.setState({
    ...initial,
    phase: "idle",
    activity: "listening",
    error: null,
    conversationId: null,
    reconnectCount: 0,
  });
});

describe("the call machine", () => {
  it("goes idle -> connecting -> live -> ending -> idle", () => {
    const { start, markReady, stop, finish } = useCallStore.getState();

    start();
    expect(useCallStore.getState().phase).toBe("connecting");

    markReady("conv-1");
    expect(useCallStore.getState().phase).toBe("live");
    expect(useCallStore.getState().conversationId).toBe("conv-1");

    stop();
    expect(useCallStore.getState().phase).toBe("ending");

    finish();
    expect(useCallStore.getState().phase).toBe("idle");
  });

  /**
   * The one that matters on a real device: a double-tap must not open two
   * sessions. On iteration 5 that would be two WebRTC connections and two bills.
   */
  it("ignores a second start while connecting", () => {
    const { start } = useCallStore.getState();

    start();
    start();

    expect(useCallStore.getState().phase).toBe("connecting");
  });

  it("ignores markReady unless connecting", () => {
    useCallStore.getState().markReady("conv-1");

    expect(useCallStore.getState().phase).toBe("idle");
    expect(useCallStore.getState().conversationId).toBeNull();
  });

  it("ignores stop unless live", () => {
    useCallStore.getState().start();
    useCallStore.getState().stop();

    expect(useCallStore.getState().phase).toBe("connecting");
  });

  it("only tracks activity while live", () => {
    const { start, setActivity, markReady } = useCallStore.getState();

    start();
    setActivity("speaking");
    expect(useCallStore.getState().activity).toBe("thinking");

    markReady("conv-1");
    setActivity("speaking");
    expect(useCallStore.getState().activity).toBe("speaking");
  });

  it("can fail from any phase, and a failed call can be restarted", () => {
    const { start, markReady, fail } = useCallStore.getState();

    start();
    markReady("conv-1");
    fail("The connection dropped");

    expect(useCallStore.getState().phase).toBe("error");
    expect(useCallStore.getState().error).toBe("The connection dropped");

    useCallStore.getState().start();
    expect(useCallStore.getState().phase).toBe("connecting");
    expect(useCallStore.getState().error).toBeNull();
  });

  it("treats connecting, live and ending as active", () => {
    expect(isCallActive("connecting")).toBe(true);
    expect(isCallActive("live")).toBe(true);
    expect(isCallActive("ending")).toBe(true);
    expect(isCallActive("idle")).toBe(false);
    expect(isCallActive("error")).toBe(false);
  });
});

describe("recovering a dropped call", () => {
  function goLive() {
    const { start, markReady } = useCallStore.getState();
    start();
    markReady("conv-1");
  }

  /**
   * The transcript on screen belongs to this conversation, and the recovered
   * call records into the same one - so losing the id here would orphan every
   * turn posted after the reconnect.
   */
  it("keeps the conversation while reconnecting", () => {
    goLive();

    useCallStore.getState().drop();

    expect(useCallStore.getState().phase).toBe("reconnecting");
    expect(useCallStore.getState().conversationId).toBe("conv-1");
  });

  it("goes back to live when the connection returns", () => {
    goLive();
    useCallStore.getState().drop();

    useCallStore.getState().markReady("conv-1");

    expect(useCallStore.getState().phase).toBe("live");
    expect(useCallStore.getState().activity).toBe("listening");
  });

  /** Hanging up has to work even while the call is trying to come back. */
  it("can be hung up mid-reconnect", () => {
    goLive();
    useCallStore.getState().drop();

    useCallStore.getState().stop();

    expect(useCallStore.getState().phase).toBe("ending");
  });

  /**
   * A drop during `connecting` has nothing to recover TO, and one during
   * `ending` is just the teardown doing its job - reporting either as a
   * reconnect would show the user a call coming back that is already gone.
   */
  it.each(["connecting", "ending", "idle", "error"] as const)(
    "ignores a drop while %s",
    (phase) => {
      useCallStore.setState({ phase });

      useCallStore.getState().drop();

      expect(useCallStore.getState().phase).toBe(phase);
    },
  );

  it("counts the recoveries, so a flapping network is visible in the log", () => {
    goLive();

    useCallStore.getState().drop();
    useCallStore.getState().markReady("conv-1");
    useCallStore.getState().drop();

    expect(useCallStore.getState().reconnectCount).toBe(2);
  });

  it("starts a new call with a clean budget", () => {
    goLive();
    useCallStore.getState().drop();
    useCallStore.getState().stop();
    useCallStore.getState().finish();

    useCallStore.getState().start();

    expect(useCallStore.getState().reconnectCount).toBe(0);
  });

  it("keeps the orb engaged while reconnecting", () => {
    expect(isCallActive("reconnecting")).toBe(true);
  });
});
