/**
 * Searching the public web, as the core understands it.
 *
 * The core knows there is such a thing as a web search and nothing about who
 * performs it: no provider name, no API key, no HTTP. That is what lets the
 * provider change - Exa today, something else later, a canned list in a test -
 * without a use case noticing.
 *
 * Note what is NOT here: no user, no session, no ownership. This port reaches
 * something public. Identity still matters one level up, where the spend is
 * rate limited per person, but it is not this interface's business.
 */
export interface WebSearchQuery {
  query: string;
  /** Already bounded by the tool's declared schema before it gets here. */
  maxResults: number;
}

export interface WebSearchDocument {
  title: string;
  url: string;
  /** The excerpts that matched, joined and trimmed. Possibly empty. */
  snippet: string;
  publishedDate: string | null;
  favicon: string | null;
}

export interface WebSearchResponse {
  /**
   * The provider's own id for this search where it offers one, so a result seen
   * on the device can be tied back to a line in the logs.
   */
  searchId: string;
  documents: WebSearchDocument[];
}

export interface WebSearchProvider {
  search(query: WebSearchQuery): Promise<WebSearchResponse>;
}
