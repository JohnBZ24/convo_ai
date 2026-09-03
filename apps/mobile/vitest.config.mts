import { defineConfig } from "vitest/config";

/**
 * This file exists to stop vitest reading `node_modules.old/`.
 *
 * That directory is the pnpm tree renamed aside when the workspace moved to
 * `nodeLinker: hoisted` - kept rather than deleted, because a recursive delete
 * through a tree full of symlinks back into `apps/` and `packages/` is exactly
 * how this project was destroyed once already.
 *
 * vitest's default exclude is `**\/node_modules/**`, which does NOT match
 * `node_modules.old`. So it was re-running the `@convo/shared` and `@convo/ai`
 * suites through the stale copies and reporting them as mobile tests: the "63
 * mobile tests" in HANDOFF was 11 real ones plus 52 duplicates. Restricting
 * the include to `src` fixes the count without touching the directory.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
