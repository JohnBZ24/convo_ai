import { z } from "zod";
import { defineTool } from "./tool-definition";

/**
 * Small on purpose, and not only for the bill.
 *
 * The model is BLOCKED on this call - the user is holding a phone listening to
 * silence until the result comes back and the reply is synthesised. Five pages
 * of excerpts is already more than a spoken answer can use; ten would buy
 * nothing but latency and tokens.
 */
export const WEB_SEARCH_MAX_RESULTS = 5;
export const WEB_SEARCH_DEFAULT_RESULTS = 4;
export const WEB_SEARCH_QUERY_MAX_LENGTH = 200;

/**
 * Look something up on the public web.
 *
 * Privileged, so it runs on the server - not because the web is the user's
 * data, but because the SEARCH KEY is ours. A device tool would need the key on
 * the phone, where any user could read it out of the APK and spend our budget.
 * The same reasoning that keeps `OPENAI_API_KEY` here keeps `EXA_API_KEY` here.
 *
 * Like every tool in this package there is no `userId` argument. This one has
 * no notion of a user at all; the identity on the context exists so the spend
 * can be rate limited per person rather than globally, which is what stops one
 * prompt-injected session from exhausting everyone's budget.
 */
export const webSearchTool = defineTool({
  name: "web_search",
  description:
    "Search the public web and return a few relevant pages with short excerpts from each. Use this for anything you cannot reliably answer from memory: current weather, news, prices, sports results, opening hours, or any fact that may have changed since you were trained. Do NOT use it for the user's own earlier conversations - that is search_conversations - or for the current date and time, which get_current_time answers. The result is page titles, addresses and the excerpts that matched the query; summarise them in a sentence or two rather than reading them out.",
  execution: "privileged",
  input: z.object({
    query: z
      .string()
      .min(1)
      .max(WEB_SEARCH_QUERY_MAX_LENGTH)
      .describe(
        "What to search for, written as a search query rather than as speech. Include the words that matter - a place, a date, a product - because this is matched against pages, not answered by a model.",
      ),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(WEB_SEARCH_MAX_RESULTS)
      .default(WEB_SEARCH_DEFAULT_RESULTS)
      .describe(
        "How many pages to return. Leave this alone unless the question genuinely needs several sources compared.",
      ),
  }),
});

export type WebSearchArgs = z.output<typeof webSearchTool.input>;
