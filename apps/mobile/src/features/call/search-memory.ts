import { type WebSearchResult, webSearchResult } from "@convo/shared";

/**
 * What `web_search` found, kept on the phone so `show_card` can point at it.
 *
 * Every privileged result passes through this device on its way back to the
 * model, so the snippets and the links are already here. Holding on to them is
 * what lets the card tool take an ID instead of a payload: the model writes the
 * headline it alone can write, and the app supplies the sources - which keeps
 * URLs out of model output, where they can be invented.
 *
 * No React Native import, so the whole thing is testable. See CLAUDE.md.
 */

/**
 * A conversation could run for an hour. Bounded so a long one cannot grow this
 * without limit, and eight is far more than "the search I just did" needs -
 * `show_card` is meant to follow its search immediately.
 */
export const REMEMBERED_SEARCHES = 8;

export class SearchMemory {
  private readonly byId = new Map<string, WebSearchResult>();

  /**
   * Parsed rather than trusted, even though it came from our own server.
   *
   * This is handed whatever the proxy returned. Validating it against the
   * published contract means a shape change upstream turns into "no card"
   * rather than a crash mid-call, and it is the same schema the server built
   * the response from.
   */
  remember(result: unknown): void {
    const parsed = webSearchResult.safeParse(result);
    if (!parsed.success) return;

    // Re-insert so the Map's insertion order is also recency order, which is
    // what makes the eviction below drop the oldest rather than an arbitrary one.
    this.byId.delete(parsed.data.searchId);
    this.byId.set(parsed.data.searchId, parsed.data);

    while (this.byId.size > REMEMBERED_SEARCHES) {
      const oldest = this.byId.keys().next().value;
      if (oldest === undefined) break;
      this.byId.delete(oldest);
    }
  }

  /** Undefined when the model quoted an id from a search that never happened. */
  recall(searchId: string): WebSearchResult | undefined {
    return this.byId.get(searchId);
  }

  /** A new call starts with no memory of the last one's searches. */
  clear(): void {
    this.byId.clear();
  }

  get size(): number {
    return this.byId.size;
  }
}
