/**
 * The audit trail for credential minting.
 *
 * One row per credential issued: who, when, which model, when it died. The
 * credential VALUE is deliberately not part of this interface - there is no
 * field to put it in, so it cannot be stored by accident.
 *
 * It is also the durable record behind the rate limit. The in-process limiter
 * forgets everything on restart; these rows do not, which is what a Redis or
 * SQL limiter would count when the in-memory one is replaced.
 */
export interface RecordRealtimeSessionInput {
  userId: string;
  conversationId: string | null;
  model: string;
  voice: string;
  expiresAt: Date;
}

export interface RealtimeSessionRepository {
  record(input: RecordRealtimeSessionInput): Promise<void>;
}
