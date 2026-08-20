import { z } from "zod";

/**
 * A blank line in a .env file (`FOO=`) arrives as an EMPTY STRING, not
 * `undefined`. So `z.string().optional()` alone does not do what it looks like
 * it does - it happily accepts "". This coerces empty to absent first.
 *
 * Rediscovering this cost real time once already; see docs/HANDOFF.md.
 */
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
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
   * device. Not used until iteration 3, but validated now so a broken
   * environment fails at boot rather than mid-demo.
   */
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  REALTIME_MODEL: optional(z.string()),
  REALTIME_VOICE: optional(z.string()),

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
