import {
  appendTurnBody,
  appendTurnResponse,
  conversationDetail,
  conversationIdParams,
  conversationList,
  conversationListQuery,
  conversationSummary,
  errorEnvelope,
  updateConversationBody,
} from "@convo/shared";
import { container } from "~/infrastructure/di/container";
import { currentUser } from "~/presentation/http/authenticated-user";
import { defineHandler } from "~/presentation/http/define-handler";
import {
  toConversationDetail,
  toConversationSummary,
  toTurn,
} from "~/presentation/mappers/conversation.mapper";

/**
 * The HTTP adapter for conversations.
 *
 * Every handler is the same four lines: take the user from the session, call
 * one use case, map the result to the wire shape, choose a status. No queries
 * and no ownership checks - those live in the use case and the repository
 * respectively, where they are testable without a request.
 *
 * `updateConversation` is the one handler that branches, and on the SHAPE of
 * the body rather than on its data: deciding whether a PATCH means "rename" or
 * "end" is deciding what the request means, which is this layer's job. Which
 * rows that then touches is not.
 *
 * `requiresAuth: true` on each spec is what puts the padlock in Swagger AND
 * enforces the 401 at runtime; see defineHandler.
 */

export const createConversation = defineHandler({
  operationId: "createConversation",
  method: "post",
  path: "/api/conversations",
  summary: "Start a conversation",
  description:
    "Opens a conversation for the signed-in user and returns it. Takes no body: the title is not chosen by the caller, it is derived from the first thing the user says. Call this before minting a realtime credential so every turn has somewhere to go.",
  tags: ["conversations"],
  requiresAuth: true,
  responses: { 201: conversationSummary, 401: errorEnvelope },
  handler: async ({ context }) => {
    const user = currentUser(context);
    const conversation = await container.startConversation.execute(user.id);

    return { status: 201, body: toConversationSummary(conversation) };
  },
});

export const listConversations = defineHandler({
  operationId: "listConversations",
  method: "get",
  path: "/api/conversations",
  summary: "List conversations",
  description:
    "The signed-in user's conversations, newest first, keyset paginated. Pass the `nextCursor` from the previous page as `cursor`; a null `nextCursor` means there are no more. Cursors are opaque - do not construct one. Pass `q` to search: it matches a conversation's title or the text of anything said in it, case-insensitively, and pages exactly like an unfiltered list.",
  tags: ["conversations"],
  requiresAuth: true,
  query: conversationListQuery,
  responses: {
    200: conversationList,
    400: errorEnvelope,
    401: errorEnvelope,
    422: errorEnvelope,
  },
  handler: async ({ context, query }) => {
    const user = currentUser(context);

    const page = await container.listConversations.execute(user.id, {
      limit: query.limit,
      cursor: query.cursor,
      query: query.q,
    });

    return {
      status: 200,
      body: {
        items: page.items.map(toConversationSummary),
        nextCursor: page.nextCursor,
      },
    };
  },
});

export const getConversation = defineHandler({
  operationId: "getConversation",
  method: "get",
  path: "/api/conversations/{id}",
  summary: "Get a conversation and its turns",
  description:
    "Returns the conversation with every turn, ordered by `seq`. A conversation belonging to another user answers 404, not 403 - a 403 would confirm that the id exists.",
  tags: ["conversations"],
  requiresAuth: true,
  params: conversationIdParams,
  responses: { 200: conversationDetail, 401: errorEnvelope, 404: errorEnvelope },
  handler: async ({ context, params }) => {
    const user = currentUser(context);

    const { conversation, turns } = await container.getConversation.execute(
      user.id,
      params.id,
    );

    return { status: 200, body: toConversationDetail(conversation, turns) };
  },
});

export const updateConversation = defineHandler({
  operationId: "updateConversation",
  method: "patch",
  path: "/api/conversations/{id}",
  summary: "Rename a conversation, or end it",
  description:
    'Two intents behind one PATCH. `{ "title": "..." }` renames it - the one title the user chooses rather than the server deriving. `{ "status": "ended" }` closes it and stamps `endedAt`, and is idempotent: ending an already-ended conversation succeeds and returns the ORIGINAL `endedAt`, because the device fires it as the call tears down - the least reliable moment on a mobile connection.',
  tags: ["conversations"],
  requiresAuth: true,
  params: conversationIdParams,
  body: updateConversationBody,
  responses: {
    200: conversationSummary,
    400: errorEnvelope,
    401: errorEnvelope,
    404: errorEnvelope,
    422: errorEnvelope,
  },
  handler: async ({ body, context, params }) => {
    const user = currentUser(context);

    /**
     * The one place this file decides anything, and it is deciding what the
     * REQUEST MEANS rather than what should happen - which is exactly the
     * split between a controller and a use case. The union has two members, so
     * this is exhaustive: there is no third shape to fall through to.
     */
    const conversation =
      "title" in body
        ? await container.renameConversation.execute(user.id, params.id, body.title)
        : await container.endConversation.execute(user.id, params.id, new Date());

    return { status: 200, body: toConversationSummary(conversation) };
  },
});

export const deleteConversation = defineHandler({
  operationId: "deleteConversation",
  method: "delete",
  path: "/api/conversations/{id}",
  summary: "Delete a conversation",
  description:
    "Erases the conversation and every turn in it. Not idempotent - a second delete answers 404, because by then the row genuinely is gone. The audit rows recording that a realtime credential was minted and which tools ran are NOT erased; only the words are.",
  tags: ["conversations"],
  requiresAuth: true,
  params: conversationIdParams,
  responses: { 204: null, 401: errorEnvelope, 404: errorEnvelope },
  handler: async ({ context, params }) => {
    const user = currentUser(context);

    await container.deleteConversation.execute(user.id, params.id);

    // 204, not 200 with a body: there is nothing left to describe.
    return { status: 204 };
  },
});

export const appendTurn = defineHandler({
  operationId: "appendTurn",
  method: "post",
  path: "/api/conversations/{id}/turns",
  summary: "Record a turn",
  description:
    "Stores one completed utterance. `seq` is assigned by the DEVICE and is what makes a retry safe: posting the same seq again returns 200 with `replayed: true` and leaves `turnCount` untouched, instead of storing the turn twice. A first write returns 201.",
  tags: ["conversations"],
  requiresAuth: true,
  params: conversationIdParams,
  body: appendTurnBody,
  responses: {
    200: appendTurnResponse,
    201: appendTurnResponse,
    401: errorEnvelope,
    404: errorEnvelope,
    422: errorEnvelope,
  },
  handler: async ({ body, context, params }) => {
    const user = currentUser(context);

    const result = await container.appendTurn.execute(user.id, params.id, {
      seq: body.seq,
      role: body.role,
      text: body.text,
      startedAt: body.startedAt ? new Date(body.startedAt) : null,
      endedAt: body.endedAt ? new Date(body.endedAt) : null,
    });

    return {
      // 201 says "this created something"; 200 says "this changed nothing".
      // The device uses the difference to tell a successful retry from a
      // genuine write without parsing the body.
      status: result.replayed ? 200 : 201,
      body: {
        turn: toTurn(result.turn),
        conversation: toConversationSummary(result.conversation),
        replayed: result.replayed,
      },
    };
  },
});
