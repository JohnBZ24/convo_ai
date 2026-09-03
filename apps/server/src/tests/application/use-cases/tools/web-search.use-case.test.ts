import { webSearchTool } from "@convo/ai";
import { beforeEach, describe, expect, it } from "vitest";
import { isApplicationError } from "~/core/application/errors/application-error";
import type {
  RateLimitDecision,
  RateLimiter,
} from "~/core/application/ports/rate-limiter.port";
import type { ToolExecutionContext } from "~/core/application/ports/tool-handler.port";
import type {
  WebSearchProvider,
  WebSearchQuery,
  WebSearchResponse,
} from "~/core/application/ports/web-search.port";
import {
  WEB_SEARCH_RATE_LIMIT,
  WebSearchUseCase,
} from "~/core/application/use-cases/tools/web-search.use-case";

/**
 * The provider is a double, so this suite is about the two things the handler
 * owns and the provider does not: WHO the spend is charged to, and what happens
 * when they have spent it.
 *
 * Arguments arrive already parsed by `ExecuteToolUseCase` against the tool's
 * declared schema, so they are built through that schema here rather than typed
 * by hand - a test that fabricated an out-of-range `maxResults` would be
 * asserting on a state the handler can never actually see.
 */

const CONTEXT: ToolExecutionContext = {
  userId: "user_asking",
  conversationId: "1f1cd85d-6c6f-4c76-8b3f-9d0dbd1f2c56",
};

function args(input: Record<string, unknown>) {
  return webSearchTool.input.parse(input);
}

class StubProvider implements WebSearchProvider {
  readonly queries: WebSearchQuery[] = [];

  constructor(
    private readonly response: WebSearchResponse = {
      searchId: "req_from_provider",
      documents: [
        {
          title: "Beirut weather today",
          url: "https://example.test/beirut",
          snippet: "Beirut is 30C and sunny.",
          publishedDate: null,
          favicon: null,
        },
      ],
    },
  ) {}

  async search(query: WebSearchQuery): Promise<WebSearchResponse> {
    this.queries.push(query);
    return this.response;
  }
}

/** Records every key it is asked about, which is the point of most of this file. */
class RecordingLimiter implements RateLimiter {
  readonly keys: string[] = [];
  readonly budgets: Array<{ limit: number; windowMs: number }> = [];

  constructor(private readonly decision: Partial<RateLimitDecision> = {}) {}

  async consume(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitDecision> {
    this.keys.push(key);
    this.budgets.push({ limit, windowMs });

    return {
      allowed: true,
      limit,
      remaining: limit - 1,
      resetAt: new Date("2026-09-03T13:00:00.000Z"),
      ...this.decision,
    };
  }
}

let provider: StubProvider;
let limiter: RecordingLimiter;

beforeEach(() => {
  provider = new StubProvider();
  limiter = new RecordingLimiter();
});

describe("a search that is within budget", () => {
  it("passes the declared query and count straight through", async () => {
    const useCase = new WebSearchUseCase(provider, limiter);

    await useCase.execute(args({ query: "weather in beirut" }), CONTEXT);

    // `maxResults` was never sent by the model; the schema's default supplied it.
    expect(provider.queries).toEqual([{ query: "weather in beirut", maxResults: 4 }]);
  });

  it("returns the query with the documents, for a device that renders them", async () => {
    const useCase = new WebSearchUseCase(provider, limiter);

    const result = await useCase.execute(args({ query: "weather in beirut" }), CONTEXT);

    expect(result).toEqual({
      searchId: "req_from_provider",
      query: "weather in beirut",
      results: [
        {
          title: "Beirut weather today",
          url: "https://example.test/beirut",
          snippet: "Beirut is 30C and sunny.",
          publishedDate: null,
          favicon: null,
        },
      ],
    });
  });

  /**
   * The device keys a cached result on this id so a later tool can draw those
   * sources without the model retyping a URL. Two searches sharing an id would
   * put the wrong sources under the right headline, so an absent one is
   * replaced rather than passed on.
   */
  it("substitutes a fresh id when the provider returns none", async () => {
    const silent = new StubProvider({ searchId: "", documents: [] });
    const useCase = new WebSearchUseCase(
      silent,
      limiter,
      WEB_SEARCH_RATE_LIMIT,
      () => "generated_id",
    );

    const result = await useCase.execute(args({ query: "x" }), CONTEXT);

    expect(result.searchId).toBe("generated_id");
  });
});

describe("the spend cap", () => {
  /**
   * The single most important assertion in this file. The key is built from the
   * SESSION's user id, so one prompt-injected conversation burns its own budget
   * and nobody else's - and cannot buy a fresh one by varying anything it
   * controls, because it controls nothing in this key.
   */
  it("charges the search to the user on the context, not to anything in the args", async () => {
    const useCase = new WebSearchUseCase(provider, limiter);

    await useCase.execute(args({ query: "weather in beirut" }), CONTEXT);

    expect(limiter.keys).toEqual(["web_search:user_asking"]);
    expect(limiter.budgets).toEqual([WEB_SEARCH_RATE_LIMIT]);
  });

  it("refuses without reaching the provider once the budget is spent", async () => {
    const exhausted = new RecordingLimiter({ allowed: false, remaining: 0 });
    const useCase = new WebSearchUseCase(provider, exhausted);

    const error = await useCase
      .execute(args({ query: "weather in beirut" }), CONTEXT)
      .catch((caught: unknown) => caught);

    expect(isApplicationError(error) && error.kind).toBe("rate-limited");
    // Not "it failed after we paid for it": the provider is never called.
    expect(provider.queries).toEqual([]);
  });

  /**
   * The device turns a failed proxy call into `{ error }` and hands it to the
   * model, so this message is roughly what the user HEARS. It has to read as an
   * instruction to a speaker, not as an HTTP status.
   */
  it("refuses with a sentence the model can act on", async () => {
    const exhausted = new RecordingLimiter({ allowed: false, remaining: 0 });
    const useCase = new WebSearchUseCase(provider, exhausted);

    const error = await useCase
      .execute(args({ query: "x" }), CONTEXT)
      .catch((caught: unknown) => caught);

    const message = String((error as Error).message);

    expect(message).toContain("Tell the user");
    expect(message).not.toMatch(/429|rate.?limit|bucket/i);
  });
});
