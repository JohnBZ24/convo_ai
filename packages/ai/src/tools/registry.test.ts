import { describe, expect, it } from "vitest";
import { getCurrentTimeTool } from "./get-current-time.tool";
import {
  findTool,
  privilegedToolNames,
  realtimeToolDeclarations,
  TOOLS,
} from "./registry";
import { searchConversationsTool } from "./search-conversations.tool";
import { toParameterSchema } from "./tool-definition";

/**
 * The registry is the security boundary's source of truth: the server decides
 * whether to run something by asking this list where the tool executes. So the
 * facts pinned here are the ones a wrong answer would turn into a vulnerability
 * or a 500 on a device.
 */

describe("the registry", () => {
  it("has no duplicate names, which would make lookup order decide behaviour", () => {
    const names = TOOLS.map((tool) => tool.name);

    expect(new Set(names).size).toBe(names.length);
  });

  it("finds a declared tool and returns undefined for an invented one", () => {
    expect(findTool("get_current_time")).toBe(getCurrentTimeTool);
    expect(findTool("delete_everything")).toBeUndefined();
  });

  /**
   * The one classification that matters. `get_current_time` must stay a device
   * tool - the server has no better clock than the phone, and proxying it would
   * establish "the model asked, so we ran it" as an acceptable pattern.
   */
  it("keeps get_current_time on the device and search_conversations privileged", () => {
    expect(getCurrentTimeTool.execution).toBe("device");
    expect(searchConversationsTool.execution).toBe("privileged");
    expect(privilegedToolNames()).toEqual(["search_conversations"]);
  });

  it("never declares a userId parameter on any tool", () => {
    // Identity comes from the session. A tool that ACCEPTED a user id would be
    // one prompt injection away from reading someone else's history.
    for (const tool of TOOLS) {
      const properties = Object.keys(
        (toParameterSchema(tool.input).properties ?? {}) as Record<string, unknown>,
      );

      expect(properties).not.toContain("userId");
      expect(properties).not.toContain("user_id");
    }
  });
});

describe("the JSON Schema handed to OpenAI", () => {
  it("drops $schema, which OpenAI does not want in a parameter schema", () => {
    expect(toParameterSchema(searchConversationsTool.input)).not.toHaveProperty(
      "$schema",
    );
  });

  /**
   * Without this the model may invent a field, which then fails validation
   * server-side and the user hears an apology instead of an answer.
   */
  it("forbids extra properties", () => {
    expect(toParameterSchema(getCurrentTimeTool.input).additionalProperties).toBe(
      false,
    );
  });

  it("marks a defaulted argument optional and a required one required", () => {
    const schema = toParameterSchema(searchConversationsTool.input);

    // `limit` has a default, so the model may omit it; `query` may not.
    expect(schema.required).toEqual(["query"]);
  });

  it("declares every tool to the model, device ones included", () => {
    // The model cannot see where a tool runs and does not need to - routing is
    // the device's job. This is why the server re-checks `execution` on arrival
    // rather than assuming only privileged tools will ever be proxied.
    expect(realtimeToolDeclarations().map((tool) => tool.name)).toEqual([
      "get_current_time",
      "search_conversations",
    ]);

    for (const declaration of realtimeToolDeclarations()) {
      expect(declaration.type).toBe("function");
      expect(declaration.description.length).toBeGreaterThan(0);
      expect(declaration.parameters.type).toBe("object");
    }
  });
});

describe("argument validation", () => {
  it("rejects a query longer than the declared maximum", () => {
    const tool = searchConversationsTool;

    expect(tool.input.safeParse({ query: "x".repeat(201) }).success).toBe(false);
    expect(tool.input.safeParse({ query: "" }).success).toBe(false);
  });

  it("applies the declared default so a handler never sees an absent limit", () => {
    const parsed = searchConversationsTool.input.parse({ query: "fuji" });

    expect(parsed.limit).toBe(5);
  });

  it("caps limit, so one tool call cannot pull an entire history", () => {
    expect(
      searchConversationsTool.input.safeParse({ query: "a", limit: 50 }).success,
    ).toBe(false);
  });
});
