import { type SearchConversationsArgs, searchConversationsTool } from "@convo/ai";
import type { ConversationSearchResult } from "@convo/shared";
import type { ConversationRepository } from "~/core/application/ports/conversation-repository.port";
import type {
  ToolExecutionContext,
  ToolHandler,
} from "~/core/application/ports/tool-handler.port";

/**
 * The implementation behind the `search_conversations` tool.
 *
 * A `ToolHandler` rather than a use case with its own verb, because it is only
 * ever reached through tool dispatch - registering it in the container is what
 * makes the declared tool executable, and a declaration with no entry there
 * fails loudly rather than silently doing nothing.
 *
 * Read the signature: `userId` is on the CONTEXT, `query` is in the args. The
 * model supplies the second and can never influence the first.
 */
export class SearchConversationsUseCase
  implements ToolHandler<SearchConversationsArgs, ConversationSearchResult>
{
  constructor(private readonly conversations: ConversationRepository) {}

  async execute(
    args: SearchConversationsArgs,
    context: ToolExecutionContext,
  ): Promise<ConversationSearchResult> {
    const matches = await this.conversations.search(context.userId, {
      query: args.query,
      limit: args.limit,
    });

    return {
      query: args.query,
      /**
       * Titles and dates only. Returning transcripts would put the user's whole
       * history one prompt injection away, and would flood the model's context
       * for a question that is usually just "which conversation was that?".
       */
      matches: matches.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        startedAt: conversation.startedAt.toISOString(),
        turnCount: conversation.turnCount,
      })),
    };
  }
}

/**
 * The name this handler is registered under, READ FROM THE DECLARATION rather
 * than retyped as a string literal.
 *
 * That is what makes the link structural: renaming the tool in `@convo/ai`
 * renames the registration too, so the container can never bind a handler to a
 * name no tool has. A test additionally asserts that every declared privileged
 * tool has a handler, which is the other half of the same guarantee.
 */
export const SEARCH_CONVERSATIONS_TOOL_NAME = searchConversationsTool.name;
