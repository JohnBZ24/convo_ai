import { authSchema } from "@convo/db/schema";
import { PASSWORD_MIN_LENGTH } from "@convo/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins/bearer";
import { env, isProduction } from "~/config/env";
import { db } from "~/infrastructure/database/database";

/**
 * Better Auth, configured for a NATIVE client.
 *
 * The mobile app has no cookie jar and no browser to manage one, so the bearer
 * plugin is what makes this usable: it accepts `Authorization: Bearer <token>`
 * and hands back the token in a `set-auth-token` response header on sign-in.
 * Every other route reads the session from that header.
 *
 * Nothing here is wrapped in this API's own handler or error envelope. Better
 * Auth owns its request and response shapes end to end - including the headers
 * the bearer flow depends on - and wrapping it would rewrite them.
 */
export const auth = betterAuth({
  appName: "Convo AI",
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  basePath: "/api/auth",

  /**
   * The same Drizzle handle the rest of the server uses, so auth writes and
   * conversation writes share one connection pool rather than opening a second.
   * Keys of `authSchema` are Better Auth's model names, which is why
   * `usePlural` stays off.
   */
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),

  emailAndPassword: {
    enabled: true,
    /**
     * 12, not the default 8. Mirrored in the mobile sign-up form from the same
     * constant in @convo/shared - a client that validates at 8 would send a
     * password the server rejects, and show an error the form promised could
     * not happen.
     */
    minPasswordLength: PASSWORD_MIN_LENGTH,
    /** The device gets a session straight from sign-up; no second round trip. */
    autoSignIn: true,
  },

  session: {
    /**
     * Thirty days, refreshed once a day of use. A voice app that demands a
     * re-login is a voice app the user stops opening; the token lives in the
     * device keystore, not in a browser someone else can reach.
     */
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },

  /**
   * `convoai://` is the app's scheme - it must match `expo.scheme` exactly, or
   * sign-in fails on the device with an origin error that reads like a network
   * fault. 8081 is Metro, for the browser-hosted dev client.
   */
  trustedOrigins: [env.BETTER_AUTH_URL, "convoai://", "http://localhost:8081"],

  advanced: {
    useSecureCookies: isProduction,
  },

  plugins: [bearer()],
});

export type Auth = typeof auth;
