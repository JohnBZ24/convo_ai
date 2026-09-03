import { WEB_SEARCH_SNIPPET_MAX_LENGTH } from "@convo/shared";
import { ApplicationError } from "~/core/application/errors/application-error";
import type {
  WebSearchDocument,
  WebSearchProvider,
  WebSearchQuery,
  WebSearchResponse,
} from "~/core/application/ports/web-search.port";
import { logger } from "~/infrastructure/logging/logger";
import type { ExaSearchType } from "~/infrastructure/search/exa-search-type";

export interface ExaWebSearchProviderOptions {
  apiKey: string;
  /** e.g. https://api.exa.ai - configuration, never a literal here. */
  baseUrl: string;
  searchType: ExaSearchType;
  requestTimeoutMs: number;
}

/**
 * What the endpoint returns. Only the fields this server actually reads are
 * modelled; Exa sends more and may send more still tomorrow.
 */
interface ExaSearchResponse {
  requestId?: unknown;
  results?: unknown;
}

/**
 * The one place this server's `EXA_API_KEY` is used.
 *
 * Same argument as the OpenAI minter next door: the key stays in this process.
 * A device that could search directly would need the key in the APK, where any
 * user can read it and spend the budget - so the phone gets a proxied result
 * and never a credential.
 *
 * This class owns TRANSPORT - the URL, the timeout, the failure translation,
 * and turning Exa's shape into the port's shape. It decides nothing about when
 * a search is worth making; that is the use case's job.
 */
export class ExaWebSearchProvider implements WebSearchProvider {
  constructor(private readonly options: ExaWebSearchProviderOptions) {}

  async search(query: WebSearchQuery): Promise<WebSearchResponse> {
    const response = await this.post({
      query: query.query,
      type: this.options.searchType,
      numResults: query.maxResults,
      /**
       * Highlights, not full text. They are the query-relevant excerpts, which
       * is exactly what a model composing a one-sentence spoken answer needs -
       * and `text` with no cap is how a search result turns into a context
       * flood and a bill.
       */
      contents: { highlights: true },
    });

    const payload = (await this.readJson(response)) as ExaSearchResponse;

    if (!response.ok) {
      /**
       * Logged with the upstream's own message, which may name the account or
       * the key's state - useful here, and never sent onward. The caller gets a
       * 502 and a request id, and nothing about our Exa account.
       */
      logger.error("web search rejected by upstream", {
        status: response.status,
        upstream: payload,
      });

      throw ApplicationError.upstreamFailure(
        "The search provider refused the request",
        {
          upstreamStatus: response.status,
        },
      );
    }

    return {
      searchId: typeof payload.requestId === "string" ? payload.requestId : "",
      documents: this.toDocuments(payload.results),
    };
  }

  private async post(body: unknown): Promise<Response> {
    const url = `${this.options.baseUrl.replace(/\/+$/, "")}/search`;

    try {
      return await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": this.options.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        /**
         * The model is BLOCKED on this call and the user is listening to
         * silence, so a hung search is worse than a failed one: a failure the
         * model can apologise for in a sentence, a hang is a dead orb.
         */
        signal: AbortSignal.timeout(this.options.requestTimeoutMs),
      });
    } catch (error) {
      logger.error("web search could not reach upstream", {
        error: error instanceof Error ? error.message : String(error),
      });

      throw ApplicationError.upstreamFailure(
        "The search provider could not be reached",
      );
    }
  }

  /** A non-JSON body from an upstream is a failure, not a crash. */
  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  /**
   * Validated rather than trusted, field by field.
   *
   * A 200 carrying a result with no `url` would otherwise reach the model as
   * `undefined` and be read out as a source, so anything without one is dropped
   * rather than patched up. Everything else degrades: a missing title falls
   * back to the host, missing highlights to an empty snippet.
   */
  private toDocuments(results: unknown): WebSearchDocument[] {
    if (!Array.isArray(results)) return [];

    const documents: WebSearchDocument[] = [];

    for (const entry of results) {
      if (typeof entry !== "object" || entry === null) continue;
      const result = entry as Record<string, unknown>;

      const url = typeof result.url === "string" ? result.url.trim() : "";
      if (url.length === 0) continue;

      const title = typeof result.title === "string" ? result.title.trim() : "";

      documents.push({
        title: title.length > 0 ? title : hostOf(url),
        url,
        snippet: snippetFrom(result.highlights),
        publishedDate:
          typeof result.publishedDate === "string" ? result.publishedDate : null,
        favicon: typeof result.favicon === "string" ? result.favicon : null,
      });
    }

    return documents;
  }
}

/** A URL Zod will reject is not worth a `.url()` failure three layers later. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * One highlight, as prose rather than as a page.
 *
 * Exa returns MARKDOWN, which was a surprise worth writing down: a live call on
 * 3 Sep 2026 came back with `# Weather for Beirut, Lebanon` and `## Today's
 * Weather` inside the excerpts, and one highlight was 2,916 characters long.
 * Collapsing whitespace alone leaves the hashes in place, and the model at the
 * other end of this SPEAKS its input - so the user hears "hash hash Today's
 * Weather". Stripped here rather than prompted around, because a prompt is a
 * request and this is a guarantee.
 */
function cleanHighlight(raw: string): string {
  return (
    raw
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
      // Exa marks a gap between excerpt chunks with a line of its own, which
      // otherwise collapses into a bare "..." mid-sentence.
      .replace(/^[ \t]*\.{3,}[ \t]*$/gm, " … ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Several excerpts per page become one bounded string.
 *
 * The ellipsis between them is not decoration: without it the joins read as
 * continuous prose, and a model summarising them will happily invent the
 * sentence that appears to span the gap.
 */
function snippetFrom(highlights: unknown): string {
  if (!Array.isArray(highlights)) return "";

  const joined = highlights
    .filter((item): item is string => typeof item === "string")
    .map(cleanHighlight)
    .filter((item) => item.length > 0)
    .join(" … ");

  return joined.length > WEB_SEARCH_SNIPPET_MAX_LENGTH
    ? `${joined.slice(0, WEB_SEARCH_SNIPPET_MAX_LENGTH - 1).trimEnd()}…`
    : joined;
}
