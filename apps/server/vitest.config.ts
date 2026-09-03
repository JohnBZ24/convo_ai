import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    /**
     * The document test imports the controllers, which reach the container and
     * therefore `config/env.ts` - and that THROWS on a missing variable, by
     * design, so a broken environment fails at boot rather than mid-demo.
     *
     * These values are placeholders, not a test database. Nothing here connects:
     * postgres-js opens a socket on the first query, and no test issues one.
     * Set explicitly rather than read from .env so the suite behaves the same on
     * a machine that has never had one.
     */
    env: {
      NODE_ENV: "test",
      APP_VERSION: "0.0.0-test",
      DATABASE_URL: "postgres://placeholder:placeholder@127.0.0.1:5432/placeholder",
      OPENAI_API_KEY: "sk-placeholder",
      EXA_API_KEY: "exa-placeholder",
      BETTER_AUTH_SECRET: "placeholder-secret-for-tests-only",
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
      DOCS_ENABLED: "true",
    },
  },
});
