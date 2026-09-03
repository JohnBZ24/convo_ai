import type { ConversationSummary } from "@convo/shared";
import { apiRequest } from "./client";

/**
 * The conversation a call records into.
 *
 * Opened before the credential is minted, so the mint can name it and the audit
 * row points somewhere. Ended when the user hangs up.
 */

export function createConversation(token: string): Promise<ConversationSummary> {
  // No body: the title is not the caller's to choose. The server derives it
  // from the first thing the user actually says.
  return apiRequest<ConversationSummary>("/api/conversations", {
    method: "POST",
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
