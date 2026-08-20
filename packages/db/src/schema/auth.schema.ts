import { boolean, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Better Auth's own tables.
 *
 * The SHAPE of these is not ours to choose - Better Auth's Drizzle adapter
 * looks fields up by name (`emailVerified`, `createdAt`, ...) and will fail at
 * runtime if a property is renamed. Treat this file as generated: it mirrors
 * `npx @better-auth/cli generate` output for the plugins configured in
 * `infrastructure/auth/auth.ts`, and it must be regenerated rather than edited
 * if a plugin that adds columns is switched on.
 *
 * They live here, in the schema drizzle-kit walks, so that ONE tool owns the
 * database. The alternative - Better Auth migrating its tables and drizzle-kit
 * migrating ours - gives two migration histories over one database.
 *
 * There are deliberately no DB-level defaults: Better Auth always supplies
 * these values itself, and this matches the live `convo` database exactly.
 */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/**
 * `token` is the session token. The bearer plugin turns an
 * `Authorization: Bearer <token>` header back into this row, which is why the
 * mobile app never needs a cookie jar.
 */
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

/**
 * Credentials. For email+password sign-in the hash sits in `password`; the
 * OAuth columns stay null unless a social provider is added later.
 *
 * `issuer` is new in Better Auth 1.7: an identity is scoped by WHO vouched for
 * it, not just by a provider name, so a provider id can never collide with an
 * internal authentication method. Email+password accounts carry the synthetic
 * issuer `local:credential`. The `convo` database predates 1.7 and had to be
 * migrated - see drizzle/0002.
 */
export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    issuer: text("issuer").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    /**
     * Better Auth looks an account up by (issuer, accountId) on every sign-in
     * and requires this to be UNIQUE - it is what stops one provider identity
     * being attached to two users.
     */
    uniqueIndex("account_issuer_account_id_uq").on(table.issuer, table.accountId),
  ],
);

/** Short-lived tokens for email verification and password reset. */
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/**
 * The object Better Auth's Drizzle adapter is handed. Keys are Better Auth's
 * MODEL names (singular), which is why the adapter is configured without
 * `usePlural`.
 */
export const authSchema = { user, session, account, verification };
