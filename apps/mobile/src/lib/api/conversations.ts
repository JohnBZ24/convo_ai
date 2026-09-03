import type {
  AppendTurnBody,
  AppendTurnResponse,
  ConversationDetail,
  ConversationListQuery,
  ConversationSummary,
} from "@convo/shared";
import { apiRequest } from "./client";

/**
 * Everything the app does with a conversation.
 *
 * One is opened before the credential is minted, so the mint can name it and
 * the audit row points somewhere; turns are posted into it as they complete;
 * it is ended when the user hangs up; and afterwards it is something in the
 * sidebar that can be read back, renamed or deleted.
 *
 * Every type here comes from `@convo/shared` - the SAME schemas the server
 * validates with - so a contract change breaks this at compile time rather than
 * on a phone.
 */

/** The page shape `GET /api/conversations` returns. */
export interface ConversationPage {
  items: ConversationSummary[];
  /** Opaque. Pass it back as `cursor`; null means there is no more. */
  nextCursor: string | null;
}

export function createConversation(token: string): Promise<ConversationSummary> {
  // No body: the title is not the caller's to choose. The server derives it
  // from the first thing the user actually says.
  return apiRequest<ConversationSummary>("/api/conversations", {
    method: "POST",
    token,
  });
}

/**
 * The sidebar's list, optionally narrowed by `q`.
 *
 * `q` matches a conversation's title OR the text of anything said in it, and
 * the server pages the MATCHES - so this is one endpoint with a filter, not a
 * separate search endpoint whose results would page differently.
 */
export function listConversations(
  token: string,
  options: Partial<ConversationListQuery> = {},
): Promise<ConversationPage> {
  /**
   * Built by hand, NOT with `URLSearchParams`.
   *
   * React Native's polyfill is a stub: `set`, `get` and `delete` throw "not
   * implemented" and `size` does not exist. Node has the real thing, so a test
   * written against it passes while the device throws - the same shape of trap
   * as every other "it worked from the laptop" bug in this project.
   */
  const parts: string[] = [];
  if (options.limit !== undefined) parts.push(`limit=${options.limit}`);
  if (options.cursor) parts.push(`cursor=${encodeURIComponent(options.cursor)}`);
  // Encoded, not interpolated: a search term is arbitrary text a person typed,
  // and "&" or "#" in it would otherwise rewrite the query string.
  if (options.q) parts.push(`q=${encodeURIComponent(options.q)}`);

  const suffix = parts.length > 0 ? `?${parts.join("&")}` : "";

  return apiRequest<ConversationPage>(`/api/conversations${suffix}`, { token });
}

/** The conversation WITH its turns - what the history screen renders. */
export function fetchConversation(
  token: string,
  conversationId: string,
): Promise<ConversationDetail> {
  return apiRequest<ConversationDetail>(`/api/conversations/${conversationId}`, {
    token,
  });
}

export function endConversation(
  token: string,
  conversationId: string,
): Promise<ConversationSummary> {
  // Idempotent on the server: a second PATCH returns the original `endedAt`.
  return apiRequest<ConversationSummary>(`/api/conversations/${conversationId}`, {
    method: "PATCH",
    body: { status: "ended" },
    token,
  });
}

/**
 * The one title the user chooses. Same endpoint as ending, different intent -
 * the server reads the body's SHAPE to tell them apart.
 */
export function renameConversation(
  token: string,
  conversationId: string,
  title: string,
): Promise<ConversationSummary> {
  return apiRequest<ConversationSummary>(`/api/conversations/${conversationId}`, {
    method: "PATCH",
    body: { title },
    token,
  });
}

/** 204 and nothing back. Deliberately not idempotent - a second one is a 404. */
export function deleteConversation(
  token: string,
  conversationId: string,
): Promise<void> {
  return apiRequest<void>(`/api/conversations/${conversationId}`, {
    method: "DELETE",
    token,
  });
}

/**
 * Record one completed utterance.
 *
 * `seq` is assigned HERE, on the device, which is what makes a retry safe: the
 * same turn carries the same seq, the server's unique index rejects the
 * duplicate, and the answer is 200 with `replayed: true` rather than a second
 * copy of what the user said. See `features/call/turn-recorder.ts`.
 */
export function appendTurn(
  token: string,
  conversationId: string,
  turn: AppendTurnBody,
): Promise<AppendTurnResponse> {
  return apiRequest<AppendTurnResponse>(`/api/conversations/${conversationId}/turns`, {
    method: "POST",
    body: turn,
    token,
  });
}
