import {
  errorEnvelope,
  executeToolBody,
  executeToolParams,
  executeToolResponse,
} from "@convo/shared";
import { container } from "~/infrastructure/di/container";
import { currentUser } from "~/presentation/http/authenticated-user";
import { defineHandler } from "~/presentation/http/define-handler";

/**
 * The HTTP adapter for privileged tool calls.
 *
 * This is the most exposed endpoint in the API: the caller on the other end is
 * a language model running on a device the user controls, and the user may have
 * been prompt-injected into asking it for anything. The controller's whole job
 * is therefore to take the user from the SESSION and pass the rest through
 * untouched - the use case treats the tool name and arguments as hostile.
 *
 * Note that `currentUser(context)` is the only source of identity. There is no
 * `userId` field on the request body, and adding one would be a vulnerability.
 */
export const executeTool = defineHandler({
  operationId: "executeTool",
  method: "post",
  path: "/api/tools/{name}",
  summary: "Execute a privileged tool",
  description:
    "Runs a tool the model asked for, as the signed-in user. Identity comes from the bearer token and never from the arguments. Three refusals are distinguished on purpose: an unknown tool is 404 (the model invented it), a device tool is 403 (real tool, wrong executor - the device must run it locally), and a privileged tool with no server implementation is 500 (our bug, not the caller's). Rate limited to 120 per minute per user.",
  tags: ["tools"],
  requiresAuth: true,
  params: executeToolParams,
  body: executeToolBody,
  responses: {
    200: executeToolResponse,
    400: errorEnvelope,
    401: errorEnvelope,
    403: errorEnvelope,
    404: errorEnvelope,
    422: errorEnvelope,
    429: errorEnvelope,
    500: errorEnvelope,
  },
  handler: async ({ body, context, params }) => {
    const user = currentUser(context);

    const result = await container.executeTool.execute(user.id, {
      toolName: params.name,
      callId: body.callId,
      arguments: body.arguments,
      conversationId: body.conversationId,
    });

    /**
     * 200 for both a fresh call and a replay, unlike `appendTurn`'s 201/200.
     * A tool call CREATES nothing the caller can address - there is no new
     * resource to point at - so the distinction is carried in `replayed`,
     * where the device can read it without inferring from a status code.
     */
    return { status: 200, body: result };
  },
});
