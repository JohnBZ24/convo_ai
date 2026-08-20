import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { account, session, user, verification } from "./auth.schema";
import { conversations } from "./conversations.schema";
import { turns } from "./turns.schema";

/**
 * Guards on the two kinds of schema fact that break things silently.
 *
 * These need no database: `getTableConfig` reads the definition Drizzle will
 * generate SQL from, so a rename or a dropped index fails here rather than in
 * production. That matters because both of the invariants below are relied on
 * by code that looks correct without them - a missing unique index does not
 * throw, it just quietly starts storing duplicate turns.
 */

function columnNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).columns.map((column) => column.name);
}

describe("turns", () => {
  /**
   * THE idempotency guarantee. `appendTurn` inserts ON CONFLICT DO NOTHING
   * against this index; without it every retried turn from a flaky mobile
   * network becomes a duplicate row and a double-counted turn.
   */
  it("keeps the unique index on (conversation_id, seq)", () => {
    const unique = getTableConfig(turns).indexes.find(
      (index) => index.config.name === "turns_conversation_seq_uq",
    );

    expect(unique).toBeDefined();
    expect(unique?.config.unique).toBe(true);
    expect(unique?.config.columns.map((c) => (c as { name: string }).name)).toEqual([
      "conversation_id",
      "seq",
    ]);
  });

  it("cascades from its conversation, so ending one cannot orphan turns", () => {
    const [foreignKey] = getTableConfig(turns).foreignKeys;

    expect(foreignKey?.onDelete).toBe("cascade");
  });
});

describe("conversations", () => {
  /**
   * Ownership lives in the WHERE clause, so `user_id` is not optional
   * bookkeeping - it is the column that makes a cross-user read return 404.
   */
  it("carries user_id and the denormalised counters the sidebar reads", () => {
    expect(columnNames(conversations)).toEqual(
      expect.arrayContaining([
        "user_id",
        "turn_count",
        "last_turn_at",
        "started_at",
        "ended_at",
      ]),
    );
  });

  /**
   * Must match the keyset predicate `(started_at, id) < (cursor)` exactly, or
   * the list query degrades from an index range scan into a sort of the whole
   * user's history.
   */
  it("indexes (user_id, started_at DESC, id DESC) for keyset pagination", () => {
    const index = getTableConfig(conversations).indexes.find(
      (i) => i.config.name === "conversations_user_started_idx",
    );

    expect(index?.config.columns.map((c) => (c as { name: string }).name)).toEqual([
      "user_id",
      "started_at",
      "id",
    ]);
  });
});

/**
 * Better Auth's Drizzle adapter resolves fields by NAME. Renaming a property
 * here does not fail to compile - it fails at runtime, on sign-in, with
 * "The field X does not exist in the Y Drizzle schema".
 */
describe("Better Auth tables", () => {
  it("uses the model names the adapter looks up", () => {
    expect(getTableConfig(user).name).toBe("user");
    expect(getTableConfig(session).name).toBe("session");
    expect(getTableConfig(account).name).toBe("account");
    expect(getTableConfig(verification).name).toBe("verification");
  });

  it("keeps every field Better Auth 1.7 requires on account", () => {
    // `issuer` is the 1.7 addition: an identity is scoped by who vouched for
    // it. Its absence is what broke sign-up against the pre-1.7 database.
    expect(columnNames(account)).toEqual(
      expect.arrayContaining([
        "issuer",
        "account_id",
        "provider_id",
        "user_id",
        "password",
      ]),
    );
  });

  it("keeps (issuer, account_id) unique, which is how an identity is resolved", () => {
    const unique = getTableConfig(account).indexes.find(
      (index) => index.config.name === "account_issuer_account_id_uq",
    );

    expect(unique?.config.unique).toBe(true);
  });

  it("keeps session.token unique, since the bearer token resolves through it", () => {
    const token = getTableConfig(session).columns.find((c) => c.name === "token");

    expect(token?.isUnique).toBe(true);
  });
});
