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
