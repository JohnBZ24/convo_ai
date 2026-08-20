import {
  authErrorResponse,
  sessionResponse,
  signInBody,
  signInResponse,
  signUpBody,
} from "@convo/shared";
import { z } from "zod";
import { toSchema } from "./zod-to-openapi";

/**
 * The ONE part of this document that is written by hand rather than discovered.
 *
 * Everything else is generated from the `defineHandler` specs, which cannot
 * drift because they are the same objects that validate the requests. These
 * four cannot be: `/api/auth/*` is served by Better Auth's own router through a
 * bare splat, so there is no spec to read.
 *
 * They are documented anyway because the Swagger loop is the manual test
 * surface for the entire API: sign up here, sign in here, copy the token from
 * the `set-auth-token` response header, press Authorize, and every protected
 * endpoint becomes clickable. Without these operations that loop starts with a
 * curl command pasted from a README, which is exactly the kind of instruction
 * that rots.
 *
 * The schemas still come from @convo/shared, so the docs and the mobile
 * client's expectations are at least written down in one place.
 */

const json = (schema: z.ZodType, io: "input" | "output") => ({
  "application/json": { schema: toSchema(schema, io) },
});

const authError = (description: string) => ({
  description,
  content: json(authErrorResponse, "output"),
});

export function buildAuthOperations(): Record<string, Record<string, unknown>> {
  return {
    "/api/auth/sign-up/email": {
      post: {
        operationId: "signUpEmail",
        summary: "Create an account",
        description:
          "Creates the user and signs them in immediately. The bearer token comes back in the `set-auth-token` RESPONSE HEADER; the body also carries a `token` and the two differ - the header's is signed - but both authenticate. Passwords shorter than 12 characters are rejected with `PASSWORD_TOO_SHORT`.",
        tags: ["auth"],
        requestBody: { required: true, content: json(signUpBody, "input") },
        responses: {
          200: { description: "Signed up", content: json(signInResponse, "output") },
          400: authError("Password too short or body malformed"),
          422: authError("USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"),
        },
      },
    },

    "/api/auth/sign-in/email": {
      post: {
        operationId: "signInEmail",
        summary: "Sign in",
        description:
          "Exchanges credentials for a session. Copy the `set-auth-token` response header into the Authorize dialog to use every protected endpoint below. A wrong password returns `INVALID_EMAIL_OR_PASSWORD`.",
        tags: ["auth"],
        requestBody: { required: true, content: json(signInBody, "input") },
        responses: {
          200: { description: "Signed in", content: json(signInResponse, "output") },
          401: authError("INVALID_EMAIL_OR_PASSWORD"),
        },
      },
    },

    "/api/auth/get-session": {
      get: {
        operationId: "getSession",
        summary: "Inspect the current session",
        description:
          "Returns the session behind the presented token, or null. The app calls this on launch to decide whether to show the sign-in screen.",
        tags: ["auth"],
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "The session, or null when the token is absent or expired",
            content: json(sessionResponse, "output"),
          },
        },
      },
    },

    "/api/auth/sign-out": {
      post: {
        operationId: "signOut",
        summary: "Sign out",
        description: "Revokes the presented session server-side.",
        tags: ["auth"],
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "Signed out",
            content: json(z.object({ success: z.boolean() }), "output"),
          },
          401: authError("No valid session to revoke"),
        },
      },
    },
  };
}

/**
 * These four responses do NOT use this API's error envelope - Better Auth
 * returns a flat `{ code, message }`. Stated on the document itself so nobody
 * writes a client that parses every failure the same way.
 */
export const AUTH_TAG = {
  name: "auth",
  description:
    "Better Auth. NOTE: these endpoints return Better Auth's own flat `{ code, message }` errors, NOT the `ErrorEnvelope` every other endpoint uses.",
} as const;
