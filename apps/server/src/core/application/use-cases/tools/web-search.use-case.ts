import { randomUUID } from "node:crypto";
import { type WebSearchArgs, webSearchTool } from "@convo/ai";
import type { WebSearchResult } from "@convo/shared";
import { ApplicationError } from "~/core/application/errors/application-error";
import type { RateLimiter } from "~/core/application/ports/rate-limiter.port";
import type {
  ToolExecutionContext,
  ToolHandler,
} from "~/core/application/ports/tool-handler.port";
import type { WebSearchProvider } from "~/core/application/ports/web-search.port";

/**
 * A spend cap, per user, on top of the route's own limit.
 *
 * `rateLimitMiddleware("tools")` already caps the endpoint at 120 calls a
 * minute, which is the right ceiling for tools that only read our database. It
 * is the wrong ceiling for one that costs money at a third party: a model stuck
 * in a loop would spend the month's search budget in under an hour, and the
 * first anyone would know is the invoice.
 *
 * Thirty an hour is far more than a conversation ever needs - the model is
 * blocked on each one, so thirty searches is already several minutes of a user
 * listening to silence - and it is a hard floor under the damage.
 */
export const WEB_SEARCH_RATE_LIMIT = {
  limit: 30,
  windowMs: 60 * 60 * 1000,
} as const;

/**
 * The implementation behind the `web_search` tool.
 *
 * Read what it does NOT do: it never inspects the query for intent, never
 * rewrites it, and never decides a search was unnecessary. The model chose to
 * search; this runs the search. What it does own is the two things the model
 * cannot be trusted with - the key, which never leaves this process, and the
 * budget, which is charged to the user from the SESSION rather than to whoever
 * the arguments claim to be.
 */
export class WebSearchUseCase implements ToolHandler<WebSearchArgs, WebSearchResult> {
  constructor(
    private readonly provider: WebSearchProvider,
    private readonly limiter: RateLimiter,
    private readonly budget: {
      limit: number;
      windowMs: number;
    } = WEB_SEARCH_RATE_LIMIT,
    /**
     * Injected for the same reason the clock is injected into `ExecuteToolUseCase`:
     * a use case that reaches for randomness directly is a use case whose output
     * cannot be asserted.
     */
    private readonly newSearchId: () => string = () => randomUUID(),
  ) {}

  async execute(
    args: WebSearchArgs,
    context: ToolExecutionContext,
  ): Promise<WebSearchResult> {
    /**
     * Keyed by the authenticated user, so one prompt-injected session cannot
     * exhaust everyone else's budget - and cannot buy itself a fresh one by
     * varying anything it controls, because it controls nothing in this key.
     */
    const decision = await this.limiter.consume(
      `web_search:${context.userId}`,
      this.budget.limit,
      this.budget.windowMs,
    );

    if (!decision.allowed) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((decision.resetAt.getTime() - Date.now()) / 1000),
      );

      /**
       * Written to be SPOKEN. The device turns a failed proxy call into
       * `{ error }` and hands it straight to the model, so this sentence is
       * roughly what the user hears - which is why it says what happened rather
       * than naming a limit, a bucket or a status code.
       */
      throw ApplicationError.rateLimited(
        "You have run too many web searches for now. Tell the user you cannot look anything else up for a little while, and answer from what you already know.",
        { retryAfterSeconds },
      );
    }

    const response = await this.provider.search({
      query: args.query,
      maxResults: args.maxResults,
    });

    return {
      /**
       * The provider's own id where it gives one, so a result seen on the phone
       * can be traced to a line in the logs. Where it does not, a fresh one -
       * the field has to be unique per search because the device keys a cached
       * result on it, and an empty string would collide with every other.
       */
      searchId: response.searchId.length > 0 ? response.searchId : this.newSearchId(),
      query: args.query,
      results: response.documents,
    };
  }
}

/**
 * The name this handler is registered under, READ FROM THE DECLARATION rather
 * than retyped as a string literal. Renaming the tool renames the binding.
 */
export const WEB_SEARCH_TOOL_NAME = webSearchTool.name;
