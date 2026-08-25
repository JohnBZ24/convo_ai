/**
 * The audit trail for privileged tool calls.
 *
 * This endpoint is reachable by a model that a user may have prompt-injected,
 * so "what did it try, and when" has to be answerable after the fact - both
 * successes and failures, which is why `status` exists.
 */
export interface RecordToolInvocationInput {
  userId: string;
  conversationId: string | null;
  toolName: string;
  /**
   * Unique per invocation. Built from the user id AND the model's `call_id`,
   * so one caller's retry can never collide with another caller's call - the
   * column is globally unique, and `call_id` alone is only unique per session.
   */
  idempotencyKey: string;
  status: "ok" | "error";
  durationMs: number;
}

export interface ToolInvocationRepository {
  /**
   * Returns FALSE when this key was already recorded - i.e. the device retried
   * a call it never got an answer to. The caller reports that as `replayed`,
   * exactly as a repeated turn does, so a retry is distinguishable from a
   * fresh call without inspecting the result.
   */
  record(input: RecordToolInvocationInput): Promise<boolean>;
}
