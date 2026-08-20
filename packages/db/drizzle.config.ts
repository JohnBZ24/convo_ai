import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit reads DATABASE_URL from the environment. The server owns the
 * .env file, so migrations are run with it loaded from there:
 *
 *   pnpm --filter @convo/db db:generate
 *   pnpm --filter @convo/db db:migrate

 */
/** drizzle-kit wants a file or glob here, not a bare directory. */
const schemaGlob = "./src/schema/*.schema.ts";
const migrationsDir = "./drizzle";

export default defineConfig({
  dialect: "postgresql",
  schema: schemaGlob,
  out: migrationsDir,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
