import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { conversations } from "./conversations.schema";

/**
 * Every privileged tool call the model made, whether it succeeded or not.
 *
 * This endpoint is reachable by a model a user may have prompt-injected, so
 * the audit trail matters. `idempotencyKey` is unique: a retried tool call
 * executes once.
 */
export const toolInvocations = pgTable(
  "tool_invocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    toolName: text("tool_name").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: text("status", { enum: ["ok", "error"] }).notNull(),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tool_invocations_user_created_idx").on(table.userId, table.createdAt.desc()),
  ],
);
