import { getCurrentTimeTool } from "./get-current-time.tool";
import { searchConversationsTool } from "./search-conversations.tool";
import {
  type RealtimeFunctionTool,
  type ToolDefinition,
  toRealtimeTool,
} from "./tool-definition";
import { webSearchTool } from "./web-search.tool";

/**
 * Every tool the model is told about, in one list.
 *
 * This is the ONLY place a tool becomes real. The session config is generated
 * from it, the server's dispatch looks up in it, and `POST /api/tools/:name`
 * answers 404 for anything absent - so a model that hallucinates a tool name
 * gets a clean refusal rather than reaching any code.
 */
export const TOOLS = [
  getCurrentTimeTool,
  searchConversationsTool,
  webSearchTool,
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];

const BY_NAME: ReadonlyMap<string, ToolDefinition> = new Map(
  TOOLS.map((tool) => [tool.name, tool as ToolDefinition]),
);

/** Undefined for a name that is not a tool - i.e. the model invented it. */
export function findTool(name: string): ToolDefinition | undefined {
  return BY_NAME.get(name);
}

/** The tools that must be executed on the server, keyed by name. */
export function privilegedToolNames(): string[] {
  return TOOLS.filter((tool) => tool.execution === "privileged").map(
    (tool) => tool.name,
  );
}

/**
 * `session.tools` as OpenAI wants it.
 *
 * Every tool is declared to the model, device and privileged alike - the model
 * cannot see where a tool runs and does not need to. Routing is the DEVICE's
 * job: it executes device tools locally and proxies privileged ones back to the
 * API. That is why the server still has to check `execution` on arrival rather
 * than trusting that only privileged tools will ever be sent.
 */
export function realtimeToolDeclarations(): RealtimeFunctionTool[] {
  return TOOLS.map((tool) => toRealtimeTool(tool as ToolDefinition));
}
