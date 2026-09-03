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

function depsWith(
  proxy: DeviceToolDeps["proxy"] = proxyMock(),
  overrides: Partial<DeviceToolDeps> = {},
): DeviceToolDeps {
  return {
    proxy,
    now: () => FIXED_NOW,
    deviceTimeZone: () => "Asia/Beirut",
    rememberSearch: vi.fn(),
    showCard: vi.fn(() => true),
    ...overrides,
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

/**
 * The two halves of the card feature meet here: a privileged result is captured
 * on its way past, and a device tool later points at it by id. Neither half is
 * useful without the other, so both are pinned in the same file that owns the
 * routing decision.
 */
describe("the search / card pair", () => {
  it("remembers a web_search result as it passes back to the model", async () => {
    const result = { searchId: "ws_1", query: "beirut", results: [] };
    const rememberSearch = vi.fn();

    const output = await runFunctionCall(
      call("web_search", JSON.stringify({ query: "beirut" })),
      null,
      depsWith(proxyMock(result), { rememberSearch }),
    );

    expect(rememberSearch).toHaveBeenCalledWith(result);
    // Captured on the way past - the model still gets the result verbatim.
    expect(JSON.parse(output)).toEqual(result);
  });

  /**
   * The ordering that makes the whole pair race-free, pinned so a refactor
   * cannot quietly invert it.
   *
   * The model cannot ask to show a search it has not been told about, and it is
   * told by the string this function RESOLVES with. So as long as the memory is
   * written before that resolve, there is no window in which a valid searchId
   * exists that the device cannot look up - regardless of how the two calls are
   * scheduled. Move `rememberSearch` after the return and that guarantee is
   * gone, with nothing else failing to say so.
   */
  it("writes to memory BEFORE the model is told the searchId exists", async () => {
    const order: string[] = [];
    const result = { searchId: "ws_1", query: "beirut", results: [] };

    const output = await runFunctionCall(
      call("web_search", JSON.stringify({ query: "beirut" })),
      null,
      depsWith(
        vi.fn(async (_name: string, _request: ToolProxyRequest) => {
          order.push("search returns");
          return result;
        }),
        { rememberSearch: () => order.push("remembered") },
      ),
    );

    order.push("model told");

    expect(order).toEqual(["search returns", "remembered", "model told"]);
    // And what the model is told is where the id first appears.
    expect(output).toContain("ws_1");
  });

  it("does not remember the result of any other privileged tool", async () => {
    const rememberSearch = vi.fn();

    await runFunctionCall(
      call("search_conversations", JSON.stringify({ query: "x" })),
      null,
      depsWith(proxyMock({ query: "x", matches: [] }), { rememberSearch }),
    );

    expect(rememberSearch).not.toHaveBeenCalled();
  });

  it("shows a card on the device and never proxies it", async () => {
    const proxy = proxyMock();
    const showCard = vi.fn(() => true);

    const output = await runFunctionCall(
      call(
        "show_card",
        JSON.stringify({ searchId: "ws_1", title: "Beirut", subtitle: "30C" }),
      ),
      null,
      depsWith(proxy, { showCard }),
    );

    expect(showCard).toHaveBeenCalledWith({
      searchId: "ws_1",
      title: "Beirut",
      subtitle: "30C",
    });
    expect(JSON.parse(output)).toEqual({ shown: true });
    // The server answers 403 for a device tool. Not reaching it at all is better.
    expect(proxy).not.toHaveBeenCalled();
  });

  /**
   * The model quoting an id from a search that never happened - usually because
   * it tried to show a card without searching first. It gets a sentence it can
   * recover from, not a crash and not an empty card.
   */
  it("tells the model when the id names a search this device never saw", async () => {
    const output = await runFunctionCall(
      call(
        "show_card",
        JSON.stringify({ searchId: "made_up", title: "T", subtitle: "S" }),
      ),
      null,
      depsWith(proxyMock(), { showCard: vi.fn(() => false) }),
    );

    expect(JSON.parse(output).error).toMatch(/Search first/);
  });

  it("rejects card arguments the schema forbids before any of this runs", async () => {
    const showCard = vi.fn(() => true);

    const output = await runFunctionCall(
      call("show_card", JSON.stringify({ searchId: "ws_1", title: "", subtitle: "S" })),
      null,
      depsWith(proxyMock(), { showCard }),
    );

    expect(JSON.parse(output).error).toContain("not valid");
    expect(showCard).not.toHaveBeenCalled();
  });
});
