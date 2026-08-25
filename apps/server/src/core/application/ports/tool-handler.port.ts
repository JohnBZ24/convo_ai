/**
 * What a privileged tool is given, and it is not what the model sent.
 *
 * `userId` comes from the authenticated session, upstream of this interface.
 * That is the single most important fact in the tools subsystem: the model
 * decides WHICH tool runs, never WHOSE data it runs against. There is
 * deliberately no way to express "act as someone else" here, because a model on
 * a device the user controls can be argued into asking for exactly that.
 */
export interface ToolExecutionContext {
  /** From the bearer token. Never from a tool argument. */
  readonly userId: string;
  /** For the audit row only. Ownership is still re-checked per query. */
  readonly conversationId: string | null;
}

/**
 * One privileged tool's implementation.
 *
 * `args` arrives ALREADY validated against the tool's declared Zod schema, so a
 * handler never parses or defends against shape - by the time it runs, the
 * arguments are the arguments it declared.
 *
 * Handlers must be safe to RE-RUN. The idempotency key deduplicates the audit
 * trail, not the work, so a tool that is not naturally repeatable would need to
 * cache its own result before it could be added here. Both current tools are
 * reads. See docs/HANDOFF.md.
 */
export interface ToolHandler<TArgs = never, TResult = unknown> {
  execute(args: TArgs, context: ToolExecutionContext): Promise<TResult>;
}

/**
 * Tool name -> implementation, supplied by the composition root.
 *
 * A name in `@convo/ai`'s registry with no entry here is a BUG in this server,
 * not a bad request - the model was told the tool exists. It surfaces as a 500,
 * and a test asserts that, so a half-added tool cannot ship quietly.
 */
export type ToolHandlerRegistry = Readonly<Record<string, ToolHandler<never, unknown>>>;
