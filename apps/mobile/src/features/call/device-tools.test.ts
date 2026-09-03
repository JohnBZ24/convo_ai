import { describe, expect, it, vi } from "vitest";
import {
  type DeviceToolDeps,
  runFunctionCall,
  type ToolProxyRequest,
} from "./device-tools";
import type { RealtimeFunctionCall } from "./realtime-events";

const FIXED_NOW = new Date("2026-09-01T12:34:56.000Z");

/** Typed parameters, so `.mock.calls[0]` is a tuple rather than `[]`. */
function proxyMock(result: unknown = { ok: true }) {
  return vi.fn(async (_name: string, _request: ToolProxyRequest) => result);
}

function depsWith(proxy: DeviceToolDeps["proxy"] = proxyMock()): DeviceToolDeps {
  return {
    proxy,
    now: () => FIXED_NOW,
    deviceTimeZone: () => "Asia/Beirut",
  };
}

function call(
  name: string,
  argumentsJson = "{}",
  callId = "call_1",
): RealtimeFunctionCall {
  return { callId, name, argumentsJson };
}

async function output(result: Promise<string>): Promise<Record<string, unknown>> {
  return JSON.parse(await result) as Record<string, unknown>;
}

describe("routing a model function call", () => {
  /**
   * The boundary, from the device's side. `get_current_time` is declared
   * `execution: "device"` precisely because it needs THIS phone's clock, and
   * the server answers 403 if it is ever proxied. Proxying it would make the
   * split a naming convention rather than a boundary.
   */
  it("runs a device tool locally and never proxies it", async () => {
    const proxy = proxyMock();

    const result = await output(
      runFunctionCall(call("get_current_time"), "conv-1", depsWith(proxy)),
    );

    expect(proxy).not.toHaveBeenCalled();
    expect(result.iso).toBe("2026-09-01T12:34:56.000Z");
    expect(result.timeZone).toBe("Asia/Beirut");
    // Spoken, not parsed: this is going to be read aloud.
    expect(result.spoken).toContain("2026");
  });

  it("honours a timezone the model asked for", async () => {
    const result = await output(
      runFunctionCall(
        call("get_current_time", '{"timeZone":"Europe/London"}'),
        null,
        depsWith(),
      ),
    );

    expect(result.timeZone).toBe("Europe/London");
  });

  /** A zone the model invented must not throw inside Intl mid-call. */
  it("falls back to the device zone when the model invents one", async () => {
    const result = await output(
      runFunctionCall(
        call("get_current_time", '{"timeZone":"Middle/Earth"}'),
        null,
        depsWith(),
      ),
    );

    expect(result.timeZone).toBe("Asia/Beirut");
  });

  it("proxies a privileged tool with the model's own call_id", async () => {
    const proxy = proxyMock({ query: "shibuya", matches: [] });

    const result = await output(
      runFunctionCall(
        call("search_conversations", '{"query":"shibuya"}', "call_from_openai"),
        "conv-9",
        depsWith(proxy),
      ),
    );

    expect(proxy).toHaveBeenCalledWith("search_conversations", {
      // The idempotency key on the server is derived from this, so it must be
      // the model's value verbatim and not something we generated.
      callId: "call_from_openai",
      arguments: { query: "shibuya" },
      conversationId: "conv-9",
    });
    expect(result).toEqual({ query: "shibuya", matches: [] });
  });

  /**
   * The non-negotiable rule, asserted from the client side: no request this app
   * makes may carry an identity. A model can be talked into passing any userId;
   * it cannot forge a session.
   */
  it("never sends an identity, even when the model supplies one", async () => {
    const proxy = proxyMock({ matches: [] });

    await runFunctionCall(
      call("search_conversations", '{"query":"x","userId":"someone-else"}'),
      null,
      depsWith(proxy),
    );

    const request = proxy.mock.calls[0]?.[1];
    expect(request).toBeDefined();
    expect(request).not.toHaveProperty("userId");
    // The stray argument is passed through untouched - the server validates and
    // rejects it. This app does not get to decide what a valid argument is.
    expect(request?.conversationId).toBeUndefined();
  });

  it("answers a hallucinated tool with an error the model can read", async () => {
    const result = await output(
      runFunctionCall(call("order_me_a_pizza"), null, depsWith()),
    );

    expect(result.error).toContain("order_me_a_pizza");
  });

  it("answers malformed arguments with an error rather than throwing", async () => {
    const result = await output(
      runFunctionCall(call("search_conversations", "{not json"), null, depsWith()),
    );

    expect(result.error).toContain("valid JSON");
  });

  it("rejects device tool arguments that fail the declared schema", async () => {
    const result = await output(
      runFunctionCall(call("get_current_time", '{"timeZone":42}'), null, depsWith()),
    );

    expect(result.error).toContain("get_current_time");
  });

  /**
   * The model is waiting on this item. Throwing would leave the turn open and
   * the user listening to silence; an error payload lets it say something.
   */
  it("turns a failed proxy call into an error payload", async () => {
    const proxy = vi.fn(async (_name: string, _request: ToolProxyRequest) => {
      throw new Error("Rate limit exceeded");
    });

    const result = await output(
      runFunctionCall(
        call("search_conversations", '{"query":"x"}'),
        null,
        depsWith(proxy),
      ),
    );

    expect(result.error).toBe("Rate limit exceeded");
  });
});
