import { z } from "zod";

/**
 * WHERE a tool runs, which is the only security-relevant thing about it.
 *
 * `device`      - runs on the phone. It needs something only the phone has (a
 *                 clock, a timezone, a sensor) and touches nothing of ours. The
 *                 server refuses to proxy one, because a device tool arriving
 *                 over HTTP means something is wrong, not that a shortcut is
 *                 available.
 * `privileged`  - touches the user's data, so it runs on the SERVER, where the
 *                 caller's identity comes from their session. The model may ask
 *                 for it; it may not perform it.
 */
export type ToolExecution = "device" | "privileged";

export interface ToolDefinition<TInput extends z.ZodType = z.ZodType> {
  readonly name: string;
  /** Read by the MODEL to decide whether to call this. Write it for the model. */
  readonly description: string;
  readonly execution: ToolExecution;
  /**
   * ONE schema doing three jobs: it generates the JSON Schema OpenAI is given,
   * it validates the arguments that come back, and it types the handler. A tool
   * whose declared parameters and accepted parameters could disagree is a tool
   * that fails at the worst possible moment - mid-sentence, on a device.
   */
  readonly input: TInput;
}

/** Identity function that pins the type parameter. Declaration, never execution. */
export function defineTool<TInput extends z.ZodType>(
  definition: ToolDefinition<TInput>,
): ToolDefinition<TInput> {
  return definition;
}

/** The wire shape of one entry in `session.tools`. */
export interface RealtimeFunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Zod schema -> the JSON Schema OpenAI accepts in `session.tools[].parameters`.
 *
 * Two adjustments to Zod's output, both deliberate:
 *
 *   - `$schema` is REMOVED. Zod emits the draft identifier; OpenAI wants a bare
 *     parameter schema and the extra key is at best ignored.
 *   - `additionalProperties: false` is ADDED, which tells the model that
 *     inventing a field is not allowed. Without it a hallucinated argument
 *     arrives, fails validation server-side, and the user hears an apology
 *     instead of an answer.
 */
export function toParameterSchema(input: z.ZodType): Record<string, unknown> {
  const { $schema: _draft, ...schema } = z.toJSONSchema(input, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown> & { $schema?: unknown };

  return { ...schema, additionalProperties: false };
}

export function toRealtimeTool(definition: ToolDefinition): RealtimeFunctionTool {
  return {
    type: "function",
    name: definition.name,
    description: definition.description,
    parameters: toParameterSchema(definition.input),
  };
}
