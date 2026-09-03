import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiRealtimeMinter } from "~/infrastructure/realtime/openai-realtime.minter";

/**
 * `fetch` is stubbed rather than called, so this suite asserts on the request
 * that WOULD go to OpenAI and on how each failure shape is translated - with no
 * network, no API key and no spend.
 *
 * The success shape below is a real response captured from the live API on
 * 25 Aug 2026, trimmed to the fields this class reads.
 */

const OPTIONS = {
  apiKey: "sk-test-key",
  baseUrl: "https://api.example.test/v1",
  ttlSeconds: 60,
  requestTimeoutMs: 5000,
};

/**
 * The VALUES are synthetic - a real credential, even a long-expired one, does
 * not belong in a repository. The SHAPE is what was captured live.
 */
const LIVE_SHAPED_RESPONSE = {
  value: "ek_000000000000000000000000000000",
  expires_at: 1787655645,
  session: {
    id: "sess_0000000000000000000",
    model: "gpt-realtime-2",
    audio: { output: { voice: "marin" } },
  },
};

/**
 * The parameters are declared even though the stub ignores them: without them
 * the mock's call tuple types as `[]`, and every assertion about the request
 * that was SENT - which is most of this file - stops compiling.
 */
function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The single request the minter made, with the tuple narrowed once. */
function sentRequest(fetchMock: ReturnType<typeof stubFetch>) {
  const call = fetchMock.mock.calls[0];
  if (!call) throw new Error("fetch was never called");

  const [url, init = {}] = call;

  return {
    url,
    init,
    headers: (init.headers ?? {}) as Record<string, string>,
    body: JSON.parse((init.body as string | undefined) ?? "{}"),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const mint = () =>
  new OpenAiRealtimeMinter(OPTIONS).mint({ model: "gpt-realtime-2", voice: "marin" });

describe("the request it sends", () => {
  it("posts to the configured base URL, not a compiled-in one", async () => {
    const fetchMock = stubFetch(200, LIVE_SHAPED_RESPONSE);

    await mint();

    expect(sentRequest(fetchMock).url).toBe(
      "https://api.example.test/v1/realtime/client_secrets",
    );
  });

  it("authenticates with the server's key and asks for the configured TTL", async () => {
    const fetchMock = stubFetch(200, LIVE_SHAPED_RESPONSE);

    await mint();

    const { headers, body } = sentRequest(fetchMock);

    expect(headers.authorization).toBe("Bearer sk-test-key");
    expect(body.expires_after).toEqual({ anchor: "created_at", seconds: 60 });
    expect(body.session.model).toBe("gpt-realtime-2");
    expect(body.session.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "get_current_time",
      "search_conversations",
      "web_search",
      "show_card",
    ]);
  });

  /**
   * A hung mint leaves the user holding a phone with a spinning orb. The abort
   * signal is what turns that into a failure the app can offer a retry for.
   */
  it("bounds the request with a timeout signal", async () => {
    const fetchMock = stubFetch(200, LIVE_SHAPED_RESPONSE);

    await mint();

    expect(sentRequest(fetchMock).init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("the credential it returns", () => {
  it("converts the epoch-seconds expiry into a Date", async () => {
    stubFetch(200, LIVE_SHAPED_RESPONSE);

    const credential = await mint();

    expect(credential.value).toBe(LIVE_SHAPED_RESPONSE.value);
    expect(credential.expiresAt).toEqual(new Date(1787655645 * 1000));
    expect(credential.sessionId).toBe(LIVE_SHAPED_RESPONSE.session.id);
  });

  it("reports what the upstream applied, so the audit row is truthful", async () => {
    stubFetch(200, {
      ...LIVE_SHAPED_RESPONSE,
      session: {
        id: "sess_x",
        model: "gpt-realtime-2.1-mini",
        audio: { output: { voice: "cedar" } },
      },
    });

    const credential = await mint();

    expect(credential.model).toBe("gpt-realtime-2.1-mini");
    expect(credential.voice).toBe("cedar");
  });

  it("falls back to what was requested when the echo is missing", async () => {
    stubFetch(200, { value: "ek_x", expires_at: 1787655645 });

    const credential = await mint();

    expect(credential.model).toBe("gpt-realtime-2");
    expect(credential.voice).toBe("marin");
    expect(credential.sessionId).toBe("");
  });
});

describe("failures", () => {
  /**
   * 502, not 500. The distinction is the whole reason the error kind exists: a
   * 500 sends whoever is debugging into this codebase, a 502 sends them to the
   * provider's status page.
   */
  it("translates an upstream rejection into an upstream failure", async () => {
    stubFetch(401, { error: { message: "Incorrect API key provided: sk-abc123" } });

    await expect(mint()).rejects.toMatchObject({ kind: "upstream-failure" });
  });

  it("does not forward the upstream's message, which may name our account", async () => {
    stubFetch(401, { error: { message: "Incorrect API key provided: sk-abc123" } });

    await expect(mint()).rejects.toMatchObject({
      message: "The voice provider refused to issue a session credential",
    });
  });

  it("treats a transport error as an upstream failure, not a crash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    await expect(mint()).rejects.toMatchObject({ kind: "upstream-failure" });
  });

  it("survives a non-JSON body from the upstream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>502 Bad Gateway</html>", { status: 502 })),
    );

    await expect(mint()).rejects.toMatchObject({ kind: "upstream-failure" });
  });

  /**
   * A 200 with no credential would otherwise reach the device as
   * `clientSecret: undefined` and fail there, on a phone, as an unexplained
   * WebRTC error.
   */
  it("refuses a 200 that carries no credential", async () => {
    stubFetch(200, { session: { id: "sess_x" } });

    await expect(mint()).rejects.toMatchObject({ kind: "upstream-failure" });
  });

  it("refuses a 200 that carries no expiry", async () => {
    stubFetch(200, { value: "ek_x" });

    await expect(mint()).rejects.toMatchObject({ kind: "upstream-failure" });
  });
});

describe("callsUrl", () => {
  /**
   * Derived from the SAME base URL the mint uses, so pointing this server at a
   * mock moves both halves of the flow instead of leaving the device talking to
   * the real API.
   */
  it("is derived from the configured base URL", () => {
    expect(new OpenAiRealtimeMinter(OPTIONS).callsUrl).toBe(
      "https://api.example.test/v1/realtime/calls",
    );
  });

  it("tolerates a trailing slash in configuration", () => {
    const minter = new OpenAiRealtimeMinter({
      ...OPTIONS,
      baseUrl: "https://api.example.test/v1/",
    });

    expect(minter.callsUrl).toBe("https://api.example.test/v1/realtime/calls");
  });
});
