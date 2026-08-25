import { z } from "zod";
import { defineTool } from "./tool-definition";

/** Never let one tool result flood the model's context - or the bill. */
export const SEARCH_CONVERSATIONS_MAX_RESULTS = 10;
export const SEARCH_CONVERSATIONS_DEFAULT_RESULTS = 5;
export const SEARCH_QUERY_MAX_LENGTH = 200;

/**
 * Find earlier conversations of THIS user.
 *
 * Privileged, so it runs on the server. Note what the arguments do NOT contain:
 * there is no `userId` and there never will be. The model is running on a
 * device the user controls and may have been prompt-injected into asking for
 * anyone's history; the server takes the identity from the session and ignores
 * every claim about who is asking.
 *
 * The result is deliberately titles and dates, not transcripts. It is enough
 * for "what did we talk about on Tuesday", and it keeps a search from dumping
 * an entire history back into the model's context.
 */
export const searchConversationsTool = defineTool({
  name: "search_conversations",
  description:
    "Search the user's own earlier conversations by keyword and return their titles and dates. Use this when the user refers to something you discussed before. Returns titles only, not what was said - to read a conversation back, ask the user to open it.",
  execution: "privileged",
  input: z.object({
    query: z
      .string()
      .min(1)
      .max(SEARCH_QUERY_MAX_LENGTH)
      .describe("Words to look for in the conversation titles and what was said."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(SEARCH_CONVERSATIONS_MAX_RESULTS)
      .default(SEARCH_CONVERSATIONS_DEFAULT_RESULTS)
      .describe("How many conversations to return, newest first."),
  }),
});

export type SearchConversationsArgs = z.output<typeof searchConversationsTool.input>;
