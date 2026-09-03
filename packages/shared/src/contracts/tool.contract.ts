import { z } from "zod";
import { isoTimestamp } from "./common.contract";

/**
 * The contract for `POST /api/tools/:name`.
 *
 * Read the threat model before changing anything here. The model runs ON THE
 * DEVICE, it decides when to call a tool, and the user may have talked it into
 * anything - so every field below is attacker-controlled input. Notice what is
 * absent: there is no `userId`, and adding one would be a vulnerability, not a
 * convenience. Identity comes from the bearer token and nowhere else.
 */

/**
 * OpenAI's `call_id` for this function call, straight off the data channel.
 *
 * Doubles as the idempotency key: the device retries a tool call it never got a
 * response to, and the same call carries the same id, so the audit trail
 * records one invocation rather than one per attempt. It is scoped by user
 * server-side, so one caller's id cannot collide with another's.
 */
export const TOOL_CALL_ID_MAX_LENGTH = 128;

export const executeToolParams = z.object({
  name: z.string().min(1).max(64),
});

export const executeToolBody = z
  .object({
    callId: z
      .string()
      .min(1)
      .max(TOOL_CALL_ID_MAX_LENGTH)
      .describe("OpenAI's call_id for this function call. Used for idempotency."),
    /**
     * The model's `arguments`, already JSON-parsed by the device. Typed as an
     * open object HERE and validated against the specific tool's schema in the
     * use case - this endpoint serves every tool, so the precise shape is not
     * known until the name is resolved.
     */
    arguments: z
      .record(z.string(), z.unknown())
      .default({})
      .describe("The arguments the model produced, parsed from its JSON string."),
    conversationId: z
      .uuid()
      .optional()
      .describe("The conversation this call belongs to, for the audit trail."),
  })
  .meta({
    id: "ExecuteToolRequest",
    description: "A privileged tool call proxied from the model on the device",
  });

export type ExecuteToolBody = z.infer<typeof executeToolBody>;

export const executeToolResponse = z
  .object({
    toolName: z.string(),
    callId: z.string(),
    /**
     * Shape depends on the tool. The device serialises this straight back into
     * a `function_call_output` item on the data channel without inspecting it.
     */
    result: z.unknown(),
    /** True when this callId was already recorded, i.e. the device retried. */
    replayed: z.boolean(),
    durationMs: z.number().int().nonnegative(),
  })
  .meta({
    id: "ExecuteToolResponse",
    description: "The tool's result, to be returned to the model as function output",
  });

export type ExecuteToolResponse = z.infer<typeof executeToolResponse>;

/**
 * What `search_conversations` returns.
 *
 * Titles and dates, NOT transcripts. Enough to answer "what did we talk about
 * on Tuesday", while keeping a single tool call from pulling a user's entire
 * history back into the model's context - which would be slow, expensive, and a
 * much larger prize for a prompt injection.
 */
export const conversationSearchHit = z
  .object({
    id: z.uuid(),
    title: z.string().nullable(),
    startedAt: isoTimestamp,
    turnCount: z.number().int().nonnegative(),
  })
  .meta({ id: "ConversationSearchHit", description: "One search result" });

export const conversationSearchResult = z
  .object({
    query: z.string(),
    matches: z.array(conversationSearchHit),
  })
  .meta({
    id: "ConversationSearchResult",
    description: "The result payload of the search_conversations tool",
  });

export type ConversationSearchHit = z.infer<typeof conversationSearchHit>;
export type ConversationSearchResult = z.infer<typeof conversationSearchResult>;

/**
 * How much of one page reaches the model.
 *
 * The provider returns query-relevant excerpts, and several of them per page.
 * Handing all of that to a model whose reply is SPOKEN is the wrong trade twice
 * over: it costs latency the user hears as silence, and it tempts the model to
 * read prose aloud instead of answering. Trimmed at the server so the ceiling
 * holds no matter what the provider decides to return tomorrow.
 */
export const WEB_SEARCH_SNIPPET_MAX_LENGTH = 320;

export const webSearchHit = z
  .object({
    title: z.string(),
    url: z.url(),
    /** The excerpts that matched, joined and trimmed. May be empty. */
    snippet: z.string(),
    /** Absent for a great many pages, so nullable rather than optional. */
    publishedDate: z.string().nullable(),
    favicon: z.string().nullable(),
  })
  .meta({ id: "WebSearchHit", description: "One page found by web_search" });

/**
 * What `web_search` returns.
 *
 * `searchId` exists so the DEVICE can find this result again without the model
 * retyping it. The phone sees every privileged result on its way back to the
 * model, so a later tool that draws these sources on screen can reference the
 * search by id and supply only the words a model has to write - which keeps
 * URLs out of the model's output, where they can be hallucinated.
 */
export const webSearchResult = z
  .object({
    searchId: z.string(),
    query: z.string(),
    results: z.array(webSearchHit),
  })
  .meta({
    id: "WebSearchResult",
    description: "The result payload of the web_search tool",
  });

export type WebSearchHit = z.infer<typeof webSearchHit>;
export type WebSearchResult = z.infer<typeof webSearchResult>;
