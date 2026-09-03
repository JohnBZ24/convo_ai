import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Two jobs, both of them load-bearing.
 *
 * 1. STOP VITEST READING `node_modules.old/`.
 *
 * That directory is the pnpm tree renamed aside when the workspace moved to
 * `nodeLinker: hoisted` - kept rather than deleted, because a recursive delete
 * through a tree full of symlinks back into `apps/` and `packages/` is exactly
 * how this project was destroyed once already.
 *
 * vitest's default exclude is `** / node_modules/**`, which does NOT match
 * `node_modules.old`. So it was re-running the `@convo/shared` and `@convo/ai`
 * suites through the stale copies and reporting them as mobile tests: the "63
 * mobile tests" in HANDOFF was 11 real ones plus 52 duplicates. Restricting
 * the include to `src` fixes the count without touching the directory.
 *
 * 2. RESOLVE `~/` THE WAY METRO AND TSC DO.
 *
 * Without this, a tested file that imports `~/lib/api/client` typechecks, bundles
 * and runs on the device, and fails ONLY under vitest with "Cannot find module".
 * That is a trap of exactly the shape this project keeps hitting from the other
 * direction - something that works everywhere except the one place you check.
 */
const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "src");

export default defineConfig({
  resolve: {
    alias: { "~": src },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
