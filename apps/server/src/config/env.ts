import {
  CLIENT_SECRET_TTL_MAX_SECONDS,
  CLIENT_SECRET_TTL_MIN_SECONDS,
  CLIENT_SECRET_TTL_SECONDS,
  DEFAULT_REALTIME_MODEL,
  DEFAULT_REALTIME_VOICE,
  REALTIME_VOICES,
} from "@convo/ai";
import { z } from "zod";

/**
 * A blank line in a .env file (`FOO=`) arrives as an EMPTY STRING, not
 * `undefined`. So `z.string().optional()` alone does not do what it looks like
 * it does - it happily accepts "". This coerces empty to absent first.
 *
 * Rediscovering this cost real time once already; see docs/HANDOFF.md.
 */
const blankToUndefined = (value: unknown) => (value === "" ? undefined : value);

/**
 * A value that falls back when the variable is absent OR blank.
 *
 * The default lives HERE rather than at the call site, so downstream code gets
 * a plain `string`/`number` and never has to re-decide the fallback - which is
 * how two call sites end up disagreeing about what the default was.
 */
function withDefault<T extends z.ZodType>(schema: T) {
  return z.preprocess(blankToUndefined, schema);
}

function booleanish(defaultValue: boolean) {
  return z.preprocess(
    (value) => (value === "" || value === undefined ? defaultValue : value === "true"),
    z.boolean(),
  );
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_VERSION: z.string().default("0.0.0"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  /**
   * Server-only. Exchanged for a short-lived client secret; never sent to the
   * device.
   */
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),

  /**
   * Where the realtime endpoints live. Configurable so a proxy, a regional
   * host or a local mock is an environment change - and because the device is
   * TOLD this value (as `callsUrl`), pointing the server elsewhere moves both
   * halves of the flow at once instead of half of it.
   */
  OPENAI_BASE_URL: withDefault(z.url().default("https://api.openai.com/v1")),

  /** Any id from `GET /v1/models`. Pinned here so the model changes without a release. */
  REALTIME_MODEL: withDefault(z.string().min(1).default(DEFAULT_REALTIME_MODEL)),

  /**
   * Validated against the enumerated voices rather than accepted as any
   * string. A typo would otherwise be discovered by OpenAI, sixty seconds into
   * a demo, as a failed mint and an orb that spins forever.
   */
  REALTIME_VOICE: withDefault(z.enum(REALTIME_VOICES).default(DEFAULT_REALTIME_VOICE)),

  /**
   * How long a minted credential lives. The API accepts 10-7200; the bounds are
   * imported from `@convo/ai` rather than retyped, so they cannot drift from
   * what the provider actually enforces. Short is safer - see the constant.
   */
  REALTIME_CLIENT_SECRET_TTL_SECONDS: withDefault(
    z.coerce
      .number()
      .int()
      .min(CLIENT_SECRET_TTL_MIN_SECONDS)
      .max(CLIENT_SECRET_TTL_MAX_SECONDS)
      .default(CLIENT_SECRET_TTL_SECONDS),
  ),

  /**
   * A hung mint is worse than a failed one: the user is holding a phone with a
   * spinning orb. Bounded so the app can offer a retry instead of hanging.
   */
  OPENAI_REQUEST_TIMEOUT_MS: withDefault(
    z.coerce.number().int().min(1000).max(60_000).default(10_000),
  ),

  BETTER_AUTH_SECRET: z.string().min(1, "BETTER_AUTH_SECRET is required"),
  BETTER_AUTH_URL: z.string().min(1, "BETTER_AUTH_URL is required"),

  /** Gates /api/openapi and /api/docs. Defaults on outside production. */
  DOCS_ENABLED: booleanish(process.env.NODE_ENV !== "production"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");

  throw new Error(
    `Invalid environment. Vite loads .env from apps/server/, NOT the repo root.\n${problems}`,
  );
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
export const isDevelopment = env.NODE_ENV === "development";

export type Env = typeof env;
