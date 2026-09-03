import type { ExecuteToolResponse } from "@convo/shared";
import { apiRequest } from "./client";

/**
 * The privileged-tool proxy.
 *
 * The model asked for a tool that touches the user's data, so it runs on the
 * server, as the user from THIS bearer token. Note what is not here: no
 * `userId`. Identity comes from the session and never from an argument, because
 * a model can be talked into passing any id and cannot forge a session.
 */
export function executeTool(
  token: string,
  name: string,
  request: {
    callId: string;
    arguments: Record<string, unknown>;
    conversationId?: string | undefined;
  },
): Promise<ExecuteToolResponse> {
  return apiRequest<ExecuteToolResponse>(`/api/tools/${name}`, {
    method: "POST",
    body: request,
    token,
  });
}
