import { WEB_SEARCH_SNIPPET_MAX_LENGTH } from "@convo/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isApplicationError } from "~/core/application/errors/application-error";
import { ExaWebSearchProvider } from "~/infrastructure/search/exa-web-search.provider";

/**
 * `fetch` is stubbed rather than called, so this suite asserts on the request
 * that WOULD go to Exa and on how each failure shape is translated - with no
 * network, no API key and no spend.
 *
 * The response shape below follows Exa's documented `/search` schema: a result
 * always carries `id`, `title` and `url`, while `highlights` appear only
 * because this provider asks for them.
 */

const OPTIONS = {
  apiKey: "exa-test-key",
  baseUrl: "https://api.example.test",
  searchType: "auto" as const,
  requestTimeoutMs: 5000,
};

const DOCUMENTED_RESPONSE = {
  requestId: "req_0000000000000000",
  results: [
    {
      id: "https://example.test/beirut-weather",
      title: "Beirut weather today",
      url: "https://example.test/beirut-weather",
      publishedDate: "2026-09-03T06:00:00.000Z",
      favicon: "https://example.test/favicon.ico",
      highlights: ["Beirut is 30C and sunny.", "Humidity is around 58 percent."],
    },
  ],
  costDollars: { total: 0.005 },
};

/**
 * The parameters are declared even though the stub ignores them: without them
 * the mock's call tuple types as `[]`, and every assertion about the request
 * that was SENT stops compiling.
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

function sentRequest(fetchMock: ReturnType<typeof stubFetch>) {
  const call = fetchMock.mock.calls[0];
  if (!call) throw new Error("fetch was never called");

  const [url, init = {}] = call;

  return {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the request", () => {
  it("posts to /search with the key in x-api-key, not a bearer token", async () => {
    const fetchMock = stubFetch(200, DOCUMENTED_RESPONSE);

    await new ExaWebSearchProvider(OPTIONS).search({ query: "beirut", maxResults: 4 });

    const request = sentRequest(fetchMock);

    expect(request.url).toBe("https://api.example.test/search");
    expect(request.headers["x-api-key"]).toBe("exa-test-key");
    expect(request.headers.authorization).toBeUndefined();
  });

  /**
   * Highlights, not text. `text` with no cap is how one search result turns
   * into a context flood and a bill; highlights are the excerpts that actually
   * matched, which is all a one-sentence spoken answer can use.
   */
  it("asks for highlights and passes the configured depth and count", async () => {
    const fetchMock = stubFetch(200, DOCUMENTED_RESPONSE);

    await new ExaWebSearchProvider({ ...OPTIONS, searchType: "fast" }).search({
      query: "weather in beirut",
      maxResults: 2,
    });

    expect(sentRequest(fetchMock).body).toEqual({
      query: "weather in beirut",
      type: "fast",
      numResults: 2,
      contents: { highlights: true },
    });
  });

  it("tolerates a base URL with a trailing slash", async () => {
    const fetchMock = stubFetch(200, DOCUMENTED_RESPONSE);

    await new ExaWebSearchProvider({
      ...OPTIONS,
      baseUrl: "https://api.example.test/",
    }).search({ query: "beirut", maxResults: 1 });

    expect(sentRequest(fetchMock).url).toBe("https://api.example.test/search");
  });
});

describe("the response", () => {
  it("maps a documented result into the port's shape", async () => {
    stubFetch(200, DOCUMENTED_RESPONSE);

    const response = await new ExaWebSearchProvider(OPTIONS).search({
      query: "beirut",
      maxResults: 4,
    });

    expect(response.searchId).toBe("req_0000000000000000");
    expect(response.documents).toEqual([
      {
        title: "Beirut weather today",
        url: "https://example.test/beirut-weather",
        snippet: "Beirut is 30C and sunny. … Humidity is around 58 percent.",
        publishedDate: "2026-09-03T06:00:00.000Z",
        favicon: "https://example.test/favicon.ico",
      },
    ]);
  });

  /**
   * A result with no address would reach the model as a source it cannot cite
   * and the device as a card it cannot open, so it is dropped rather than
   * patched up. Everything else degrades instead: a missing title falls back to
   * the host, missing highlights to an empty snippet.
   */
  it("drops a result with no url and falls back for the rest", async () => {
    stubFetch(200, {
      results: [
        { title: "No address here", highlights: ["something"] },
        { url: "https://example.test/a/b?c=d", highlights: [] },
        "not an object",
      ],
    });

    const response = await new ExaWebSearchProvider(OPTIONS).search({
      query: "x",
      maxResults: 4,
    });

    expect(response.documents).toEqual([
      {
        title: "example.test",
        url: "https://example.test/a/b?c=d",
        snippet: "",
        publishedDate: null,
        favicon: null,
      },
    ]);

    // No requestId in that body, and an empty string is the honest answer -
    // inventing one here would hide the gap from the use case that fills it.
    expect(response.searchId).toBe("");
  });

  /**
   * The input below is real, captured from a live call on 3 Sep 2026. Exa
   * returns markdown, and the model at the other end SPEAKS what it is given -
   * so a surviving `##` is heard as "hash hash Today's Weather".
   */
  it("strips the markdown Exa puts inside a highlight", async () => {
    stubFetch(200, {
      results: [
        {
          url: "https://example.test/w",
          title: "W",
          highlights: [
            "## Today's Weather\n...\nPartly cloudy, 86°F (30.2°C), feels like 94°F.",
          ],
        },
      ],
    });

    const [document] = (
      await new ExaWebSearchProvider(OPTIONS).search({ query: "x", maxResults: 1 })
    ).documents;

    expect(document?.snippet).toBe(
      "Today's Weather … Partly cloudy, 86°F (30.2°C), feels like 94°F.",
    );
  });

  it("trims a long snippet to the declared ceiling", async () => {
    stubFetch(200, {
      results: [
        {
          url: "https://example.test/long",
          title: "Long",
          highlights: ["word ".repeat(400)],
        },
      ],
    });

    const [document] = (
      await new ExaWebSearchProvider(OPTIONS).search({ query: "x", maxResults: 1 })
    ).documents;

    expect(document?.snippet.length).toBeLessThanOrEqual(WEB_SEARCH_SNIPPET_MAX_LENGTH);
    expect(document?.snippet.endsWith("…")).toBe(true);
  });

  /**
   * The cap is measured in JS string length, and the text this handles is full
   * of `°` and `…`. Worth pinning explicitly: a probe that counted these as
   * multiple characters - which is what happens if UTF-8 is read as cp1252 -
   * reported 336 for a snippet that is genuinely 320, and looked exactly like a
   * broken cap. Several highlights, all multi-byte, joined past the boundary.
   */
  it("caps a multi-byte snippet at exactly the ceiling, never over", async () => {
    stubFetch(200, {
      results: [
        {
          url: "https://example.test/mb",
          title: "Multi-byte",
          highlights: [
            "Partly cloudy, 86°F (30.2°C), feels like 94°F. ".repeat(6),
            "Höchsttemperatur 30°C — gefühlt 34°C. ".repeat(6),
          ],
        },
      ],
    });

    const [document] = (
      await new ExaWebSearchProvider(OPTIONS).search({ query: "x", maxResults: 1 })
    ).documents;

    expect(document?.snippet.length).toBe(WEB_SEARCH_SNIPPET_MAX_LENGTH);
    expect(document?.snippet.endsWith("…")).toBe(true);
  });

  it("leaves a snippet already at the ceiling untouched", async () => {
    // Exactly at the boundary: the `>` in the trim must not fire here.
    stubFetch(200, {
      results: [
        {
          url: "https://example.test/exact",
          title: "Exact",
          highlights: ["a".repeat(WEB_SEARCH_SNIPPET_MAX_LENGTH)],
        },
      ],
    });

    const [document] = (
      await new ExaWebSearchProvider(OPTIONS).search({ query: "x", maxResults: 1 })
    ).documents;

    expect(document?.snippet.length).toBe(WEB_SEARCH_SNIPPET_MAX_LENGTH);
    expect(document?.snippet.endsWith("…")).toBe(false);
  });

  it("survives a body that is not JSON at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>gateway</html>", { status: 200 })),
    );

    const response = await new ExaWebSearchProvider(OPTIONS).search({
      query: "x",
      maxResults: 1,
    });

    expect(response.documents).toEqual([]);
  });
});

describe("failure translation", () => {
  /**
   * 502, not 500. A bad key or an Exa outage is not a bug in this codebase, and
   * saying so is what stops whoever is debugging from reading this file instead
   * of the status page. The upstream's own message never leaves the log.
   */
  it.each([401, 429, 500] as const)(
    "reports an upstream %s as upstream-failure without forwarding its message",
    async (status) => {
      stubFetch(status, { error: "Invalid or missing API key for account acct_123" });

      const error = await new ExaWebSearchProvider(OPTIONS)
        .search({ query: "x", maxResults: 1 })
        .catch((caught: unknown) => caught);

      expect(isApplicationError(error) && error.kind).toBe("upstream-failure");
      expect(String((error as Error).message)).not.toContain("acct_123");
    },
  );

  it("reports a network failure as upstream-failure rather than crashing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const error = await new ExaWebSearchProvider(OPTIONS)
      .search({ query: "x", maxResults: 1 })
      .catch((caught: unknown) => caught);

    expect(isApplicationError(error) && error.kind).toBe("upstream-failure");
  });
});
