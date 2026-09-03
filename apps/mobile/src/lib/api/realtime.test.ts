import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "./client";
import { mintRealtimeCredential, postRealtimeOffer } from "./realtime";

const CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const ANSWER = "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n";

/** Typed parameters, so `.mock.calls[0]` is a tuple rather than `[]`. */
function respond(body: string, status = 200) {
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) => new Response(body, { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function firstCall(mock: {
  mock: { calls: [string, RequestInit][] };
}): [string, RequestInit] {
  const call = mock.mock.calls[0];
  if (!call) throw new Error("fetch was never called");
  return call;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function failureOf(promise: Promise<unknown>): Promise<ApiRequestError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiRequestError) return error;
    throw error;
  }
  throw new Error("expected the request to fail, but it resolved");
}

describe("the SDP exchange", () => {
  /**
   * The one request in this app that does not go to our own API. It carries the
   * ephemeral `ek_...`, never the user's session token, and trades
   * `application/sdp` rather than JSON in either direction.
   */
  it("posts the offer to the URL the server named, with the ephemeral key", async () => {
    const fetchMock = respond(ANSWER);

    await postRealtimeOffer(CALLS_URL, "ek_live", "v=0\r\noffer");

    const [url, init] = firstCall(fetchMock);
    expect(url).toBe(CALLS_URL);
    expect(init.method).toBe("POST");
    expect(init.body).toBe("v=0\r\noffer");
    expect(init.headers).toEqual({
      authorization: "Bearer ek_live",
      "content-type": "application/sdp",
    });
  });

  it("returns the answer SDP as text", async () => {
    respond(ANSWER);

    await expect(postRealtimeOffer(CALLS_URL, "ek_live", "v=0")).resolves.toBe(ANSWER);
  });

  it("surfaces a rejection without leaking the upstream body to the user", async () => {
    respond('{"error":{"message":"Your session token has expired"}}', 401);

    const error = await failureOf(postRealtimeOffer(CALLS_URL, "ek_dead", "v=0"));

    expect(error.status).toBe(401);
    expect(error.code).toBe("REALTIME_SDP_REJECTED");
  });

  /**
   * A 200 that is not SDP would otherwise reach `setRemoteDescription` and fail
   * somewhere far less legible - typically as a native crash.
   */
  it("rejects a 200 that is not an SDP answer", async () => {
    respond("<html>Proxy interception</html>");

    const error = await failureOf(postRealtimeOffer(CALLS_URL, "ek_live", "v=0"));

    expect(error.code).toBe("REALTIME_SDP_MALFORMED");
  });
});

describe("minting", () => {
  it("names the conversation so the audit row points somewhere", async () => {
    const fetchMock = respond(
      JSON.stringify({ clientSecret: "ek_1", callsUrl: CALLS_URL }),
      201,
    );

    await mintRealtimeCredential("session-token", "conv-1");

    const [url, init] = firstCall(fetchMock);
    expect(url).toContain("/api/realtime/token");
    expect(init.body).toBe(JSON.stringify({ conversationId: "conv-1" }));
    // Our token, not the ephemeral one: this half of the flow is our API.
    expect(init.headers).toMatchObject({ authorization: "Bearer session-token" });
  });
});
