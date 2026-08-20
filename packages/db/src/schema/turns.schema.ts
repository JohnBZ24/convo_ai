import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { conversations } from "./conversations.schema";

/**
 * One utterance - either the user's or the model's.
 *
 * The device assigns `seq` and posts turns as they complete. Mobile networks
 * drop requests, so the device retries; the unique index below is what makes
 * that retry safe rather than duplicating the turn.
 */
export const turns = pgTable(
  "turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),

    /** Device-assigned, monotonic within a conversation, starting at 1. */
    seq: integer("seq").notNull(),

    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    text: text("text").notNull(),

    /** Wall-clock bounds of the utterance, as observed on the device. */
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * THE idempotency guarantee. `appendTurn` inserts with
     * ON CONFLICT DO NOTHING and only bumps the denormalised counters when the
     * insert actually happened, so a retried turn returns 200 "replayed"
     * instead of creating a duplicate row or double-counting.
     */
    uniqueIndex("turns_conversation_seq_uq").on(table.conversationId, table.seq),
  ],
);
