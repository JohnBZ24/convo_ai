import { privilegedToolNames, TOOLS } from "@convo/ai";
import { describe, expect, it } from "vitest";
import { container, createContainer } from "~/infrastructure/di/container";

/**
 * The composition root is where a declaration becomes something that can
 * actually run, so it is also where the two halves can silently disagree: a
 * tool declared in `@convo/ai` with nothing bound here is a 500 waiting for the
 * first user who triggers it.
 *
 * `execute-tool.use-case.test.ts` proves that gap FAILS LOUDLY. This file
 * proves the gap does not currently exist.
 */

describe("tool handlers", () => {
  it("binds a handler for every declared privileged tool", () => {
    for (const name of privilegedToolNames()) {
      expect(
        container.toolHandlers[name],
        `${name} is declared but not wired`,
      ).toBeDefined();
    }
  });

  /**
   * The other direction. A handler bound under a name no tool declares is dead
   * code at best - and at worst an endpoint reachable by a model for something
   * that was deliberately retired from the registry.
   */
  it("binds nothing that is not a declared privileged tool", () => {
    const privileged = new Set(privilegedToolNames());

    for (const name of Object.keys(container.toolHandlers)) {
      expect(privileged.has(name), `${name} is wired but not declared privileged`).toBe(
        true,
      );
    }
  });

  it("never binds a handler for a device tool", () => {
    const deviceTools = TOOLS.filter((tool) => tool.execution === "device");

    for (const tool of deviceTools) {
      expect(container.toolHandlers[tool.name]).toBeUndefined();
    }
  });
});

describe("the override seam", () => {
  /**
   * This is what lets the whole of iteration 3 be tested without an OpenAI
   * account: swap the minter, keep everything else real.
   */
  it("lets a test replace the minter without touching anything else", () => {
    const stub = {
      callsUrl: "https://stub.test/realtime/calls",
      mint: async () => {
        throw new Error("not called");
      },
    };

    const custom = createContainer({ realtimeCredentialMinter: stub });

    expect(custom.realtimeCredentialMinter).toBe(stub);
    expect(custom.conversationRepository).toBeDefined();
  });
});
