import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { conversations } from "./conversations.schema";

/**
 * An audit row per ephemeral OpenAI credential minted.
 *
 * The credential itself is never stored - only that one was issued, to whom,
 * and when it expired. Doubles as the rate-limit window source once the
 * in-memory limiter is replaced with something durable.
 */
export const realtimeSessions = pgTable(
  "realtime_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    model: text("model").notNull(),
    voice: text("voice").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("realtime_sessions_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
  ],
);
