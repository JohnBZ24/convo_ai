import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * One voice session, from the first tap of the orb to the second.
 *
 * `turnCount` and `lastTurnAt` are denormalised so the sidebar can render a
 * conversation list without joining or aggregating over `turns`. They are
 * maintained inside the same transaction that appends a turn.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Better Auth user id. EVERY query filters on this - see the repository. */
    userId: text("user_id").notNull(),

    /** Derived from the first user turn; null until there is one. */
    title: text("title"),

    status: text("status", { enum: ["active", "ended"] })
      .notNull()
      .default("active"),

    turnCount: integer("turn_count").notNull().default(0),
    lastTurnAt: timestamp("last_turn_at", { withTimezone: true }),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    /**
     * Exactly matches the keyset pagination predicate
     * `WHERE user_id = $1 AND (started_at, id) < ($2, $3)`, so the list query
     * is an index range scan rather than a sort.
     */
    index("conversations_user_started_idx").on(
      table.userId,
      table.startedAt.desc(),
      table.id.desc(),
    ),
  ],
);
